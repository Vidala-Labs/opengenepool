///! Linear-Space Smith-Waterman Local Pairwise Alignment
///!
///! Implements Hirschberg-style divide-and-conquer for O(n) space complexity.
///! Exports functions for WASM integration with JavaScript.
///!
///! Zig version: 0.15.x
const std = @import("std");

// WASM allocator using a simple bump allocator
// Keep heap small - we reset it on each align call anyway
var heap: [4 * 1024 * 1024]u8 = undefined; // 4MB heap
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

const NormalizedSequence = struct {
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

fn scoreMasks(mask1: u8, mask2: u8, match_score: i32, mismatch_score: i32) i32 {
    if ((mask1 & mask2) == 0) {
        return mismatch_score;
    }

    if (mask1 == mask2 and isSingleBaseMask(mask1)) {
        return match_score;
    }

    return 1;
}

fn normalizeSequence(sequence: []const u8) ?NormalizedSequence {
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

// Result structure for alignment
// Layout must match JS reader expectations (all i32s packed, then f64 at 8-byte aligned offset)
pub const AlignmentResult = extern struct {
    score: i32, // offset 0
    query_start: i32, // offset 4
    query_end: i32, // offset 8
    target_start: i32, // offset 12
    target_end: i32, // offset 16
    query_aligned_ptr: u32, // offset 20 (using u32 instead of pointer for explicit 4-byte size)
    query_aligned_len: i32, // offset 24
    target_aligned_ptr: u32, // offset 28
    target_aligned_len: i32, // offset 32
    _padding: u32 = 0, // offset 36 (padding for f64 alignment)
    identity: f64, // offset 40
};

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

// Main alignment function exported to WASM
export fn alignSequences(
    query_ptr: [*]const u8,
    query_len: usize,
    target_ptr: [*]const u8,
    target_len: usize,
    match_score: i32,
    mismatch_score: i32,
    gap_open: i32,
    gap_extend: i32,
) ?*AlignmentResult {
    // NOTE: We do NOT reset the heap here because:
    // 1. The input pointers (query_ptr, target_ptr) may have been allocated from our heap
    // 2. The slices above still reference that memory
    // JS should call reset() before starting a new alignment to reclaim memory

    // Handle empty sequences
    if (query_len == 0 or target_len == 0) {
        const result_ptr = wasmAlloc(@sizeOf(AlignmentResult)) orelse return null;
        const result: *AlignmentResult = @ptrCast(@alignCast(result_ptr));
        result.* = AlignmentResult{
            .score = 0,
            .query_start = 0,
            .query_end = 0,
            .target_start = 0,
            .target_end = 0,
            .query_aligned_ptr = 0,
            .query_aligned_len = 0,
            .target_aligned_ptr = 0,
            .target_aligned_len = 0,
            .identity = 0,
        };
        return result;
    }

    const query = normalizeSequence(query_ptr[0..query_len]) orelse return null;
    const target = normalizeSequence(target_ptr[0..target_len]) orelse return null;

    // Find max score and endpoint
    const max_result = findMaxScoreLinearSpace(query.masks, target.masks, match_score, mismatch_score, gap_open, gap_extend);

    if (max_result.max_score == 0) {
        const result_ptr = wasmAlloc(@sizeOf(AlignmentResult)) orelse return null;
        const result: *AlignmentResult = @ptrCast(@alignCast(result_ptr));
        result.* = AlignmentResult{
            .score = 0,
            .query_start = 0,
            .query_end = 0,
            .target_start = 0,
            .target_end = 0,
            .query_aligned_ptr = 0,
            .query_aligned_len = 0,
            .target_aligned_ptr = 0,
            .target_aligned_len = 0,
            .identity = 0,
        };
        return result;
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

    const query_aligned_ptr = wasmAlloc(max_aligned_len) orelse return null;
    const target_aligned_ptr = wasmAlloc(max_aligned_len) orelse return null;

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
        query_aligned_ptr,
        target_aligned_ptr,
        &aligned_len,
    );

    // Calculate identity
    var matches: usize = 0;
    var non_gap_positions: usize = 0;
    for (0..aligned_len) |i| {
        if (query_aligned_ptr[i] != '-' and target_aligned_ptr[i] != '-') {
            non_gap_positions += 1;
            if (query_aligned_ptr[i] == target_aligned_ptr[i]) {
                matches += 1;
            }
        }
    }

    const identity: f64 = if (non_gap_positions > 0)
        @round(@as(f64, @floatFromInt(matches)) / @as(f64, @floatFromInt(non_gap_positions)) * 1000.0) / 10.0
    else
        0;

    // Allocate and fill result
    const result_ptr = wasmAlloc(@sizeOf(AlignmentResult)) orelse return null;
    const result: *AlignmentResult = @ptrCast(@alignCast(result_ptr));

    result.* = AlignmentResult{
        .score = max_result.max_score,
        .query_start = @intCast(start_result.start_i),
        .query_end = @intCast(max_result.max_i),
        .target_start = @intCast(start_result.start_j),
        .target_end = @intCast(max_result.max_j),
        .query_aligned_ptr = @intFromPtr(query_aligned_ptr),
        .query_aligned_len = @intCast(aligned_len),
        .target_aligned_ptr = @intFromPtr(target_aligned_ptr),
        .target_aligned_len = @intCast(aligned_len),
        .identity = identity,
    };

    return result;
}

// Memory management exports for JS
export fn reset() void {
    resetHeap();
}

export fn alloc(size: usize) ?[*]u8 {
    return wasmAlloc(size);
}

export fn free(ptr: [*]u8) void {
    _ = ptr;
    // No-op for bump allocator
}

export fn freeResult(ptr: *AlignmentResult) void {
    _ = ptr;
    // No-op for bump allocator - heap is reset on next align call
}
