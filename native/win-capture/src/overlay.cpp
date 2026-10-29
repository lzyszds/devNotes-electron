#include "overlay.h"

#include <windowsx.h>

#include <algorithm>

#include "selection_state.h"
#include "win_error.h"

namespace {

constexpr wchar_t kClassName[] = L"devNotesCaptureOverlay";
constexpr wchar_t kWindowTitle[] = L"devNotes 截图";

struct CaptureSession;
CaptureSession* g_session = nullptr;

LRESULT CALLBACK wnd_proc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam);

struct CaptureSession {
  OverlayContext* ctx = nullptr;
  OverlayResult* result = nullptr;
  HWND hwnd = nullptr;
  HDC buffer_dc = nullptr;
  HBITMAP buffer_bitmap = nullptr;
  // 与快照同尺寸的 DIB：blit 时直接取子区域，避免每帧重建 BITMAPINFO
  HDC source_dc = nullptr;
  HBITMAP source_bitmap = nullptr;
  int width = 0;
  int height = 0;
  bool finished = false;
  bool dragging = false;
  bool has_selection = false;
  PixelRect selection{};
  int origin_x = 0;
  int origin_y = 0;

  void destroy() {
    // 先把 DIB 从 DC 里换出来再删，否则 DeleteObject 失败、位图泄漏
    if (buffer_dc && buffer_bitmap) SelectObject(buffer_dc, GetStockObject(BLACK_PEN));
    if (source_dc && source_bitmap) SelectObject(source_dc, GetStockObject(BLACK_PEN));
    if (buffer_bitmap) DeleteObject(buffer_bitmap);
    if (buffer_dc) DeleteDC(buffer_dc);
    if (source_bitmap) DeleteObject(source_bitmap);
    if (source_dc) DeleteDC(source_dc);
    buffer_bitmap = nullptr;
    buffer_dc = nullptr;
    source_bitmap = nullptr;
    source_dc = nullptr;
  }
};

BITMAPINFO dib_info(int width, int height) {
  BITMAPINFO info{};
  info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  info.bmiHeader.biWidth = width;
  // 负数 = 自上而下，和快照 / PNG 的行序一致
  info.bmiHeader.biHeight = -height;
  info.bmiHeader.biPlanes = 1;
  info.bmiHeader.biBitCount = 32;
  info.bmiHeader.biCompression = BI_RGB;
  return info;
}

POINT virtual_origin() {
  return POINT{GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN)};
}

/*
 * 压暗层：单色图案刷子只有“黑 / 透明”两档，做不出真正半透明。
 * 用 4×4 单色网点把快照打上暗纹，观感接近 Slate 遮罩；
 * 代价是放大看有规则网点，作为临时遮罩可以接受。
 */
HBRUSH checker_brush() {
  static HBRUSH brush = nullptr;
  if (brush) return brush;
  // 1 平面、1bpp。第 4 个参数是每像素位数；之前误写成 16，
  // 驱动会按 16bpp 去读这几个字节，网点变成一条斜线。
  // 8×8、每行 1 字节：0x55 / 0xAA 交错，大约一半像素被压暗。
  const BYTE pattern[8] = {0x55, 0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55, 0xAA};
  HBITMAP bits = CreateBitmap(8, 8, 1, 1, pattern);
  if (!bits) return nullptr;
  brush = CreatePatternBrush(bits);
  // 刷子已经拷走图案，位图可以立刻删，否则进程退出前一直占着
  DeleteObject(bits);
  return brush;
}

void render(CaptureSession& s) {
  if (!s.buffer_dc || !s.source_dc) return;
  const CapturedImage& image = s.ctx->snapshot;
  const POINT origin = virtual_origin();

  RECT client{};
  GetClientRect(s.hwnd, &client);
  FillRect(s.buffer_dc, &client, static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));

  // 快照、窗口、鼠标坐标都是物理像素：PerMonitorV2 下不需要任何 DPI 换算
  BitBlt(s.buffer_dc, image.rect.left - origin.x, image.rect.top - origin.y,
         image.rect.width(), image.rect.height(), s.source_dc, 0, 0, SRCCOPY);

  // 有选区时把选区挖空，那里的快照保持原亮度
  RECT shade = client;
  if (s.has_selection && !s.selection.empty()) {
    RECT hole{static_cast<LONG>(s.selection.left), static_cast<LONG>(s.selection.top),
              static_cast<LONG>(s.selection.right), static_cast<LONG>(s.selection.bottom)};
    ExcludeClipRect(s.buffer_dc, hole.left, hole.top, hole.right, hole.bottom);
  }
  if (const HBRUSH brush = checker_brush()) FillRect(s.buffer_dc, &shade, brush);
  SelectClipRgn(s.buffer_dc, nullptr);

  if (s.has_selection && !s.selection.empty()) {
    HPEN pen = CreatePen(PS_SOLID, 2, RGB(96, 165, 250));
    HGDIOBJ old_pen = SelectObject(s.buffer_dc, pen);
    HGDIOBJ old_brush = SelectObject(s.buffer_dc, GetStockObject(NULL_BRUSH));
    Rectangle(s.buffer_dc, s.selection.left, s.selection.top, s.selection.right,
              s.selection.bottom);
    SelectObject(s.buffer_dc, old_brush);
    SelectObject(s.buffer_dc, old_pen);
    DeleteObject(pen);
  }

  // 整帧画完再一次性上屏：拖拽时不会看到“旧遮罩 → 新选区”两段
  HDC screen = GetDC(s.hwnd);
  if (screen) {
    BitBlt(screen, 0, 0, s.width, s.height, s.buffer_dc, 0, 0, SRCCOPY);
    ReleaseDC(s.hwnd, screen);
  }
}

bool create_surfaces(CaptureSession& s, int width, int height) {
  const CapturedImage& image = s.ctx->snapshot;

  s.source_dc = CreateCompatibleDC(nullptr);
  void* source_bits = nullptr;
  s.source_bitmap =
      s.source_dc
          ? CreateDIBSection(s.source_dc, &dib_info(image.rect.width(), image.rect.height()),
                             DIB_RGB_COLORS, &source_bits, nullptr, 0)
          : nullptr;
  if (!s.source_dc || !s.source_bitmap || !source_bits) return false;
  SelectObject(s.source_dc, s.source_bitmap);
  std::copy(image.pixels.begin(), image.pixels.end(), static_cast<uint8_t*>(source_bits));

  s.buffer_dc = CreateCompatibleDC(nullptr);
  void* buffer_bits = nullptr;
  s.buffer_bitmap = s.buffer_dc ? CreateDIBSection(s.buffer_dc, &dib_info(width, height),
                                                   DIB_RGB_COLORS, &buffer_bits, nullptr, 0)
                                : nullptr;
  if (!s.buffer_dc || !s.buffer_bitmap || !buffer_bits) return false;
  SelectObject(s.buffer_dc, s.buffer_bitmap);
  s.width = width;
  s.height = height;
  return true;
}

void finish(CaptureSession& s, bool cancelled) {
  if (s.finished) return;
  s.finished = true;
  s.result->cancelled = cancelled;
  if (!cancelled) {
    // 鼠标坐标相对窗口客户区，客户区左上角是虚拟桌面原点。
    // 副屏在主屏左边时原点是负数，漏加这一步裁出来的图会整体偏掉。
    const POINT origin = virtual_origin();
    s.result->region = PixelRect{s.selection.left + origin.x, s.selection.top + origin.y,
                                 s.selection.right + origin.x, s.selection.bottom + origin.y};
  }
  // 先隐藏再退出，避免窗口销毁时露出背景色
  ShowWindow(s.hwnd, SW_HIDE);
  // DestroyWindow 不会投递 WM_QUIT；必须显式结束消息循环，否则进程卡住不退出
  PostQuitMessage(cancelled ? 2 : 0);
}

LRESULT CALLBACK wnd_proc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  CaptureSession& s = *g_session;
  switch (message) {
    case WM_NCCALCSIZE:
      return 0;

    // 不画非客户区：告诉系统不必因激活状态变化重绘边框
    case WM_NCACTIVATE:
      return TRUE;

    case WM_ERASEBKGND:
      return 1;

    case WM_PAINT: {
      PAINTSTRUCT ps;
      BeginPaint(hwnd, &ps);
      render(s);
      EndPaint(hwnd, &ps);
      return 0;
    }

    case WM_MOUSEMOVE: {
      if (!s.dragging) return 0;
      s.selection = rect_from_points(s.origin_x, s.origin_y, GET_X_LPARAM(lparam),
                                     GET_Y_LPARAM(lparam));
      s.has_selection = true;
      render(s);
      return 0;
    }

    case WM_LBUTTONDOWN: {
      SetCapture(hwnd);
      s.origin_x = GET_X_LPARAM(lparam);
      s.origin_y = GET_Y_LPARAM(lparam);
      s.selection = PixelRect{s.origin_x, s.origin_y, s.origin_x, s.origin_y};
      s.dragging = true;
      s.has_selection = true;
      render(s);
      return 0;
    }

    case WM_LBUTTONUP: {
      ReleaseCapture();
      if (!s.dragging) return 0;
      s.dragging = false;
      if (is_click_not_drag(s.selection)) {
        // 误触：回到待框选状态，不退出
        s.has_selection = false;
        render(s);
        return 0;
      }
      finish(s, false);
      return 0;
    }

    // 右键取消：NOACTIVATE 窗口拿不到键盘，这个不依赖焦点的出口必须有
    case WM_RBUTTONUP:
      finish(s, true);
      return 0;

    // SW_SHOWNOACTIVATE 之后补了一次 SetFocus，拿到焦点时 Esc 走这里；
    // 焦点被别的窗口抢走时右键仍能取消
    case WM_KEYDOWN:
      if (wparam == VK_ESCAPE) {
        finish(s, true);
        return 0;
      }
      break;

    default:
      break;
  }
  return DefWindowProcW(hwnd, message, wparam, lparam);
}

}  // namespace

bool run_overlay(OverlayContext& ctx, OverlayResult& result) {
  WNDCLASSEXW wc{};
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = wnd_proc;
  wc.hInstance = ctx.instance;
  wc.hCursor = LoadCursorW(nullptr, IDC_CROSS);
  wc.lpszClassName = kClassName;
  if (!RegisterClassExW(&wc)) {
    ctx.error = L"注册框选窗口失败：" + format_win_error(GetLastError());
    result.cancelled = true;
    return false;
  }

  CaptureSession session;
  session.ctx = &ctx;
  session.result = &result;
  g_session = &session;

  const int x = GetSystemMetrics(SM_XVIRTUALSCREEN);
  const int y = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const int width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
  const int height = GetSystemMetrics(SM_CYVIRTUALSCREEN);

  /*
   * 显示时不抢前台激活：其他窗口不会因失活重绘标题栏 / 阴影，背景又是事先
   * 抓好的快照，所以看起来仍是原来的桌面。
   *
   * 没加 WS_EX_NOACTIVATE：那个样式让窗口收不到键盘，Esc 会失效。
   * 用 SW_SHOWNOACTIVATE 显示，再 SetFocus 把键盘接到本窗口；右键不依赖焦点，
   * 作为 Esc 没送到时的出口。主进程退出应用时会杀掉助手。
   */
  const HWND hwnd = CreateWindowExW(WS_EX_TOPMOST | WS_EX_TOOLWINDOW, kClassName, kWindowTitle,
                                    WS_POPUP, x, y, width, height, nullptr, nullptr,
                                    ctx.instance, nullptr);
  if (!hwnd) {
    ctx.error = L"创建框选窗口失败：" + format_win_error(GetLastError());
    result.cancelled = true;
    g_session = nullptr;
    return false;
  }
  session.hwnd = hwnd;

  if (!create_surfaces(session, width, height)) {
    ctx.error = L"无法为框选窗口分配绘制缓冲";
    result.cancelled = true;
    session.destroy();
    DestroyWindow(hwnd);
    g_session = nullptr;
    return false;
  }

  // 隐藏状态先把完整快照画进内存 DC，再一次性显示：
  // 用户看到的第一帧就是完整画面，不会出现“黑窗 → 画面”。
  render(session);
  ShowWindow(hwnd, SW_SHOWNOACTIVATE);
  // NOACTIVATE 显示后焦点还在原应用；把键盘焦点接到本窗口，Esc 才收得到。
  // 这里不激活应用（不调 SetForegroundWindow），只保证本窗口 key window。
  SetFocus(hwnd);

  MSG msg;
  BOOL ret = 0;
  while ((ret = GetMessageW(&msg, nullptr, 0, 0)) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }

  if (ret == -1 || !session.finished) result.cancelled = true;
  session.destroy();
  g_session = nullptr;
  return true;
}
