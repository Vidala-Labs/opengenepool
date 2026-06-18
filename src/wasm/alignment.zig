///! Linear-Space Smith-Waterman Local Pairwise Alignment
///!
///! Implements Hirschberg-style divide-and-conquer for O(n) space complexity.
///! Exports functions for WASM integration with JavaScript.
///!
///! Zig version: 0.15.x
const std = @import("std");

// WASM allocator using a simple bump allocator
// Keep heap small - we reset it on each align call anyway
var heap: [32 * 1024 * 1024]u8 align(8) = undefined; // 32MB heap
var heap_offset: usize = 0;

fn wasmAlloc(size: usize) ?[*]u8 {
    const aligned_size = (size + 7) & ~@as(usize, 7); // 8-byte alignment
    if (heap_offset + aligned_size > heap.len) {
        return null;
    }
    const ptr: [*]u8 = @ptrCast(&heap[heap_offset]);
    heap_offset += aligned_size;
    return ptr;
}

fn wasmFree(_: [*]u8, _: usize) void {
    // No-op for bump allocator - memory is freed when heap is reset
}

fn resetHeap() void {
    heap_offset = 0;
}

fn heapMark() usize {
    return heap_offset;
}

fn resetHeapTo(mark: usize) void {
    heap_offset = mark;
}

const MASK_A: u8 = 1;
const MASK_C: u8 = 2;
const MASK_G: u8 = 4;
const MASK_T: u8 = 8;
const DEFAULT_BAND_WIDTH: usize = 128;
const DEFAULT_ORIGIN_KMER_SIZE: usize = 15;
const DEFAULT_ORIGIN_MIN_VOTES: u32 = 3;
const NEGATIVE_INFINITY: i32 = -1_000_000_000;

const TRACE_STOP: u8 = 0;
const TRACE_DIAG: u8 = 1;
const TRACE_E: u8 = 2;
const TRACE_F: u8 = 3;
const TRACE_H: u8 = 4;

pub const NormalizedSequence = struct {
    text: []u8,
    masks: []u8,
};

fn toUpper(base: u8) u8 {
    return if (base >= 'a' and base <= 'z') base - 32 else base;
}

fn maskForUpperBase(base: u8) u8 {
    return switch (base) {
        'A' => MASK_A,
        'C' => MASK_C,
        'G' => MASK_G,
        'T' => MASK_T,
        'N' => MASK_A | MASK_C | MASK_G | MASK_T,
        'R' => MASK_A | MASK_G,
        'Y' => MASK_C | MASK_T,
        'S' => MASK_G | MASK_C,
        'W' => MASK_A | MASK_T,
        'K' => MASK_G | MASK_T,
        'M' => MASK_A | MASK_C,
        'B' => MASK_C | MASK_G | MASK_T,
        'D' => MASK_A | MASK_G | MASK_T,
        'H' => MASK_A | MASK_C | MASK_T,
        'V' => MASK_A | MASK_C | MASK_G,
        else => 0,
    };
}

fn isSingleBaseMask(mask: u8) bool {
    return mask == MASK_A or mask == MASK_C or mask == MASK_G or mask == MASK_T;
}

fn concreteBaseBits(base: u8) ?u64 {
    return switch (base) {
        'A' => 0,
        'C' => 1,
        'G' => 2,
        'T' => 3,
        else => null,
    };
}

fn kmerKeyCircular(text: []const u8, start: usize, kmer_size: usize) ?u64 {
    var key: u64 = 0;
    for (0..kmer_size) |i| {
        const bits = concreteBaseBits(text[(start + i) % text.len]) orelse return null;
        key = (key << 2) | bits;
    }
    return key;
}

fn kmerKeyLinear(text: []const u8, start: usize, kmer_size: usize) ?u64 {
    var key: u64 = 0;
    for (0..kmer_size) |i| {
        const bits = concreteBaseBits(text[start + i]) orelse return null;
        key = (key << 2) | bits;
    }
    return key;
}

pub fn estimateCircularTargetOffset(query_text: []const u8, target_text: []const u8, requested_kmer_size: usize, requested_min_votes: u32) usize {
    const n = target_text.len;
    if (query_text.len == 0 or n == 0) return 0;

    const kmer_size = @min(if (requested_kmer_size == 0) DEFAULT_ORIGIN_KMER_SIZE else requested_kmer_size, @min(query_text.len, n));
    if (kmer_size < 4) return 0;

    const query_limit = query_text.len - kmer_size;
    const target_keys_ptr = wasmAlloc(n * @sizeOf(u64)) orelse return 0;
    const target_key_valid_ptr = wasmAlloc(n * @sizeOf(u8)) orelse return 0;
    const target_keys: [*]u64 = @ptrCast(@alignCast(target_keys_ptr));
    const target_key_valid = target_key_valid_ptr[0..n];
    for (0..n) |i| {
        if (kmerKeyCircular(target_text, i, kmer_size)) |key| {
            target_keys[i] = key;
            target_key_valid[i] = 1;
        } else {
            target_keys[i] = 0;
            target_key_valid[i] = 0;
        }
    }

    const votes_ptr = wasmAlloc(n * @sizeOf(u32)) orelse return 0;
    const votes: [*]u32 = @ptrCast(@alignCast(votes_ptr));
    for (0..n) |i| {
        votes[i] = 0;
    }

    for (0..query_limit + 1) |i| {
        const key = kmerKeyLinear(query_text, i, kmer_size) orelse continue;
        for (0..n) |target_pos| {
            if (target_key_valid[target_pos] == 0 or target_keys[target_pos] != key) continue;
            const offset = (target_pos + n - (i % n)) % n;
            votes[offset] += 1;
        }
    }

    var best_offset: usize = 0;
    var best_votes: u32 = 0;
    var second_best_votes: u32 = 0;
    for (0..n) |offset| {
        const count = votes[offset];
        if (count > best_votes) {
            second_best_votes = best_votes;
            best_votes = count;
            best_offset = offset;
        } else if (count > second_best_votes) {
            second_best_votes = count;
        }
    }

    const min_votes = if (requested_min_votes == 0) DEFAULT_ORIGIN_MIN_VOTES else requested_min_votes;
    if (best_votes < min_votes) return 0;
    if (second_best_votes > 0 and best_votes * 2 < second_best_votes * 3) return 0;

    return best_offset;
}

fn rotateBytes(sequence: []const u8, offset: usize) ?[*]u8 {
    const ptr = wasmAlloc(sequence.len) orelse return null;
    const out = ptr[0..sequence.len];
    const normalized_offset = if (sequence.len == 0) 0 else offset % sequence.len;
    const right_len = sequence.len - normalized_offset;
    @memcpy(out[0..right_len], sequence[normalized_offset..]);
    if (normalized_offset > 0) {
        @memcpy(out[right_len..], sequence[0..normalized_offset]);
    }
    return ptr;
}

fn applyTargetOriginOffset(result: *AlignmentResultHeader, offset: usize) void {
    if (offset == 0 or result.score == 0) return;
    result.target_start += @intCast(offset);
    result.target_end += @intCast(offset);
    result.target_origin_offset = @intCast(offset);
}

fn scoreMasks(mask1: u8, mask2: u8, match_score: i32, mismatch_score: i32) i32 {
    if ((mask1 & mask2) == 0) {
        return mismatch_score;
    }

    if (mask1 == mask2 and isSingleBaseMask(mask1)) {
        return match_score;
    }

    return 1;
}

pub fn normalizeSequence(sequence: []const u8) ?NormalizedSequence {
    const text_ptr = wasmAlloc(sequence.len) orelse return null;
    const masks_ptr = wasmAlloc(sequence.len) orelse return null;
    const text = text_ptr[0..sequence.len];
    const masks = masks_ptr[0..sequence.len];

    normalizeTextSimd(sequence, text);

    for (text, 0..) |base, i| {
        masks[i] = maskForUpperBase(base);
    }

    return .{ .text = text, .masks = masks };
}

fn normalizeTextSimd(sequence: []const u8, text: []u8) void {
    const Vec = @Vector(16, u8);
    var i: usize = 0;

    while (i + 16 <= sequence.len) : (i += 16) {
        const bytes: Vec = sequence[i..][0..16].*;
        const is_lower = (bytes >= @as(Vec, @splat('a'))) & (bytes <= @as(Vec, @splat('z')));
        const upper = @select(u8, is_lower, bytes - @as(Vec, @splat(32)), bytes);
        text[i..][0..16].* = @as([16]u8, upper);
    }

    while (i < sequence.len) : (i += 1) {
        text[i] = toUpper(sequence[i]);
    }
}

fn normalizeSequenceScalar(sequence: []const u8) ?NormalizedSequence {
    const text_ptr = wasmAlloc(sequence.len) orelse return null;
    const masks_ptr = wasmAlloc(sequence.len) orelse return null;
    const text = text_ptr[0..sequence.len];
    const masks = masks_ptr[0..sequence.len];

    for (sequence, 0..) |base, i| {
        const upper = toUpper(base);
        text[i] = upper;
        masks[i] = maskForUpperBase(upper);
    }

    return .{ .text = text, .masks = masks };
}

const STATUS_OK: i32 = 0;
const STATUS_BAND_UNSAFE: i32 = 2;
const STATUS_OUT_OF_MEMORY: i32 = 3;
const STATUS_OUTPUT_TOO_SMALL: i32 = 4;

// Scalar result metadata. Aligned sequence bytes are written to caller-owned
// output buffers and are not represented by pointers in this struct.
pub const AlignmentResultHeader = extern struct {
    score: i32, // offset 0
    query_start: i32, // offset 4
    query_end: i32, // offset 8
    target_start: i32, // offset 12
    target_end: i32, // offset 16
    query_aligned_len: i32, // offset 20
    target_aligned_len: i32, // offset 24
    target_origin_offset: u32 = 0, // offset 28
    identity: f64, // offset 32
};

fn writeEmptyResult(result: *AlignmentResultHeader) void {
    result.* = AlignmentResultHeader{
        .score = 0,
        .query_start = 0,
        .query_end = 0,
        .target_start = 0,
        .target_end = 0,
        .query_aligned_len = 0,
        .target_aligned_len = 0,
        .target_origin_offset = 0,
        .identity = 0,
    };
}

// Find max score and endpoint using linear space
fn findMaxScoreLinearSpace(
    query_masks: []const u8,
    target_masks: []const u8,
    match_score: i32,
    mismatch_score: i32,
    gap_open: i32,
    gap_extend: i32,
) struct { max_score: i32, max_i: usize, max_j: usize } {
    const m = query_masks.len;
    const n = target_masks.len;
    const mark = heapMark();
    defer resetHeapTo(mark);

    // Allocate rows using our heap
    const row_size = (n + 1) * @sizeOf(i32);
    const prev_h_ptr = wasmAlloc(row_size) orelse return .{ .max_score = 0, .max_i = 0, .max_j = 0 };
    const curr_h_ptr = wasmAlloc(row_size) orelse return .{ .max_score = 0, .max_i = 0, .max_j = 0 };
    const prev_f_ptr = wasmAlloc(row_size) orelse return .{ .max_score = 0, .max_i = 0, .max_j = 0 };
    const curr_f_ptr = wasmAlloc(row_size) orelse return .{ .max_score = 0, .max_i = 0, .max_j = 0 };

    var prev_h: [*]i32 = @ptrCast(@alignCast(prev_h_ptr));
    var curr_h: [*]i32 = @ptrCast(@alignCast(curr_h_ptr));
    var prev_f: [*]i32 = @ptrCast(@alignCast(prev_f_ptr));
    var curr_f: [*]i32 = @ptrCast(@alignCast(curr_f_ptr));

    // Initialize
    for (0..n + 1) |j| {
        prev_h[j] = 0;
        prev_f[j] = std.math.minInt(i32) / 2;
    }

    var max_score: i32 = 0;
    var max_i: usize = 0;
    var max_j: usize = 0;

    for (1..m + 1) |i| {
        for (0..n + 1) |j| {
            curr_h[j] = 0;
            curr_f[j] = std.math.minInt(i32) / 2;
        }
        var e: i32 = std.math.minInt(i32) / 2;

        for (1..n + 1) |j| {
            const match_val = scoreMasks(query_masks[i - 1], target_masks[j - 1], match_score, mismatch_score);

            // E[i][j] = max(H[i][j-1] + gapOpen + gapExtend, E[i][j-1] + gapExtend)
            e = @max(
                curr_h[j - 1] + gap_open + gap_extend,
                e + gap_extend,
            );

            // F[i][j] = max(H[i-1][j] + gapOpen + gapExtend, F[i-1][j] + gapExtend)
            curr_f[j] = @max(
                prev_h[j] + gap_open + gap_extend,
                prev_f[j] + gap_extend,
            );

            // H[i][j] = max(0, H[i-1][j-1] + matchScore, E[i][j], F[i][j])
            curr_h[j] = @max(
                0,
                @max(
                    prev_h[j - 1] + match_val,
                    @max(e, curr_f[j]),
                ),
            );

            if (curr_h[j] > max_score) {
                max_score = curr_h[j];
                max_i = i;
                max_j = j;
            }
        }

        // Swap rows
        const tmp_h = prev_h;
        prev_h = curr_h;
        curr_h = tmp_h;

        const tmp_f = prev_f;
        prev_f = curr_f;
        curr_f = tmp_f;
    }

    return .{ .max_score = max_score, .max_i = max_i, .max_j = max_j };
}

// Find start point by backward scanning
fn findStartPointLinearSpace(
    query_masks: []const u8,
    target_masks: []const u8,
    max_i: usize,
    max_j: usize,
    match_score: i32,
    mismatch_score: i32,
    gap_open: i32,
    gap_extend: i32,
) struct { start_i: usize, start_j: usize } {
    // Reverse scan to find start
    const n = max_j;
    const mark = heapMark();
    defer resetHeapTo(mark);

    const row_size = (n + 1) * @sizeOf(i32);
    const prev_h_ptr = wasmAlloc(row_size) orelse return .{ .start_i = 0, .start_j = 0 };
    const curr_h_ptr = wasmAlloc(row_size) orelse return .{ .start_i = 0, .start_j = 0 };
    const prev_f_ptr = wasmAlloc(row_size) orelse return .{ .start_i = 0, .start_j = 0 };
    const curr_f_ptr = wasmAlloc(row_size) orelse return .{ .start_i = 0, .start_j = 0 };

    var prev_h: [*]i32 = @ptrCast(@alignCast(prev_h_ptr));
    var curr_h: [*]i32 = @ptrCast(@alignCast(curr_h_ptr));
    var prev_f: [*]i32 = @ptrCast(@alignCast(prev_f_ptr));
    var curr_f: [*]i32 = @ptrCast(@alignCast(curr_f_ptr));

    // Initialize
    for (0..n + 1) |j| {
        prev_h[j] = 0;
        prev_f[j] = std.math.minInt(i32) / 2;
    }

    var max_score_rev: i32 = 0;
    var end_rev_i: usize = 0;
    var end_rev_j: usize = 0;

    for (1..max_i + 1) |i| {
        for (0..n + 1) |j| {
            curr_h[j] = 0;
            curr_f[j] = std.math.minInt(i32) / 2;
        }
        var e: i32 = std.math.minInt(i32) / 2;
        const query_index = max_i - i;

        for (1..max_j + 1) |j| {
            const target_index = max_j - j;
            const match_val = scoreMasks(query_masks[query_index], target_masks[target_index], match_score, mismatch_score);

            e = @max(
                curr_h[j - 1] + gap_open + gap_extend,
                e + gap_extend,
            );

            curr_f[j] = @max(
                prev_h[j] + gap_open + gap_extend,
                prev_f[j] + gap_extend,
            );

            curr_h[j] = @max(
                0,
                @max(
                    prev_h[j - 1] + match_val,
                    @max(e, curr_f[j]),
                ),
            );

            if (curr_h[j] > max_score_rev) {
                max_score_rev = curr_h[j];
                end_rev_i = i;
                end_rev_j = j;
            }
        }

        // Swap
        const tmp_h = prev_h;
        prev_h = curr_h;
        curr_h = tmp_h;

        const tmp_f = prev_f;
        prev_f = curr_f;
        curr_f = tmp_f;
    }

    return .{
        .start_i = max_i - end_rev_i,
        .start_j = max_j - end_rev_j,
    };
}

// Compute last row scores for Hirschberg (global alignment on local region)
fn computeLastRowScores(
    query_masks: []const u8,
    target_masks: []const u8,
    match_score: i32,
    mismatch_score: i32,
    gap_open: i32,
    gap_extend: i32,
    out_scores: [*]i32,
) void {
    const m = query_masks.len;
    const n = target_masks.len;
    const mark = heapMark();
    defer resetHeapTo(mark);

    const row_size = (n + 1) * @sizeOf(i32);
    const prev_h_ptr = wasmAlloc(row_size) orelse return;
    const curr_h_ptr = wasmAlloc(row_size) orelse return;

    var prev_h: [*]i32 = @ptrCast(@alignCast(prev_h_ptr));
    var curr_h: [*]i32 = @ptrCast(@alignCast(curr_h_ptr));

    // Initialize for global alignment
    for (0..n + 1) |j| {
        prev_h[j] = if (j == 0) 0 else gap_open + @as(i32, @intCast(j)) * gap_extend;
    }

    for (1..m + 1) |i| {
        curr_h[0] = gap_open + @as(i32, @intCast(i)) * gap_extend;

        for (1..n + 1) |j| {
            const match_val = scoreMasks(query_masks[i - 1], target_masks[j - 1], match_score, mismatch_score);
            const diag = prev_h[j - 1] + match_val;
            const up = prev_h[j] + gap_open + gap_extend;
            const left = curr_h[j - 1] + gap_open + gap_extend;
            curr_h[j] = @max(diag, @max(up, left));
        }

        const tmp = prev_h;
        prev_h = curr_h;
        curr_h = tmp;
    }

    // Copy result
    for (0..n + 1) |j| {
        out_scores[j] = prev_h[j];
    }
}

// Compute backward scores for Hirschberg
fn computeBackwardScores(
    query_masks: []const u8,
    target_masks: []const u8,
    match_score: i32,
    mismatch_score: i32,
    gap_open: i32,
    gap_extend: i32,
    out_scores: [*]i32,
) void {
    const m = query_masks.len;
    const n = target_masks.len;
    const mark = heapMark();
    defer resetHeapTo(mark);

    const row_size = (n + 1) * @sizeOf(i32);
    const prev_h_ptr = wasmAlloc(row_size) orelse return;
    const curr_h_ptr = wasmAlloc(row_size) orelse return;

    var prev_h: [*]i32 = @ptrCast(@alignCast(prev_h_ptr));
    var curr_h: [*]i32 = @ptrCast(@alignCast(curr_h_ptr));

    // Initialize for backward global alignment
    for (0..n + 1) |j| {
        prev_h[j] = if (j == n) 0 else gap_open + @as(i32, @intCast(n - j)) * gap_extend;
    }

    var i: usize = m;
    while (i > 0) : (i -= 1) {
        curr_h[n] = gap_open + @as(i32, @intCast(m - i + 1)) * gap_extend;

        var j: usize = n;
        while (j > 0) : (j -= 1) {
            const match_val = scoreMasks(query_masks[i - 1], target_masks[j - 1], match_score, mismatch_score);
            const diag = prev_h[j] + match_val;
            const down = prev_h[j - 1] + gap_open + gap_extend;
            const right = curr_h[j] + gap_open + gap_extend;
            curr_h[j - 1] = @max(diag, @max(down, right));
        }

        const tmp = prev_h;
        prev_h = curr_h;
        curr_h = tmp;
    }

    // Copy result
    for (0..n + 1) |j| {
        out_scores[j] = prev_h[j];
    }
}

// Hirschberg alignment - writes aligned sequences to output buffers
fn hirschbergAlign(
    query_text: []const u8,
    query_masks: []const u8,
    target_text: []const u8,
    target_masks: []const u8,
    match_score: i32,
    mismatch_score: i32,
    gap_open: i32,
    gap_extend: i32,
    out_query: [*]u8,
    out_target: [*]u8,
    out_len: *usize,
) void {
    const m = query_text.len;
    const n = target_text.len;

    // Base cases
    if (m == 0) {
        for (0..n) |j| {
            out_query[out_len.*] = '-';
            out_target[out_len.*] = target_text[j];
            out_len.* += 1;
        }
        return;
    }

    if (n == 0) {
        for (0..m) |i| {
            out_query[out_len.*] = query_text[i];
            out_target[out_len.*] = '-';
            out_len.* += 1;
        }
        return;
    }

    if (m == 1) {
        // Find best position for single base
        var best_score: i32 = std.math.minInt(i32);
        var best_j: usize = 0;

        for (0..n) |j| {
            const match_val = scoreMasks(query_masks[0], target_masks[j], match_score, mismatch_score);
            const gaps_before: i32 = if (j > 0) gap_open + @as(i32, @intCast(j)) * gap_extend else 0;
            const gaps_after: i32 = if (j < n - 1) gap_open + @as(i32, @intCast(n - j - 1)) * gap_extend else 0;
            const score = gaps_before + match_val + gaps_after;

            if (score > best_score) {
                best_score = score;
                best_j = j;
            }
        }

        // Write alignment
        for (0..best_j) |j| {
            out_query[out_len.*] = '-';
            out_target[out_len.*] = target_text[j];
            out_len.* += 1;
        }
        out_query[out_len.*] = query_text[0];
        out_target[out_len.*] = target_text[best_j];
        out_len.* += 1;
        for (best_j + 1..n) |j| {
            out_query[out_len.*] = '-';
            out_target[out_len.*] = target_text[j];
            out_len.* += 1;
        }
        return;
    }

    if (n == 1) {
        var best_score: i32 = std.math.minInt(i32);
        var best_i: usize = 0;

        for (0..m) |i| {
            const match_val = scoreMasks(query_masks[i], target_masks[0], match_score, mismatch_score);
            const gaps_before: i32 = if (i > 0) gap_open + @as(i32, @intCast(i)) * gap_extend else 0;
            const gaps_after: i32 = if (i < m - 1) gap_open + @as(i32, @intCast(m - i - 1)) * gap_extend else 0;
            const score = gaps_before + match_val + gaps_after;

            if (score > best_score) {
                best_score = score;
                best_i = i;
            }
        }

        for (0..best_i) |i| {
            out_query[out_len.*] = query_text[i];
            out_target[out_len.*] = '-';
            out_len.* += 1;
        }
        out_query[out_len.*] = query_text[best_i];
        out_target[out_len.*] = target_text[0];
        out_len.* += 1;
        for (best_i + 1..m) |i| {
            out_query[out_len.*] = query_text[i];
            out_target[out_len.*] = '-';
            out_len.* += 1;
        }
        return;
    }

    // Divide
    const mid = m / 2;

    // Allocate score arrays
    const scores_size = (n + 1) * @sizeOf(i32);
    const score_mark = heapMark();
    const forward_ptr = wasmAlloc(scores_size) orelse {
        resetHeapTo(score_mark);
        return;
    };
    const backward_ptr = wasmAlloc(scores_size) orelse {
        resetHeapTo(score_mark);
        return;
    };

    const forward_scores: [*]i32 = @ptrCast(@alignCast(forward_ptr));
    const backward_scores: [*]i32 = @ptrCast(@alignCast(backward_ptr));

    computeLastRowScores(query_masks[0..mid], target_masks, match_score, mismatch_score, gap_open, gap_extend, forward_scores);
    computeBackwardScores(query_masks[mid..], target_masks, match_score, mismatch_score, gap_open, gap_extend, backward_scores);

    // Find best split point
    var best_j: usize = 0;
    var best_score: i32 = forward_scores[0] + backward_scores[0];

    for (0..n + 1) |j| {
        const score = forward_scores[j] + backward_scores[j];
        if (score >= best_score) {
            best_score = score;
            best_j = j;
        }
    }

    resetHeapTo(score_mark);

    // Recursive alignment
    hirschbergAlign(query_text[0..mid], query_masks[0..mid], target_text[0..best_j], target_masks[0..best_j], match_score, mismatch_score, gap_open, gap_extend, out_query, out_target, out_len);
    hirschbergAlign(query_text[mid..], query_masks[mid..], target_text[best_j..], target_masks[best_j..], match_score, mismatch_score, gap_open, gap_extend, out_query, out_target, out_len);
}

// Main linear-space alignment function. Writes aligned strings into caller-owned
// output buffers and scalar metadata into result.
pub export fn alignSequencesInto(
    query_ptr: [*]const u8,
    query_len: usize,
    target_ptr: [*]const u8,
    target_len: usize,
    query_out_ptr: [*]u8,
    target_out_ptr: [*]u8,
    out_capacity: usize,
    result: *AlignmentResultHeader,
    match_score: i32,
    mismatch_score: i32,
    gap_open: i32,
    gap_extend: i32,
) i32 {
    // NOTE: We do NOT reset the heap here because:
    // 1. The input pointers (query_ptr, target_ptr) may have been allocated from our heap
    // 2. The slices above still reference that memory
    // JS should call reset() before starting a new alignment to reclaim memory

    // Handle empty sequences
    if (query_len == 0 or target_len == 0) {
        writeEmptyResult(result);
        return STATUS_OK;
    }

    const query = normalizeSequence(query_ptr[0..query_len]) orelse return STATUS_OUT_OF_MEMORY;
    const target = normalizeSequence(target_ptr[0..target_len]) orelse return STATUS_OUT_OF_MEMORY;

    // Find max score and endpoint
    const max_result = findMaxScoreLinearSpace(query.masks, target.masks, match_score, mismatch_score, gap_open, gap_extend);

    if (max_result.max_score == 0) {
        writeEmptyResult(result);
        return STATUS_OK;
    }

    // Find start point
    const start_result = findStartPointLinearSpace(
        query.masks,
        target.masks,
        max_result.max_i,
        max_result.max_j,
        match_score,
        mismatch_score,
        gap_open,
        gap_extend,
    );

    // Allocate output buffers (max size is sum of local region lengths)
    const local_query_text = query.text[start_result.start_i..max_result.max_i];
    const local_query_masks = query.masks[start_result.start_i..max_result.max_i];
    const local_target_text = target.text[start_result.start_j..max_result.max_j];
    const local_target_masks = target.masks[start_result.start_j..max_result.max_j];
    const max_aligned_len = local_query_text.len + local_target_text.len;
    if (max_aligned_len > out_capacity) {
        return STATUS_OUTPUT_TOO_SMALL;
    }

    var aligned_len: usize = 0;
    hirschbergAlign(
        local_query_text,
        local_query_masks,
        local_target_text,
        local_target_masks,
        match_score,
        mismatch_score,
        gap_open,
        gap_extend,
        query_out_ptr,
        target_out_ptr,
        &aligned_len,
    );

    // Calculate identity
    var matches: usize = 0;
    var non_gap_positions: usize = 0;
    for (0..aligned_len) |i| {
        if (query_out_ptr[i] != '-' and target_out_ptr[i] != '-') {
            non_gap_positions += 1;
            if (query_out_ptr[i] == target_out_ptr[i]) {
                matches += 1;
            }
        }
    }

    const identity: f64 = if (non_gap_positions > 0)
        @round(@as(f64, @floatFromInt(matches)) / @as(f64, @floatFromInt(non_gap_positions)) * 1000.0) / 10.0
    else
        0;

    result.* = AlignmentResultHeader{
        .score = max_result.max_score,
        .query_start = @intCast(start_result.start_i),
        .query_end = @intCast(max_result.max_i),
        .target_start = @intCast(start_result.start_j),
        .target_end = @intCast(max_result.max_j),
        .query_aligned_len = @intCast(aligned_len),
        .target_aligned_len = @intCast(aligned_len),
        .target_origin_offset = 0,
        .identity = identity,
    };

    return STATUS_OK;
}

fn absDiff(a: usize, b: usize) usize {
    return if (a > b) a - b else b - a;
}

fn maxAlignedLenFor(query_len: usize, target_len: usize) usize {
    return query_len + target_len;
}

fn bandIndex(i: usize, j: usize, band_width: usize) ?usize {
    if (j >= i) {
        return band_width + (j - i);
    }

    const delta = i - j;
    if (delta > band_width) return null;
    return band_width - delta;
}

fn reverseBytes(bytes: []u8) void {
    if (bytes.len <= 1) return;
    var left: usize = 0;
    var right: usize = bytes.len - 1;
    while (left < right) {
        const tmp = bytes[left];
        bytes[left] = bytes[right];
        bytes[right] = tmp;
        left += 1;
        right -= 1;
    }
}

// Banded Smith-Waterman local alignment. Returns null when the band is unsafe,
// allowing JS to retry with the canonical linear implementation.
pub export fn alignSequencesBandedInto(
    query_ptr: [*]const u8,
    query_len: usize,
    target_ptr: [*]const u8,
    target_len: usize,
    query_out_ptr: [*]u8,
    target_out_ptr: [*]u8,
    out_capacity: usize,
    result: *AlignmentResultHeader,
    match_score: i32,
    mismatch_score: i32,
    gap_open: i32,
    gap_extend: i32,
    requested_band_width: usize,
) i32 {
    if (query_len == 0 or target_len == 0) {
        writeEmptyResult(result);
        return STATUS_OK;
    }

    const band_width = if (requested_band_width == 0) DEFAULT_BAND_WIDTH else requested_band_width;
    if (absDiff(query_len, target_len) > band_width) {
        return STATUS_BAND_UNSAFE;
    }

    const query = normalizeSequence(query_ptr[0..query_len]) orelse return STATUS_OUT_OF_MEMORY;
    const target = normalizeSequence(target_ptr[0..target_len]) orelse return STATUS_OUT_OF_MEMORY;
    const m = query.masks.len;
    const n = target.masks.len;
    const width = band_width * 2 + 1;
    const total_cells = (m + 1) * width;

    const row_size = width * @sizeOf(i32);
    const trace_size = total_cells * @sizeOf(u8);

    const trace_h_ptr = wasmAlloc(trace_size) orelse return STATUS_OUT_OF_MEMORY;
    const trace_e_ptr = wasmAlloc(trace_size) orelse return STATUS_OUT_OF_MEMORY;
    const trace_f_ptr = wasmAlloc(trace_size) orelse return STATUS_OUT_OF_MEMORY;
    const prev_h_ptr = wasmAlloc(row_size) orelse return STATUS_OUT_OF_MEMORY;
    const curr_h_ptr = wasmAlloc(row_size) orelse return STATUS_OUT_OF_MEMORY;
    const prev_e_ptr = wasmAlloc(row_size) orelse return STATUS_OUT_OF_MEMORY;
    const curr_e_ptr = wasmAlloc(row_size) orelse return STATUS_OUT_OF_MEMORY;
    const prev_f_ptr = wasmAlloc(row_size) orelse return STATUS_OUT_OF_MEMORY;
    const curr_f_ptr = wasmAlloc(row_size) orelse return STATUS_OUT_OF_MEMORY;

    const trace_h = trace_h_ptr[0..trace_size];
    const trace_e = trace_e_ptr[0..trace_size];
    const trace_f = trace_f_ptr[0..trace_size];
    @memset(trace_h, TRACE_STOP);
    @memset(trace_e, TRACE_STOP);
    @memset(trace_f, TRACE_STOP);

    var prev_h: [*]i32 = @ptrCast(@alignCast(prev_h_ptr));
    var curr_h: [*]i32 = @ptrCast(@alignCast(curr_h_ptr));
    var prev_e: [*]i32 = @ptrCast(@alignCast(prev_e_ptr));
    var curr_e: [*]i32 = @ptrCast(@alignCast(curr_e_ptr));
    var prev_f: [*]i32 = @ptrCast(@alignCast(prev_f_ptr));
    var curr_f: [*]i32 = @ptrCast(@alignCast(curr_f_ptr));

    for (0..width) |k| {
        prev_h[k] = NEGATIVE_INFINITY;
        prev_e[k] = NEGATIVE_INFINITY;
        prev_f[k] = NEGATIVE_INFINITY;
    }
    for (0..@min(n, band_width) + 1) |j| {
        prev_h[j + band_width] = 0;
    }

    var max_score: i32 = 0;
    var max_i: usize = 0;
    var max_j: usize = 0;

    for (1..m + 1) |i| {
        for (0..width) |k| {
            curr_h[k] = NEGATIVE_INFINITY;
            curr_e[k] = NEGATIVE_INFINITY;
            curr_f[k] = NEGATIVE_INFINITY;
        }

        if (i <= band_width) {
            curr_h[band_width - i] = 0;
        }

        const j_start = @max(@as(usize, 1), i -| band_width);
        const j_end = @min(n, i + band_width);
        const query_mask = query.masks[i - 1];

        var j = j_start;
        while (j <= j_end) : (j += 1) {
            const k = bandIndex(i, j, band_width) orelse return STATUS_BAND_UNSAFE;
            const flat = i * width + k;

            const from_left_h = if (k > 0) curr_h[k - 1] + gap_open + gap_extend else NEGATIVE_INFINITY;
            const from_left_e = if (k > 0) curr_e[k - 1] + gap_extend else NEGATIVE_INFINITY;
            if (from_left_h >= from_left_e) {
                curr_e[k] = from_left_h;
                trace_e[flat] = TRACE_H;
            } else {
                curr_e[k] = from_left_e;
                trace_e[flat] = TRACE_E;
            }

            const from_up_h = if (k + 1 < width) prev_h[k + 1] + gap_open + gap_extend else NEGATIVE_INFINITY;
            const from_up_f = if (k + 1 < width) prev_f[k + 1] + gap_extend else NEGATIVE_INFINITY;
            if (from_up_h >= from_up_f) {
                curr_f[k] = from_up_h;
                trace_f[flat] = TRACE_H;
            } else {
                curr_f[k] = from_up_f;
                trace_f[flat] = TRACE_F;
            }

            const diag = prev_h[k] + scoreMasks(query_mask, target.masks[j - 1], match_score, mismatch_score);
            var score: i32 = 0;
            var trace: u8 = TRACE_STOP;

            if (diag > score) {
                score = diag;
                trace = TRACE_DIAG;
            }
            if (curr_e[k] > score) {
                score = curr_e[k];
                trace = TRACE_E;
            }
            if (curr_f[k] >= score) {
                score = curr_f[k];
                trace = TRACE_F;
            }

            curr_h[k] = score;
            trace_h[flat] = trace;

            if (score > max_score) {
                max_score = score;
                max_i = i;
                max_j = j;
            }
        }

        const tmp_h = prev_h;
        prev_h = curr_h;
        curr_h = tmp_h;

        const tmp_e = prev_e;
        prev_e = curr_e;
        curr_e = tmp_e;

        const tmp_f = prev_f;
        prev_f = curr_f;
        curr_f = tmp_f;
    }

    if (max_score == 0) {
        writeEmptyResult(result);
        return STATUS_OK;
    }

    const max_aligned_len = maxAlignedLenFor(m, n);
    if (max_aligned_len > out_capacity) {
        return STATUS_OUTPUT_TOO_SMALL;
    }

    var aligned_len: usize = 0;
    var matches: usize = 0;
    var non_gap_positions: usize = 0;
    var i = max_i;
    var j = max_j;
    var state: u8 = TRACE_H;
    var touched_band_edge = false;

    while (i > 0 and j > 0) {
        const k = bandIndex(i, j, band_width) orelse return STATUS_BAND_UNSAFE;
        if (k >= width) return STATUS_BAND_UNSAFE;
        if (k == 0 or k == width - 1) {
            touched_band_edge = true;
        }

        const flat = i * width + k;

        if (state == TRACE_H) {
            const trace = trace_h[flat];
            if (trace == TRACE_STOP) break;
            state = trace;
            continue;
        }

        if (state == TRACE_DIAG) {
            const query_base = query.text[i - 1];
            const target_base = target.text[j - 1];
            query_out_ptr[aligned_len] = query_base;
            target_out_ptr[aligned_len] = target_base;
            aligned_len += 1;
            non_gap_positions += 1;
            if (query_base == target_base) {
                matches += 1;
            }
            i -= 1;
            j -= 1;
            state = TRACE_H;
            continue;
        }

        if (state == TRACE_E) {
            query_out_ptr[aligned_len] = '-';
            target_out_ptr[aligned_len] = target.text[j - 1];
            aligned_len += 1;
            state = trace_e[flat];
            j -= 1;
            continue;
        }

        if (state == TRACE_F) {
            query_out_ptr[aligned_len] = query.text[i - 1];
            target_out_ptr[aligned_len] = '-';
            aligned_len += 1;
            state = trace_f[flat];
            i -= 1;
            continue;
        }

        return STATUS_BAND_UNSAFE;
    }

    if (touched_band_edge) {
        return STATUS_BAND_UNSAFE;
    }

    reverseBytes(query_out_ptr[0..aligned_len]);
    reverseBytes(target_out_ptr[0..aligned_len]);

    const identity: f64 = if (non_gap_positions > 0)
        @round(@as(f64, @floatFromInt(matches)) / @as(f64, @floatFromInt(non_gap_positions)) * 1000.0) / 10.0
    else
        0;

    result.* = AlignmentResultHeader{
        .score = max_score,
        .query_start = @intCast(i),
        .query_end = @intCast(max_i),
        .target_start = @intCast(j),
        .target_end = @intCast(max_j),
        .query_aligned_len = @intCast(aligned_len),
        .target_aligned_len = @intCast(aligned_len),
        .target_origin_offset = 0,
        .identity = identity,
    };

    return STATUS_OK;
}

// Circular target alignment. Estimates the target origin offset, virtually
// rotates the target, then uses the banded path with linear fallback.
pub export fn alignSequencesBandedCircularInto(
    query_ptr: [*]const u8,
    query_len: usize,
    target_ptr: [*]const u8,
    target_len: usize,
    query_out_ptr: [*]u8,
    target_out_ptr: [*]u8,
    out_capacity: usize,
    result: *AlignmentResultHeader,
    match_score: i32,
    mismatch_score: i32,
    gap_open: i32,
    gap_extend: i32,
    requested_band_width: usize,
    requested_kmer_size: usize,
    requested_min_votes: u32,
) i32 {
    if (query_len == 0 or target_len == 0) {
        writeEmptyResult(result);
        return STATUS_OK;
    }

    const query = normalizeSequence(query_ptr[0..query_len]) orelse return STATUS_OUT_OF_MEMORY;
    const target = normalizeSequence(target_ptr[0..target_len]) orelse return STATUS_OUT_OF_MEMORY;
    const offset = estimateCircularTargetOffset(query.text, target.text, requested_kmer_size, requested_min_votes);

    const rotated_target_ptr = if (offset == 0)
        target_ptr
    else
        (rotateBytes(target.text, offset) orelse return STATUS_OUT_OF_MEMORY);

    var status = alignSequencesBandedInto(
        query_ptr,
        query_len,
        rotated_target_ptr,
        target_len,
        query_out_ptr,
        target_out_ptr,
        out_capacity,
        result,
        match_score,
        mismatch_score,
        gap_open,
        gap_extend,
        requested_band_width,
    );

    if (status == STATUS_BAND_UNSAFE) {
        status = alignSequencesInto(
            query_ptr,
            query_len,
            rotated_target_ptr,
            target_len,
            query_out_ptr,
            target_out_ptr,
            out_capacity,
            result,
            match_score,
            mismatch_score,
            gap_open,
            gap_extend,
        );
    }

    if (status == STATUS_OK) {
        applyTargetOriginOffset(result, offset);
    }

    return status;
}

// Memory management exports for JS
pub export fn reset() void {
    resetHeap();
}

pub export fn alloc(size: usize) ?[*]u8 {
    return wasmAlloc(size);
}

export fn free(ptr: [*]u8) void {
    _ = ptr;
    // No-op for bump allocator
}

// ---------------------------------------------------------------------------
// Basic unit tests (white-box)
//
// These compile for the HOST (`zig test alignment.zig`), not wasm32. They reach
// directly into internal helpers to test them in isolation. Broader end-to-end
// alignment scenarios that drive the WASM ABI live in alignment_test.zig.
// ---------------------------------------------------------------------------

const testing = std.testing;

const UNIT_PLASMID = "ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATCAGTTACGGATCCGTACGTTAGCGCATTAGCCGATCGGATCCATGCATGCTAGCTAGGCATGCA";

fn rotateComptime(comptime s: []const u8, comptime n: usize) [s.len]u8 {
    var out: [s.len]u8 = undefined;
    for (0..s.len) |i| out[i] = s[(i + n) % s.len];
    return out;
}

test "normalizeSequence uppercases and masks single bases" {
    resetHeap();
    const ns = normalizeSequence("acgt").?;
    try testing.expectEqualSlices(u8, "ACGT", ns.text);
    try testing.expectEqual(MASK_A, ns.masks[0]);
    try testing.expectEqual(MASK_C, ns.masks[1]);
    try testing.expectEqual(MASK_G, ns.masks[2]);
    try testing.expectEqual(MASK_T, ns.masks[3]);
}

test "scoreMasks: match, mismatch, and ambiguous overlap" {
    // exact single-base match
    try testing.expectEqual(@as(i32, 2), scoreMasks(MASK_A, MASK_A, 2, -1));
    // disjoint -> mismatch
    try testing.expectEqual(@as(i32, -1), scoreMasks(MASK_A, MASK_C, 2, -1));
    // ambiguous overlap (N vs A) -> partial credit of 1
    try testing.expectEqual(@as(i32, 1), scoreMasks(MASK_A | MASK_C | MASK_G | MASK_T, MASK_A, 2, -1));
}

test "estimateCircularTargetOffset recovers a 37bp rotation" {
    const rotated = comptime rotateComptime(UNIT_PLASMID, 37);
    resetHeap();
    const q = normalizeSequence(&rotated).?;
    const t = normalizeSequence(UNIT_PLASMID).?;
    const offset = estimateCircularTargetOffset(q.text, t.text, DEFAULT_ORIGIN_KMER_SIZE, DEFAULT_ORIGIN_MIN_VOTES);
    try testing.expectEqual(@as(usize, 37), offset);
}

test "estimateCircularTargetOffset returns 0 when no rotation" {
    resetHeap();
    const q = normalizeSequence(UNIT_PLASMID).?;
    const t = normalizeSequence(UNIT_PLASMID).?;
    const offset = estimateCircularTargetOffset(q.text, t.text, DEFAULT_ORIGIN_KMER_SIZE, DEFAULT_ORIGIN_MIN_VOTES);
    try testing.expectEqual(@as(usize, 0), offset);
}
