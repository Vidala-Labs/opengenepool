// Build configuration for alignment WASM module
// Zig version: 0.15.x
//
// Build command: cd src/wasm && zig build
// Output: src/utils/alignment.wasm

const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
        .cpu_features_add = std.Target.wasm.featureSet(&.{.simd128}),
    });

    const optimize = b.standardOptimizeOption(.{});

    // Create the root module
    const root_module = b.createModule(.{
        .root_source_file = b.path("alignment.zig"),
        .target = target,
        .optimize = optimize,
    });

    const lib = b.addExecutable(.{
        .name = "alignment",
        .root_module = root_module,
    });

    // Export memory
    lib.entry = .disabled;
    lib.rdynamic = true;
    lib.export_memory = true;
    lib.initial_memory = 1024 * 65536; // 64MB initial (must be > heap + stack + code)
    lib.max_memory = 2048 * 65536; // 128MB max

    // Install to parent utils directory
    // Note: The path is relative to zig-out, so we need to go up more levels
    const install_step = b.addInstallArtifact(lib, .{
        .dest_dir = .{ .override = .{ .custom = "../../utils" } },
    });

    b.default_step.dependOn(&install_step.step);
}
