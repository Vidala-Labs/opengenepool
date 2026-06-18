//! Host-local command-line driver for the alignment module.
//!
//! Aligns two sequences using the same exported code path the browser/WASM
//! build uses, and prints the full result. Useful for diagnosing real-world
//! cases (e.g. "lalign says these two plasmids aren't the same") without a
//! browser.
//!
//! Build & run:
//!     cd src/wasm
//!     zig build-exe align_cli.zig -O ReleaseFast
//!     ./align_cli <query> <target> [--circular] [--linear] [--band N]
//!
//! Or pass sequences from files:
//!     ./align_cli --query-file q.txt --target-file t.txt --circular
//!
//! Or one-shot without a separate build:
//!     zig run align_cli.zig -- ACGT... ACGT... --circular
//!
//! Whitespace and newlines in sequences are stripped. Reads up to 64 MB per
//! sequence from a file.

const std = @import("std");
const algn = @import("alignment.zig");

const MAX_SEQ_BYTES = 64 * 1024 * 1024;

const Mode = enum { circular, banded, linear };

const Args = struct {
    query: []const u8,
    target: []const u8,
    mode: Mode = .banded,
    band_width: usize = 128,
    kmer_size: usize = 15,
    min_votes: u32 = 3,
};

fn usage() void {
    const stderr = std.fs.File.stderr().deprecatedWriter();
    stderr.writeAll(
        \\Usage:
        \\  align_cli <query> <target> [options]
        \\  align_cli --query-file Q --target-file T [options]
        \\
        \\Options:
        \\  --circular        Use the circular-origin alignment path (k-mer offset detect)
        \\  --banded          Use plain banded local alignment (default)
        \\  --linear          Use full linear-space local alignment
        \\  --band N          Band width for banded/circular (default 128)
        \\  --kmer N          Origin k-mer size for --circular (default 15)
        \\  --min-votes N     Minimum k-mer votes for --circular (default 3)
        \\
    ) catch {};
}

/// Strip ASCII whitespace from a sequence into a freshly-allocated buffer.
fn cleanSeq(allocator: std.mem.Allocator, raw: []const u8) ![]u8 {
    var out = try allocator.alloc(u8, raw.len);
    var n: usize = 0;
    for (raw) |c| {
        if (c == ' ' or c == '\t' or c == '\n' or c == '\r') continue;
        out[n] = c;
        n += 1;
    }
    return out[0..n];
}

fn readFile(allocator: std.mem.Allocator, path: []const u8) ![]u8 {
    const file = try std.fs.cwd().openFile(path, .{});
    defer file.close();
    return try file.readToEndAlloc(allocator, MAX_SEQ_BYTES);
}

fn parseArgs(allocator: std.mem.Allocator) !?Args {
    const argv = try std.process.argsAlloc(allocator);

    var query: ?[]const u8 = null;
    var target: ?[]const u8 = null;
    var query_file: ?[]const u8 = null;
    var target_file: ?[]const u8 = null;
    var positionals: [2][]const u8 = undefined;
    var positional_count: usize = 0;
    var mode: Mode = .banded;
    var band_width: usize = 128;
    var kmer_size: usize = 15;
    var min_votes: u32 = 3;

    var i: usize = 1;
    while (i < argv.len) : (i += 1) {
        const a = argv[i];
        if (std.mem.eql(u8, a, "--circular")) {
            mode = .circular;
        } else if (std.mem.eql(u8, a, "--banded")) {
            mode = .banded;
        } else if (std.mem.eql(u8, a, "--linear")) {
            mode = .linear;
        } else if (std.mem.eql(u8, a, "--query-file")) {
            i += 1;
            if (i >= argv.len) return error.MissingValue;
            query_file = argv[i];
        } else if (std.mem.eql(u8, a, "--target-file")) {
            i += 1;
            if (i >= argv.len) return error.MissingValue;
            target_file = argv[i];
        } else if (std.mem.eql(u8, a, "--band")) {
            i += 1;
            if (i >= argv.len) return error.MissingValue;
            band_width = try std.fmt.parseInt(usize, argv[i], 10);
        } else if (std.mem.eql(u8, a, "--kmer")) {
            i += 1;
            if (i >= argv.len) return error.MissingValue;
            kmer_size = try std.fmt.parseInt(usize, argv[i], 10);
        } else if (std.mem.eql(u8, a, "--min-votes")) {
            i += 1;
            if (i >= argv.len) return error.MissingValue;
            min_votes = try std.fmt.parseInt(u32, argv[i], 10);
        } else if (std.mem.eql(u8, a, "-h") or std.mem.eql(u8, a, "--help")) {
            return null;
        } else {
            if (positional_count >= 2) return error.TooManyPositionals;
            positionals[positional_count] = a;
            positional_count += 1;
        }
    }

    if (query_file) |p| query = try cleanSeq(allocator, try readFile(allocator, p));
    if (target_file) |p| target = try cleanSeq(allocator, try readFile(allocator, p));

    if (query == null and positional_count >= 1) query = try cleanSeq(allocator, positionals[0]);
    if (target == null and positional_count >= 2) target = try cleanSeq(allocator, positionals[1]);

    if (query == null or target == null) {
        return error.MissingSequences;
    }

    return Args{
        .query = query.?,
        .target = target.?,
        .mode = mode,
        .band_width = band_width,
        .kmer_size = kmer_size,
        .min_votes = min_votes,
    };
}

pub fn main() !void {
    // Short-lived one-shot tool: an arena freed at exit frees everything at
    // once, so individual allocations (cleaned sequences, file contents, argv)
    // don't need explicit frees.
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const parsed = parseArgs(allocator) catch |err| {
        const stderr = std.fs.File.stderr().deprecatedWriter();
        stderr.print("error: {s}\n\n", .{@errorName(err)}) catch {};
        usage();
        std.process.exit(2);
    };
    const args = parsed orelse {
        usage();
        return;
    };

    const out_capacity = args.query.len + args.target.len;

    // Drive the exported ABI exactly like the JS bridge.
    algn.reset();
    const query_ptr = algn.alloc(args.query.len) orelse return error.OutOfMemory;
    const target_ptr = algn.alloc(args.target.len) orelse return error.OutOfMemory;
    const query_out_ptr = algn.alloc(out_capacity) orelse return error.OutOfMemory;
    const target_out_ptr = algn.alloc(out_capacity) orelse return error.OutOfMemory;
    const result_ptr = algn.alloc(@sizeOf(algn.AlignmentResultHeader)) orelse return error.OutOfMemory;

    @memcpy(query_ptr[0..args.query.len], args.query);
    @memcpy(target_ptr[0..args.target.len], args.target);

    const result: *algn.AlignmentResultHeader = @ptrCast(@alignCast(result_ptr));

    const status = switch (args.mode) {
        .circular => algn.alignSequencesBandedCircularInto(
            query_ptr,      args.query.len,
            target_ptr,     args.target.len,
            query_out_ptr,  target_out_ptr,
            out_capacity,   result,
            2,              -1,
            -3,             -1,
            args.band_width, args.kmer_size,
            args.min_votes,
        ),
        .banded => algn.alignSequencesBandedInto(
            query_ptr,      args.query.len,
            target_ptr,     args.target.len,
            query_out_ptr,  target_out_ptr,
            out_capacity,   result,
            2,              -1,
            -3,             -1,
            args.band_width,
        ),
        .linear => algn.alignSequencesInto(
            query_ptr,      args.query.len,
            target_ptr,     args.target.len,
            query_out_ptr,  target_out_ptr,
            out_capacity,   result,
            2,              -1,
            -3,             -1,
        ),
    };

    const stdout = std.fs.File.stdout().deprecatedWriter();
    const mode_name = switch (args.mode) {
        .circular => "circular",
        .banded => "banded",
        .linear => "linear",
    };

    try stdout.print("mode:           {s}\n", .{mode_name});
    try stdout.print("query length:   {d}\n", .{args.query.len});
    try stdout.print("target length:  {d}\n", .{args.target.len});
    try stdout.print("status:         {d} (0 = OK)\n", .{status});

    if (status != 0) {
        try stdout.print("(non-OK status; see STATUS_* in alignment.zig)\n", .{});
        std.process.exit(1);
    }

    const q_len: usize = @intCast(result.query_aligned_len);
    const t_len: usize = @intCast(result.target_aligned_len);
    const q_aligned = query_out_ptr[0..q_len];
    const t_aligned = target_out_ptr[0..t_len];

    try stdout.print("score:          {d}\n", .{result.score});
    try stdout.print("identity:       {d:.2}%\n", .{result.identity});
    try stdout.print("query range:    [{d}, {d})  ({d} of {d} bases)\n", .{
        result.query_start, result.query_end,
        result.query_end - result.query_start, args.query.len,
    });
    try stdout.print("target range:   [{d}, {d})  ({d} of {d} bases)\n", .{
        result.target_start, result.target_end,
        result.target_end - result.target_start, args.target.len,
    });
    if (args.mode == .circular) {
        try stdout.print("origin offset:  {d}\n", .{result.target_origin_offset});
    }

    // Match line + aligned blocks (wrapped at 80 columns).
    try stdout.print("\nalignment ({d} columns):\n", .{q_len});
    const width: usize = 80;
    var col: usize = 0;
    while (col < q_len) : (col += width) {
        const end = @min(col + width, q_len);
        try stdout.print("Q {d:>8}  ", .{col});
        try stdout.writeAll(q_aligned[col..end]);
        try stdout.writeAll("\n            ");
        for (col..end) |k| {
            const same = k < t_len and q_aligned[k] == t_aligned[k] and q_aligned[k] != '-';
            try stdout.writeByte(if (same) '|' else ' ');
        }
        try stdout.print("\nT {d:>8}  ", .{col});
        if (col < t_len) try stdout.writeAll(t_aligned[col..@min(end, t_len)]);
        try stdout.writeAll("\n\n");
    }
}
