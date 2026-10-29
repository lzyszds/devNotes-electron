// devNotes Windows 截图助手。
//
// 独立进程、按需启动、用完即退：不常驻 Electron 页面，也不额外占内存。
//   devnotes-capture --output <png>      框选，成功写 PNG，Esc / 右键取消
//   devnotes-capture --selftest <png>    CI 用：抓一小块并编码，不弹窗
//
// 退出码：0 成功；2 用户取消；1 失败（原因写 stderr）。

#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <objbase.h>
// WIN32_LEAN_AND_MEAN 会把 shellapi.h 排除在 windows.h 之外，
// 少了它 CommandLineToArgvW 没声明（C3861）。必须放在 windows.h 之后。
#include <shellapi.h>

#include <cstdio>
#include <string>

#include "capture_io.h"
#include "overlay.h"
#include "selftest.h"
#include "win_error.h"

namespace {

std::wstring arg_at(int argc, wchar_t** argv, const wchar_t* name) {
  for (int i = 1; i + 1 < argc; ++i) {
    if (std::wcscmp(argv[i], name) == 0) return argv[i + 1];
  }
  return L"";
}

void fail(const std::wstring& message) {
  // wprintf 写的是进程 ANSI 代码页（纯中文在英文 CI 上是乱码，甚至直接失败），
  // 统一转 UTF-8 再用 printf：终端与 CI 日志都按 UTF-8 读。
  const int size = WideCharToMultiByte(CP_UTF8, 0, message.c_str(), -1, nullptr, 0, nullptr, nullptr);
  if (size <= 1) {
    std::fprintf(stderr, "capture failed\n");
    std::fflush(stderr);
    return;
  }
  std::string utf8(static_cast<size_t>(size - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, message.c_str(), -1, utf8.data(), size, nullptr, nullptr);
  std::fprintf(stderr, "%s\n", utf8.c_str());
  std::fflush(stderr);
}

int run_capture(HINSTANCE instance, const std::wstring& output) {
  if (output.empty()) {
    fail(L"缺少 --output 参数");
    return 1;
  }

  // 先用整块虚拟桌面抓一次，之后只在内存里裁剪与编码。
  const int x = GetSystemMetrics(SM_XVIRTUALSCREEN);
  const int y = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const int width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
  const int height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
  const PixelRect desktop{x, y, x + width, y + height};

  OverlayContext ctx;
  ctx.instance = instance;
  std::wstring error;
  if (!capture_desktop_region(desktop, ctx.snapshot, error)) {
    fail(error);
    return 1;
  }

  OverlayResult result;
  if (!run_overlay(ctx, result)) {
    fail(ctx.error);
    return 1;
  }
  // 快照在框选期间一直占着整屏内存，框完立刻释放，再编码选区
  if (result.cancelled) {
    return 2;
  }
  const CapturedImage& image = ctx.snapshot;
  if (!encode_png_region(image, result.region, output, error)) {
    fail(error);
    return 1;
  }
  return 0;
}

}  // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
  // 必须在任何 HWND 之前声明，否则多屏缩放率下坐标会按系统 DPI 算错。
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  int argv_count = 0;
  wchar_t** argv = CommandLineToArgvW(GetCommandLineW(), &argv_count);
  if (!argv) {
    fail(L"无法解析命令行");
    return 1;
  }

  const std::wstring selftest = arg_at(argv_count, argv, L"--selftest");
  const std::wstring output = arg_at(argv_count, argv, L"--output");
  LocalFree(argv);



  const HRESULT com = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(com) && com != RPC_E_CHANGED_MODE) {
    fail(L"无法初始化 COM：" + format_win_error(com));
    return 1;
  }
  const int code = !selftest.empty() ? run_selftest(selftest.c_str()) : run_capture(instance, output);
  if (SUCCEEDED(com)) CoUninitialize();
  return code;
}
