#include "selftest.h"

#include <cstdio>
#include <string>

#include "capture_io.h"
#include "selection_state.h"
#include "win_error.h"

namespace {

// 与 main.cpp 的 fail() 同理：wprintf 走 ANSI 代码页，中文在英文 CI 上是乱码。
void report(const std::wstring& message) {
  const int size =
      WideCharToMultiByte(CP_UTF8, 0, message.c_str(), -1, nullptr, 0, nullptr, nullptr);
  if (size <= 1) return;
  std::string utf8(static_cast<size_t>(size - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, message.c_str(), -1, utf8.data(), size, nullptr, nullptr);
  std::fprintf(stderr, "%s\n", utf8.c_str());
  std::fflush(stderr);
}

}  // namespace

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
    report(L"虚拟桌面尺寸异常");
    return 1;
  }

  CapturedImage image;
  if (!capture_desktop_region(probe, image, error)) {
    report(L"抓屏失败：" + error);
    return 1;
  }
  // 先建空文件再交给编码器：WIC 原地更新文件时，目标不存在会直接失败。
  std::FILE* placeholder = _wfopen(output_path, L"wb");
  if (!placeholder) {
    report(L"无法创建输出文件：" + std::wstring(output_path));
    return 1;
  }
  std::fclose(placeholder);
  if (!encode_png(image, output_path, error)) {
    report(L"编码失败：" + error);
    return 1;
  }
  report(L"selftest ok: " + std::to_wstring(probe.width()) + L"x" +
         std::to_wstring(probe.height()) + L" -> " + std::wstring(output_path));
  return 0;
}
