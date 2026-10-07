// Shared by Windows checks and GitHub Actions; new files are checked automatically.
const { readdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = resolve(__dirname, "..");
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const file of readdirSync(resolve(repoRoot, "frontend")).filter(name => name.endsWith(".js")).sort()) {
  run(["--check", `frontend/${file}`]);
}
const tests = readdirSync(resolve(repoRoot, "backend"))
  .filter(name => /^test_.*\.cjs$/.test(name)).sort()
  .map(name => `backend/${name}`);
if (!tests.length) throw new Error("No frontend tests found in backend/test_*.cjs");
run(["--test", ...tests]);
