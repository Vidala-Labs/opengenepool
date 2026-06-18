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

// ---------------------------------------------------------------------------
// Regression: large rotation + small indels (the real-plasmid failure mode)
//
// Two circular sequences that are the SAME plasmid linearized at different
// origins, related by a large rotation (far outside the alignment band) AND a
// few small indels. The indels make every matching k-mer downstream of an indel
// vote for a slightly different diagonal, so the votes for the single true
// rotation SMEAR across adjacent offset buckets. The old exact-bucket vote +
// "winner must be 1.5x the runner-up" gate treated that smear as competing
// origins and gave up (offset 0), so only the non-wrapping fragment aligned.
//
// A seed-and-chain estimator consolidates near-diagonal seeds into one chain and
// recovers the rotation. All sequence data here is SYNTHETIC and deterministic.
// ---------------------------------------------------------------------------

const BASES = "ACGT";

/// Deterministic xorshift-based pseudo-random sequence (no Math.random / Date,
/// which would break reproducibility and aren't available in this context).
fn makeRandomSeq(buf: []u8, seed: u64) void {
    var x = seed | 1;
    for (buf) |*b| {
        // xorshift64
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        b.* = BASES[@intCast(x & 3)];
    }
}

/// Rotate `src` left by `offset` into `dst` (both same length).
fn rotateInto(dst: []u8, src: []const u8, offset: usize) void {
    for (0..src.len) |i| dst[i] = src[(i + offset) % src.len];
}

const SEQ_LEN = 4000;
const ROTATION = 1500; // far beyond the 128-wide band

test "REGRESSION: large rotation + small indels recovers full identity" {
    var base: [SEQ_LEN]u8 = undefined;
    makeRandomSeq(&base, 0x9E3779B97F4A7C15);

    // target = base. query = base rotated by ROTATION, then with two small
    // deletions punched in (so the diagonal steps partway through).
    const target = base;

    var rotated: [SEQ_LEN]u8 = undefined;
    rotateInto(&rotated, &base, ROTATION);

    // Build query by copying `rotated` but dropping 1 base at ~1/3 and 1 base at
    // ~2/3 — two single-base deletions => two diagonal steps.
    var query_buf: [SEQ_LEN]u8 = undefined;
    var w: usize = 0;
    const del1 = SEQ_LEN / 3;
    const del2 = (SEQ_LEN * 2) / 3;
    for (0..SEQ_LEN) |i| {
        if (i == del1 or i == del2) continue;
        query_buf[w] = rotated[i];
        w += 1;
    }
    const query = query_buf[0..w]; // SEQ_LEN - 2

    const r = run(.circular, query, &target);

    // The whole query is present in the target (modulo 2 deleted bases), so a
    // correct circular alignment should cover essentially the entire query at
    // very high identity. The OLD estimator returns offset 0 here and aligns
    // only the non-wrapping fragment (~ROTATION/SEQ_LEN of it).
    try testing.expectEqual(STATUS_OK, r.status);
    const coverage = r.coverage();
    try testing.expect(coverage >= @as(i32, @intCast(query.len - 10)));
    try testing.expect(r.header.identity >= 99.0);
}
