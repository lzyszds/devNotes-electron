const { spawn } = require("node:child_process");

const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" };
const args = ["electron-builder", ...process.argv.slice(2)];

// dmg-builder can pick up a broken Homebrew Python on macOS. Prefer the
// system Python unless the caller already pinned a specific interpreter.
if (process.platform === "darwin" && !env.PYTHON_PATH) {
  env.PYTHON_PATH = "/usr/bin/python3";
}

// Windows 上 npx 是 .cmd，Node 不允许直接 spawn 批处理文件（会抛 EINVAL），必须走 shell
const isWindows = process.platform === "win32";

const child = spawn("npx", args, {
  stdio: "inherit",
  env,
  shell: isWindows,
});

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
