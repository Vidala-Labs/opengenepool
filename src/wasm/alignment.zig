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

// IUPAC code support
const IupacSet = packed struct {
    A: bool = false,
    T: bool = false,
    G: bool = false,
    C: bool = false,

    fn intersects(self: IupacSet, other: IupacSet) bool {
        return (self.A and other.A) or
            (self.T and other.T) or
            (self.G and other.G) or
            (self.C and other.C);
    }

    fn isSingleBase(self: IupacSet) bool {
        const count: u8 = @intFromBool(self.A) + @intFromBool(self.T) +
            @intFromBool(self.G) + @intFromBool(self.C);
        return count == 1;
    }

    fn eql(self: IupacSet, other: IupacSet) bool {
        return self.A == other.A and self.T == other.T and
            self.G == other.G and self.C == other.C;
    }
};

fn getIupacSet(base: u8) IupacSet {
    const upper = if (base >= 'a' and base <= 'z') base - 32 else base;
    return switch (upper) {
        'A' => IupacSet{ .A = true },
        'T' => IupacSet{ .T = true },
        'G' => IupacSet{ .G = true },
        'C' => IupacSet{ .C = true },
        'N' => IupacSet{ .A = true, .T = true, .G = true, .C = true },
        'R' => IupacSet{ .A = true, .G = true },
        'Y' => IupacSet{ .C = true, .T = true },
        'S' => IupacSet{ .G = true, .C = true },
        'W' => IupacSet{ .A = true, .T = true },
        'K' => IupacSet{ .G = true, .T = true },
        'M' => IupacSet{ .A = true, .C = true },
        'B' => IupacSet{ .C = true, .G = true, .T = true },
        'D' => IupacSet{ .A = true, .G = true, .T = true },
        'H' => IupacSet{ .A = true, .C = true, .T = true },
        'V' => IupacSet{ .A = true, .C = true, .G = true },
        else => IupacSet{},
    };
}

fn scoreMatch(base1: u8, base2: u8, match_score: i32, mismatch_score: i32) i32 {
    const set1 = getIupacSet(base1);
    const set2 = getIupacSet(base2);

    if (!set1.intersects(set2)) {
        return mismatch_score;
    }

    // Exact match
    if (set1.isSingleBase() and set2.isSingleBase() and set1.eql(set2)) {
        return match_score;
    }

    // Ambiguous match
    return 1;
}

// Result structure for alignment
// Layout must match JS reader expectations (all i32s packed, then f64 at 8-byte aligned offset)
pub const AlignmentResult = extern struct {
    score: i32,              // offset 0
    query_start: i32,        // offset 4
    query_end: i32,          // offset 8
    target_start: i32,       // offset 12
    target_end: i32,         // offset 16
    query_aligned_ptr: u32,  // offset 20 (using u32 instead of pointer for explicit 4-byte size)
    query_aligned_len: i32,  // offset 24
    target_aligned_ptr: u32, // offset 28
    target_aligned_len: i32, // offset 32
    _padding: u32 = 0,       // offset 36 (padding for f64 alignment)
    identity: f64,           // offset 40
};

// Find max score and endpoint using linear space
fn findMaxScoreLinearSpace(
    query: []const u8,
    target: []const u8,
    match_score: i32,
    mismatch_score: i32,
    gap_open: i32,
    gap_extend: i32,
) struct { max_score: i32, max_i: usize, max_j: usize } {
    const m = query.len;
    const n = target.len;

    // Allocate rows using our heap
    const row_size = (n + 1) * @sizeOf(i32);
    const prev_h_ptr = wasmAlloc(row_size) orelse return .{ .max_score = 0, .max_i = 0, .max_j = 0 };
    const curr_h_ptr = wasmAlloc(row_size) orelse return .{ .max_score = 0, .max_i = 0, .max_j = 0 };
    const prev_e_ptr = wasmAlloc(row_size) orelse return .{ .max_score = 0, .max_i = 0, .max_j = 0 };
    const curr_e_ptr = wasmAlloc(row_size) orelse return .{ .max_score = 0, .max_i = 0, .max_j = 0 };

    var prev_h: [*]i32 = @alignCast(@ptrCast(prev_h_ptr));
    var curr_h: [*]i32 = @alignCast(@ptrCast(curr_h_ptr));
    var prev_e: [*]i32 = @alignCast(@ptrCast(prev_e_ptr));
    var curr_e: [*]i32 = @alignCast(@ptrCast(curr_e_ptr));

    // Initialize
    for (0..n + 1) |j| {
        prev_h[j] = 0;
        prev_e[j] = std.math.minInt(i32) / 2;
    }

    var max_score: i32 = 0;
    var max_i: usize = 0;
    var max_j: usize = 0;

    for (1..m + 1) |i| {
        for (0..n + 1) |j| {
            curr_h[j] = 0;
            curr_e[j] = std.math.minInt(i32) / 2;
        }
        var f: i32 = std.math.minInt(i32) / 2;

        for (1..n + 1) |j| {
            const match_val = scoreMatch(query[i - 1], target[j - 1], match_score, mismatch_score);

            // E[i][j] = max(H[i][j-1] + gapOpen + gapExtend, E[i][j-1] + gapExtend)
            curr_e[j] = @max(
                curr_h[j - 1] + gap_open + gap_extend,
                curr_e[j - 1] + gap_extend,
            );

            // F[i][j] = max(H[i-1][j] + gapOpen + gapExtend, F[i-1][j] + gapExtend)
            f = @max(
                prev_h[j] + gap_open + gap_extend,
                f + gap_extend,
            );

            // H[i][j] = max(0, H[i-1][j-1] + matchScore, E[i][j], F[i][j])
            curr_h[j] = @max(
                0,
                @max(
                    prev_h[j - 1] + match_val,
                    @max(curr_e[j], f),
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

        const tmp_e = prev_e;
        prev_e = curr_e;
        curr_e = tmp_e;
    }

    return .{ .max_score = max_score, .max_i = max_i, .max_j = max_j };
}

// Find start point by backward scanning
fn findStartPointLinearSpace(
    query: []const u8,
    target: []const u8,
    max_i: usize,
    max_j: usize,
    match_score: i32,
    mismatch_score: i32,
    gap_open: i32,
    gap_extend: i32,
) struct { start_i: usize, start_j: usize } {
    // Reverse scan to find start
    const n = max_j;

    const row_size = (n + 1) * @sizeOf(i32);
    const prev_h_ptr = wasmAlloc(row_size) orelse return .{ .start_i = 0, .start_j = 0 };
    const curr_h_ptr = wasmAlloc(row_size) orelse return .{ .start_i = 0, .start_j = 0 };
    const prev_e_ptr = wasmAlloc(row_size) orelse return .{ .start_i = 0, .start_j = 0 };
    const curr_e_ptr = wasmAlloc(row_size) orelse return .{ .start_i = 0, .start_j = 0 };

    var prev_h: [*]i32 = @alignCast(@ptrCast(prev_h_ptr));
    var curr_h: [*]i32 = @alignCast(@ptrCast(curr_h_ptr));
    var prev_e: [*]i32 = @alignCast(@ptrCast(prev_e_ptr));
    var curr_e: [*]i32 = @alignCast(@ptrCast(curr_e_ptr));

    // Initialize
    for (0..n + 1) |j| {
        prev_h[j] = 0;
        prev_e[j] = std.math.minInt(i32) / 2;
    }

    var max_score_rev: i32 = 0;
    var end_rev_i: usize = 0;
    var end_rev_j: usize = 0;

    // Process in reverse
    var i: usize = max_i;
    while (i > 0) : (i -= 1) {
        for (0..n + 1) |j| {
            curr_h[j] = 0;
            curr_e[j] = std.math.minInt(i32) / 2;
        }
        var f: i32 = std.math.minInt(i32) / 2;

        var j: usize = max_j;
        while (j > 0) : (j -= 1) {
            const match_val = scoreMatch(query[i - 1], target[j - 1], match_score, mismatch_score);

            curr_e[j - 1] = @max(
                curr_h[j] + gap_open + gap_extend,
                curr_e[j] + gap_extend,
            );

            f = @max(
                prev_h[j - 1] + gap_open + gap_extend,
                f + gap_extend,
            );

            curr_h[j - 1] = @max(
                0,
                @max(
                    prev_h[j] + match_val,
                    @max(curr_e[j - 1], f),
                ),
            );

            if (curr_h[j - 1] > max_score_rev) {
                max_score_rev = curr_h[j - 1];
                end_rev_i = max_i - i + 1;
                end_rev_j = max_j - j + 1;
            }
        }

        // Swap
        const tmp_h = prev_h;
        prev_h = curr_h;
        curr_h = tmp_h;

        const tmp_e = prev_e;
        prev_e = curr_e;
        curr_e = tmp_e;
    }

    return .{
        .start_i = max_i - end_rev_i,
        .start_j = max_j - end_rev_j,
    };
}

// Compute last row scores for Hirschberg (global alignment on local region)
fn computeLastRowScores(
    query: []const u8,
    target: []const u8,
    match_score: i32,
    mismatch_score: i32,
    gap_open: i32,
    gap_extend: i32,
    out_scores: [*]i32,
) void {
    const m = query.len;
    const n = target.len;

    const row_size = (n + 1) * @sizeOf(i32);
    const prev_h_ptr = wasmAlloc(row_size) orelse return;
    const curr_h_ptr = wasmAlloc(row_size) orelse return;

    var prev_h: [*]i32 = @alignCast(@ptrCast(prev_h_ptr));
    var curr_h: [*]i32 = @alignCast(@ptrCast(curr_h_ptr));

    // Initialize for global alignment
    for (0..n + 1) |j| {
        prev_h[j] = if (j == 0) 0 else gap_open + @as(i32, @intCast(j)) * gap_extend;
    }

    for (1..m + 1) |i| {
        curr_h[0] = gap_open + @as(i32, @intCast(i)) * gap_extend;

        for (1..n + 1) |j| {
            const match_val = scoreMatch(query[i - 1], target[j - 1], match_score, mismatch_score);
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
    query: []const u8,
    target: []const u8,
    match_score: i32,
    mismatch_score: i32,
    gap_open: i32,
    gap_extend: i32,
    out_scores: [*]i32,
) void {
    const m = query.len;
    const n = target.len;

    const row_size = (n + 1) * @sizeOf(i32);
    const prev_h_ptr = wasmAlloc(row_size) orelse return;
    const curr_h_ptr = wasmAlloc(row_size) orelse return;

    var prev_h: [*]i32 = @alignCast(@ptrCast(prev_h_ptr));
    var curr_h: [*]i32 = @alignCast(@ptrCast(curr_h_ptr));

    // Initialize for backward global alignment
    for (0..n + 1) |j| {
        prev_h[j] = if (j == n) 0 else gap_open + @as(i32, @intCast(n - j)) * gap_extend;
    }

    var i: usize = m;
    while (i > 0) : (i -= 1) {
        curr_h[n] = gap_open + @as(i32, @intCast(m - i + 1)) * gap_extend;

        var j: usize = n;
        while (j > 0) : (j -= 1) {
            const match_val = scoreMatch(query[i - 1], target[j - 1], match_score, mismatch_score);
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
    query: []const u8,
    target: []const u8,
    match_score: i32,
    mismatch_score: i32,
    gap_open: i32,
    gap_extend: i32,
    out_query: [*]u8,
    out_target: [*]u8,
    out_len: *usize,
) void {
    const m = query.len;
    const n = target.len;

    // Base cases
    if (m == 0) {
        for (0..n) |j| {
            out_query[out_len.*] = '-';
            out_target[out_len.*] = target[j];
            out_len.* += 1;
        }
        return;
    }

    if (n == 0) {
        for (0..m) |i| {
            out_query[out_len.*] = query[i];
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
            const match_val = scoreMatch(query[0], target[j], match_score, mismatch_score);
            const gaps_before: i32 = if (j > 0) gap_open + @as(i32, @intCast(j)) * gap_extend else 0;
            const gaps_after: i32 = if (j < n - 1) gap_open + @as(i32, @intCast(n - j - 1)) * gap_extend else 0;
            const score = gaps_before + match_val + gaps_after;

            if (score > best_score) {
                best_score = score;
                best_j = j;
            }
        }

        // Write alignment
        for (0..best_j) |_| {
            out_query[out_len.*] = '-';
            out_target[out_len.*] = target[out_len.*];
            out_len.* += 1;
        }
        out_query[out_len.*] = query[0];
        out_target[out_len.*] = target[best_j];
        out_len.* += 1;
        for (best_j + 1..n) |j| {
            out_query[out_len.*] = '-';
            out_target[out_len.*] = target[j];
            out_len.* += 1;
        }
        return;
    }

    if (n == 1) {
        var best_score: i32 = std.math.minInt(i32);
        var best_i: usize = 0;

        for (0..m) |i| {
            const match_val = scoreMatch(query[i], target[0], match_score, mismatch_score);
            const gaps_before: i32 = if (i > 0) gap_open + @as(i32, @intCast(i)) * gap_extend else 0;
            const gaps_after: i32 = if (i < m - 1) gap_open + @as(i32, @intCast(m - i - 1)) * gap_extend else 0;
            const score = gaps_before + match_val + gaps_after;

            if (score > best_score) {
                best_score = score;
                best_i = i;
            }
        }

        for (0..best_i) |i| {
            out_query[out_len.*] = query[i];
            out_target[out_len.*] = '-';
            out_len.* += 1;
        }
        out_query[out_len.*] = query[best_i];
        out_target[out_len.*] = target[0];
        out_len.* += 1;
        for (best_i + 1..m) |i| {
            out_query[out_len.*] = query[i];
            out_target[out_len.*] = '-';
            out_len.* += 1;
        }
        return;
    }

    // Divide
    const mid = m / 2;

    // Allocate score arrays
    const scores_size = (n + 1) * @sizeOf(i32);
    const forward_ptr = wasmAlloc(scores_size) orelse return;
    const backward_ptr = wasmAlloc(scores_size) orelse return;

    const forward_scores: [*]i32 = @alignCast(@ptrCast(forward_ptr));
    const backward_scores: [*]i32 = @alignCast(@ptrCast(backward_ptr));

    computeLastRowScores(query[0..mid], target, match_score, mismatch_score, gap_open, gap_extend, forward_scores);
    computeBackwardScores(query[mid..], target, match_score, mismatch_score, gap_open, gap_extend, backward_scores);

    // Find best split point
    var best_j: usize = 0;
    var best_score: i32 = forward_scores[0] + backward_scores[0];

    for (0..n + 1) |j| {
        const score = forward_scores[j] + backward_scores[j];
        if (score > best_score) {
            best_score = score;
            best_j = j;
        }
    }

    // Recursive alignment
    hirschbergAlign(query[0..mid], target[0..best_j], match_score, mismatch_score, gap_open, gap_extend, out_query, out_target, out_len);
    hirschbergAlign(query[mid..], target[best_j..], match_score, mismatch_score, gap_open, gap_extend, out_query, out_target, out_len);
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
    const query = query_ptr[0..query_len];
    const target = target_ptr[0..target_len];

    // NOTE: We do NOT reset the heap here because:
    // 1. The input pointers (query_ptr, target_ptr) may have been allocated from our heap
    // 2. The slices above still reference that memory
    // JS should call reset() before starting a new alignment to reclaim memory

    // Handle empty sequences
    if (query_len == 0 or target_len == 0) {
        const result_ptr = wasmAlloc(@sizeOf(AlignmentResult)) orelse return null;
        const result: *AlignmentResult = @alignCast(@ptrCast(result_ptr));
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

    // Find max score and endpoint
    const max_result = findMaxScoreLinearSpace(query, target, match_score, mismatch_score, gap_open, gap_extend);

    if (max_result.max_score == 0) {
        const result_ptr = wasmAlloc(@sizeOf(AlignmentResult)) orelse return null;
        const result: *AlignmentResult = @alignCast(@ptrCast(result_ptr));
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
        query,
        target,
        max_result.max_i,
        max_result.max_j,
        match_score,
        mismatch_score,
        gap_open,
        gap_extend,
    );

    // Allocate output buffers (max size is sum of local region lengths)
    const local_query = query[start_result.start_i..max_result.max_i];
    const local_target = target[start_result.start_j..max_result.max_j];
    const max_aligned_len = local_query.len + local_target.len;

    const query_aligned_ptr = wasmAlloc(max_aligned_len) orelse return null;
    const target_aligned_ptr = wasmAlloc(max_aligned_len) orelse return null;

    var aligned_len: usize = 0;
    hirschbergAlign(
        local_query,
        local_target,
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
            const q_upper = if (query_aligned_ptr[i] >= 'a' and query_aligned_ptr[i] <= 'z')
                query_aligned_ptr[i] - 32
            else
                query_aligned_ptr[i];
            const t_upper = if (target_aligned_ptr[i] >= 'a' and target_aligned_ptr[i] <= 'z')
                target_aligned_ptr[i] - 32
            else
                target_aligned_ptr[i];
            if (q_upper == t_upper) {
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
    const result: *AlignmentResult = @alignCast(@ptrCast(result_ptr));

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
