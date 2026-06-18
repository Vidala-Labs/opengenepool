//! End-to-end integration tests for the alignment WASM module.
//!
//! Run natively (no WASM/browser needed):
//!     cd src/wasm && zig test alignment_test.zig
//!
//! These tests drive the *exported ABI* (alloc / reset / alignSequences*Into)
//! exactly the way src/utils/alignment.js drives the WASM instance: reset the
//! bump heap, alloc input + output buffers, copy sequences in, invoke, then
//! read the result header and output buffers back out. That makes them a
//! faithful reproduction of the browser code path, runnable on the host.
//!
//! Focus: the circular-origin local-alignment path, which detects how much the
//! target's origin is rotated relative to the query (k-mer voting), rotates the
//! target, aligns, then shifts the reported target coordinates back.

const std = @import("std");
const testing = std.testing;
const algn = @import("alignment.zig");

const STATUS_OK: i32 = 0;
const MATCH: i32 = 2;
const MISMATCH: i32 = -1;
const GAP_OPEN: i32 = -3;
const GAP_EXTEND: i32 = -1;
const BAND_WIDTH: usize = 128;
const KMER_SIZE: usize = 15;
const MIN_VOTES: u32 = 3;

const Result = struct {
    status: i32,
    header: algn.AlignmentResultHeader,
    query_aligned: []const u8,
    target_aligned: []const u8,

    fn coverage(self: Result) i32 {
        return self.header.query_end - self.header.query_start;
    }
};

const Mode = enum { circular, banded, linear };

/// Drive an alignment export against caller-owned buffers, mirroring
/// callWasmAlignmentInto() in src/utils/alignment.js.
fn run(mode: Mode, query: []const u8, target: []const u8) Result {
    algn.reset();

    const out_capacity = query.len + target.len;
    const query_ptr = algn.alloc(query.len).?;
    const target_ptr = algn.alloc(target.len).?;
    const query_out_ptr = algn.alloc(out_capacity).?;
    const target_out_ptr = algn.alloc(out_capacity).?;
    const result_ptr = algn.alloc(@sizeOf(algn.AlignmentResultHeader)).?;

    @memcpy(query_ptr[0..query.len], query);
    @memcpy(target_ptr[0..target.len], target);

    const result: *algn.AlignmentResultHeader = @ptrCast(@alignCast(result_ptr));

    const status = switch (mode) {
        .circular => algn.alignSequencesBandedCircularInto(
            query_ptr,                query.len,
            target_ptr,               target.len,
            query_out_ptr,            target_out_ptr,
            out_capacity,             result,
            MATCH,                    MISMATCH,
            GAP_OPEN,                 GAP_EXTEND,
            BAND_WIDTH,               KMER_SIZE,
            MIN_VOTES,
        ),
        .banded => algn.alignSequencesBandedInto(
            query_ptr,                query.len,
            target_ptr,               target.len,
            query_out_ptr,            target_out_ptr,
            out_capacity,             result,
            MATCH,                    MISMATCH,
            GAP_OPEN,                 GAP_EXTEND,
            BAND_WIDTH,
        ),
        .linear => algn.alignSequencesInto(
            query_ptr,                query.len,
            target_ptr,               target.len,
            query_out_ptr,            target_out_ptr,
            out_capacity,             result,
            MATCH,                    MISMATCH,
            GAP_OPEN,                 GAP_EXTEND,
        ),
    };

    const q_len: usize = @intCast(result.query_aligned_len);
    const t_len: usize = @intCast(result.target_aligned_len);

    return .{
        .status = status,
        .header = result.*,
        .query_aligned = query_out_ptr[0..q_len],
        .target_aligned = target_out_ptr[0..t_len],
    };
}

fn rotate(comptime s: []const u8, comptime n: usize) [s.len]u8 {
    var out: [s.len]u8 = undefined;
    for (0..s.len) |i| out[i] = s[(i + n) % s.len];
    return out;
}

/// Assert two sequences are reported as fully identical: 100% identity over the
/// query's full length, no clipped ends.
fn expectFullIdentity(r: Result, full_len: usize) !void {
    try testing.expectEqual(STATUS_OK, r.status);
    try testing.expectEqual(@as(f64, 100.0), r.header.identity);
    try testing.expectEqual(@as(i32, @intCast(full_len)), r.coverage());
    try testing.expectEqual(@as(i32, 0), r.header.query_start);
}

// A realistic-ish 101bp "plasmid" with mixed composition.
const PLASMID = "ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATCAGTTACGGATCCGTACGTTAGCGCATTAGCCGATCGGATCCATGCATGCTAGCTAGGCATGCA";

test "identical, no rotation -> 100% identity full length" {
    const r = run(.circular, PLASMID, PLASMID);
    try expectFullIdentity(r, PLASMID.len);
    try testing.expectEqual(@as(u32, 0), r.header.target_origin_offset);
}

test "identical plasmid, origin rotated by 37 -> still 100% identity" {
    const rotated = comptime rotate(PLASMID, 37);
    const r = run(.circular, &rotated, PLASMID);
    try expectFullIdentity(r, PLASMID.len);
    try testing.expectEqual(@as(u32, 37), r.header.target_origin_offset);
}

test "rotation by 1 (origin straddles every k-mer seam)" {
    const rotated = comptime rotate(PLASMID, 1);
    const r = run(.circular, &rotated, PLASMID);
    try expectFullIdentity(r, PLASMID.len);
}

test "rotation by len-1 (wrap the other direction)" {
    const rotated = comptime rotate(PLASMID, PLASMID.len - 1);
    const r = run(.circular, &rotated, PLASMID);
    try expectFullIdentity(r, PLASMID.len);
}

test "lowercase query is normalized, rotation still recovered" {
    const rotated_upper = comptime rotate(PLASMID, 37);
    var rotated_lower: [rotated_upper.len]u8 = undefined;
    for (0..rotated_upper.len) |i| {
        const c = rotated_upper[i];
        rotated_lower[i] = if (c >= 'A' and c <= 'Z') c + 32 else c;
    }
    const r = run(.circular, &rotated_lower, PLASMID);
    try expectFullIdentity(r, PLASMID.len);
}

test "repeat-rich sequence, rotated origin" {
    // Tandem repeats split k-mer votes across copies; verify the dominant true
    // origin still wins (or the linear fallback still finds full identity).
    const REPEAT =
        "GGGGCCCCAAAATTTTGGGGCCCCAAAATTTT" ++
        "ACGTACGTACGTACGTTGCATGCATGCATGCA" ++
        "GGGGCCCCAAAATTTTGGGGCCCCAAAATTTT" ++
        "TTTTAAAACCCCGGGGTTTTAAAACCCCGGGG";
    const rotated = comptime rotate(REPEAT, 20);
    const r = run(.circular, &rotated, REPEAT);
    try expectFullIdentity(r, REPEAT.len);
}

test "circular path with no actual rotation matches plain banded" {
    const circ = run(.circular, PLASMID, PLASMID);
    const banded = run(.banded, PLASMID, PLASMID);
    try testing.expectEqual(banded.header.score, circ.header.score);
    try testing.expectEqual(banded.header.identity, circ.header.identity);
}
