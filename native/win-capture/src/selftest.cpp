#include "selftest.h"

#include <cstdio>

#include "capture_io.h"
#include "selection_state.h"

// 命令行参数：devnotes-capture --selftest C:\temp\out.png
// 成功返回 0，失败写 stderr 并返回 1。
int run_selftest(const wchar_t* output_path) {
  std::wstring error;
  const int x = GetSystemMetrics(SM_XVIRTUALSCREEN);
  const int y = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const int w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
  const int h = GetSystemMetrics(SM_CYVIRTUALSCREEN);

  PixelRect bounds{x, y, x + w, y + h};
  // 一个固定的小区域即可：验证“坐标换算 → 抓图 → PNG 编码”整条链路
  PixelRect probe = clip_to_bounds(rect_from_points(x, y, x + 64, y + 64), bounds);
  if (probe.empty()) {
    std::fputs("虚拟桌面尺寸异常\n", stderr);
    return 1;
  }

  CapturedImage image;
  if (!capture_desktop_region(probe, image, error)) {
    std::fwprintf(stderr, L"抓屏失败：%ls\n", error.c_str());
    return 1;
  }
  // WIC 的 PNG 编码器默认在原地更新文件（WICInPlaceBitmapEncoder），
  // 目标文件不存在时 MSVC 运行库会直接让进程静默退出（退出码 0、什么都不写）。
  // 先把它建成空文件，编码器才会按“新建”处理。
  std::FILE* placeholder = _wfopen(output_path, L"wb");
  if (!placeholder) {
    std::fwprintf(stderr, L"无法创建输出文件：%ls\n", output_path);
    return 1;
  }
  std::fclose(placeholder);
  if (!encode_png(image, output_path, error)) {
    std::fwprintf(stderr, L"编码失败：%ls\n", error.c_str());
    return 1;
  }
  std::wprintf(L"selftest ok: %dx%d -> %ls\n", probe.width(), probe.height(), output_path);
  return 0;
}
