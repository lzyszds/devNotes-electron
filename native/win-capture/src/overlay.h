#pragma once

#include <windows.h>

#include <string>

#include "capture_io.h"

// 框选结果。cancelled 为 true 时 region 无意义。
struct OverlayResult {
  bool cancelled = true;
  PixelRect region{};
};

struct OverlayContext {
  HINSTANCE instance = nullptr;
  CapturedImage snapshot;
  // 失败原因，由 main 统一打到 stderr
  std::wstring error;
};

// 用桌面快照做背景的虚拟桌面框选层。
// 返回 false 表示窗口创建失败；成功返回后无论是框选还是取消都已结束。
bool run_overlay(OverlayContext& ctx, OverlayResult& result);
