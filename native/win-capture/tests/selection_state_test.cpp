#include "selection_state.h"

#include <cstdio>
#include <cstdlib>

static void expect(bool condition, const char* message) {
  if (!condition) {
    std::fprintf(stderr, "FAILED: %s\n", message);
    std::exit(1);
  }
}

int main() {
  // 往左上拖：坐标要归一化成左上角 + 正尺寸
  auto r = rect_from_points(300, 200, 100, 50);
  expect(r.left == 100 && r.top == 50 && r.width() == 200 && r.height() == 150, "normalize drag");

  // 越过虚拟桌面边界时裁掉越界部分
  PixelRect bounds{0, 0, 1920, 1080};
  auto clipped = clip_to_bounds(rect_from_points(-50, -20, 2000, 1200), bounds);
  expect(clipped.left == 0 && clipped.top == 0 && clipped.right == 1920 && clipped.bottom == 1080,
         "clip to desktop");

  // 完全拖出桌面：得到空矩形，不能拿去 BitBlt
  auto outside = clip_to_bounds(rect_from_points(3000, 2000, 3100, 2100), bounds);
  expect(outside.empty(), "outside becomes empty");

  // 误触判定与渲染层 4px 门限一致
  expect(is_click_not_drag(rect_from_points(10, 10, 13, 30)), "3px width is a click");
  expect(!is_click_not_drag(rect_from_points(10, 10, 14, 30)), "4px width is a drag");

  std::puts("selection_state tests passed");
  return 0;
}
