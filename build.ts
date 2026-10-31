const mode = Bun.argv[2] ?? "optimized";
if (Bun.argv.length > 3 || !["optimized", "baseline"].includes(mode)) {
  console.error("Usage: bun run build.ts [optimized|baseline]");
  process.exit(1);
}
const image = "taranis:" + mode;
const build = Bun.spawn([
  "docker", "buildx", "build", "--load", "-f", "image/Dockerfile",
  "--target", mode,
  "--build-arg", "BUILD_JOBS=" + (process.env.BUILD_JOBS ?? "16"),
  "-t", image, ".",
], { cwd: import.meta.dir, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
const code = await build.exited;
if (code === 0) console.log(image);
process.exit(code);
