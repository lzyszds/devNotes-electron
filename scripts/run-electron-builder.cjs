const { spawn } = require("node:child_process");

const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" };
const args = ["electron-builder", ...process.argv.slice(2)];

// dmg-builder can pick up a broken Homebrew Python on macOS. Prefer the
// system Python unless the caller already pinned a specific interpreter.
if (process.platform === "darwin" && !env.PYTHON_PATH) {
  env.PYTHON_PATH = "/usr/bin/python3";
}

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  args,
  {
    stdio: "inherit",
    env,
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
