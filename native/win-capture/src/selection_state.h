#pragma once

#include <algorithm>

// 纯坐标逻辑，不碰 Windows API：三块屏幕各自缩放率不同时，
// 这里只负责把“物理像素的拖拽点”收敛成一个有效矩形。
//
// 进程声明了 PerMonitorV2：鼠标消息、GetSystemMetrics、BitBlt 全部是物理像素，
// 所以这个文件里不做任何 DPI 换算 —— 少一次换算就少一处缩放错位。
struct PixelRect {
  int left = 0;
  int top = 0;
  int right = 0;
  int bottom = 0;

  int width() const { return right - left; }
  int height() const { return bottom - top; }
  bool empty() const { return width() <= 0 || height() <= 0; }
};

inline PixelRect rect_from_points(int x1, int y1, int x2, int y2) {
  PixelRect r;
  r.left = std::min(x1, x2);
  r.top = std::min(y1, y2);
  r.right = std::max(x1, x2);
  r.bottom = std::max(y1, y2);
  return r;
}

// 裁到虚拟桌面内：拖到屏幕边缘外时，不能把越界坐标带去 BitBlt。
inline PixelRect clip_to_bounds(PixelRect r, const PixelRect& bounds) {
  r.left = std::max(r.left, bounds.left);
  r.top = std::max(r.top, bounds.top);
  r.right = std::min(r.right, bounds.right);
  r.bottom = std::min(r.bottom, bounds.bottom);
  return r;
}

// 和现有渲染层一致：小于 4 像素算误触，回到待框选状态。
inline bool is_click_not_drag(const PixelRect& r) { return r.width() < 4 || r.height() < 4; }
