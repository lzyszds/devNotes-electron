# Windows 截图助手

按需启动的独立原生程序：按快捷键 → 抓桌面快照 → 画选区 → 裁剪编码 PNG → 退出。
不常驻 Electron 页面，退出后不占截图相关内存。

## 构建

```bash
# x64 Native Tools Command Prompt for VS
node scripts/build-win-capture.cjs
```

产物：`native/win-capture/build/Release/devnotes-capture.exe`，
由 `package.json` 的 `build.win.extraResources` 打进 Windows 安装包的 `resources/native/`。
顶层 `extraResources` 不放这个 exe，避免 macOS 打包因找不到 Windows 产物失败。

单元测试（任意平台可跑，不依赖 Windows）：

```bash
cmake -S native/win-capture -B native/win-capture/build-test
cmake --build native/win-capture/build-test
ctest --test-dir native/win-capture/build-test --output-on-failure
```

## 命令行

| 参数 | 说明 |
| --- | --- |
| `--output <png>` | 框选模式。成功写 PNG，退出码 0；Esc / 右键取消，退出码 2；失败写 stderr，退出码 1 |
| `--selftest <png>` | 抓一小块桌面并编码，不弹窗。用于 CI 验证抓屏链路 |

## 设计要点

- **先抓快照再显示窗口**：避免把框选层自己拍进去；快照在内存里裁剪编码。
- **框选窗口不抢前台**：`WS_EX_TOOLWINDOW` + `SW_SHOWNOACTIVATE`，显示时不调用
  `SetForegroundWindow`。没有加 `WS_EX_NOACTIVATE`，否则窗口收不到键盘、Esc 失效；
  显示后再 `SetFocus`。右键取消不依赖焦点。快照里保留了原始桌面合成（含阴影）。
- **首帧完整**：背景在隐藏状态下画进内存 DC，显示时一次上屏，不出现空窗。
- **多屏**：进程声明 `PerMonitorV2`，鼠标、`GetSystemMetrics`、`BitBlt` 都是物理像素，
  选区不再做 DPI 换算，只加上虚拟桌面原点。压暗层是 8×8 单色网点，不是真半透明。
- **局限**：快照取自桌面 DC 的 `BitBlt`。个别使用 D3D 独占全屏 / HDR 覆盖层的场景
  可能抓不到内容；失败时退出码为 1，主进程会回退到 Electron 遮罩。
  这个局限需要在真机上验证，CI 的虚拟桌面只覆盖基础路径。
