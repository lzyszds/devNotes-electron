#pragma once

// 最小自检：在没有真实桌面的 CI / 虚拟机上验证抓屏、选区坐标和 PNG 编码链路。
// 它不会显示框选窗口，不依赖用户交互。
int run_selftest(const wchar_t* output_path);
