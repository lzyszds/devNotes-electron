#define _WIN32_WINNT 0x0A00
#include "capture_io.h"

#include <shlwapi.h>
#include <wincodec.h>

#include <cstring>

#include "win_error.h"

namespace {

// 用固定 GUID 而不是 GUID_WICPixelFormat32bppBGRA，少一层 windowscodecs.lib 的常量依赖。
const GUID kPixelFormatBGRA = {
    0x6fddc324, 0x4e03, 0x4bfe, {0xb1, 0x85, 0x3d, 0x77, 0x76, 0x8d, 0xc9, 0x0f}};

// GDI 的 BitBlt 写 32bpp BI_RGB 时高字节可能是 0；WIC 按 BGRA 编码会把它当
// 完全透明。这里统一补齐 alpha，顺便让颜色处理不再依赖驱动行为。
void force_opaque_alpha(std::vector<uint8_t>& pixels) {
  for (size_t i = 3; i < pixels.size(); i += 4) pixels[i] = 0xFF;
}

}  // namespace

bool capture_desktop_region(const PixelRect& rect, CapturedImage& out, std::wstring& error) {
  if (rect.empty()) {
    error = L"选区为空";
    return false;
  }
  out.rect = rect;
  out.stride = rect.width() * 4;
  const size_t size = static_cast<size_t>(out.stride) * static_cast<size_t>(rect.height());

  BITMAPINFO info{};
  info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  info.bmiHeader.biWidth = rect.width();
  // 负数 = 自上而下，和 PNG 行序一致，编码时不必翻转
  info.bmiHeader.biHeight = -rect.height();
  info.bmiHeader.biPlanes = 1;
  info.bmiHeader.biBitCount = 32;
  info.bmiHeader.biCompression = BI_RGB;

  HDC screen = GetDC(nullptr);
  HDC memory = screen ? CreateCompatibleDC(screen) : nullptr;
  void* bits = nullptr;
  HBITMAP bitmap = screen && memory
                       ? CreateDIBSection(screen, &info, DIB_RGB_COLORS, &bits, nullptr, 0)
                       : nullptr;
  if (!screen || !memory || !bitmap || !bits) {
    if (bitmap) DeleteObject(bitmap);
    if (memory) DeleteDC(memory);
    if (screen) ReleaseDC(nullptr, screen);
    error = L"无法为截图分配内存";
    return false;
  }

  HGDIOBJ old = SelectObject(memory, bitmap);
  // 必须在显示框选窗口之前完成这次 blit，否则会把框选层自己拍进去。
  const BOOL ok = BitBlt(memory, 0, 0, rect.width(), rect.height(), screen, rect.left, rect.top,
                         SRCCOPY | CAPTUREBLT);
  GdiFlush();
  SelectObject(memory, old);

  out.pixels.resize(size);
  std::memcpy(out.pixels.data(), bits, size);
  force_opaque_alpha(out.pixels);

  DeleteObject(bitmap);
  DeleteDC(memory);
  ReleaseDC(nullptr, screen);

  // BitBlt 部分驱动在受限远程会话里会返回 0，但像素通常仍是有效的；
  // 只有失败且内容全空时才判为不可用，纯黑桌面不算失败。
  if (!ok) {
    bool any_nonzero = false;
    for (size_t i = 0; i < out.pixels.size(); ++i) {
      if (out.pixels[i]) {
        any_nonzero = true;
        break;
      }
    }
    if (!any_nonzero) {
      out.pixels.clear();
      error = L"未能读取桌面画面，请确认没有处于受限的远程会话";
      return false;
    }
  }
  return true;
}

bool encode_png_region(const CapturedImage& source, const PixelRect& region,
                       const std::wstring& path, std::wstring& error) {
  const PixelRect r = clip_to_bounds(region, source.rect);
  if (r.empty()) {
    error = L"选区为空";
    return false;
  }
  const int width = r.width();
  const int height = r.height();
  const size_t row_bytes = static_cast<size_t>(width) * 4;
  std::vector<uint8_t> rows(row_bytes * static_cast<size_t>(height));
  const int offset_x = r.left - source.rect.left;
  const int offset_y = r.top - source.rect.top;
  const uint8_t* base = source.pixels.data() + static_cast<size_t>(offset_y) * source.stride +
                        static_cast<size_t>(offset_x) * 4;
  for (int y = 0; y < height; ++y) {
    std::memcpy(rows.data() + static_cast<size_t>(y) * row_bytes,
                base + static_cast<size_t>(y) * source.stride, row_bytes);
  }

  IWICImagingFactory* factory = nullptr;
  IWICBitmapEncoder* encoder = nullptr;
  IStream* stream = nullptr;
  IWICBitmapFrameEncode* frame = nullptr;
  IPropertyBag2* props = nullptr;
  HRESULT hr = CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(&factory));
  if (SUCCEEDED(hr)) {
    hr = SHCreateStreamOnFileEx(path.c_str(), STGM_CREATE | STGM_WRITE | STGM_SHARE_DENY_WRITE,
                                FILE_ATTRIBUTE_NORMAL, TRUE, nullptr, &stream);
  }
  if (SUCCEEDED(hr)) hr = factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, &encoder);
  if (SUCCEEDED(hr)) hr = encoder->Initialize(stream, WICBitmapEncoderNoCache);
  if (SUCCEEDED(hr)) hr = encoder->CreateNewFrame(&frame, &props);
  if (SUCCEEDED(hr)) hr = frame->Initialize(props);
  if (SUCCEEDED(hr)) hr = frame->SetSize(static_cast<UINT>(width), static_cast<UINT>(height));
  WICPixelFormatGUID format = kPixelFormatBGRA;
  if (SUCCEEDED(hr)) hr = frame->SetPixelFormat(&format);
  if (SUCCEEDED(hr) && !IsEqualGUID(format, kPixelFormatBGRA)) {
    hr = WINCODEC_ERR_UNSUPPORTEDPIXELFORMAT;
  }
  if (SUCCEEDED(hr)) {
    hr = frame->WritePixels(static_cast<UINT>(height), static_cast<UINT>(row_bytes),
                            static_cast<UINT>(rows.size()), rows.data());
  }
  if (SUCCEEDED(hr)) hr = frame->Commit();
  if (SUCCEEDED(hr)) hr = encoder->Commit();

  if (props) props->Release();
  if (frame) frame->Release();
  if (encoder) encoder->Release();
  if (stream) stream->Release();
  if (factory) factory->Release();

  if (FAILED(hr)) {
    error = L"PNG 编码失败：" + format_win_error(hr);
    return false;
  }
  return true;
}

bool encode_png(const CapturedImage& image, const std::wstring& path, std::wstring& error) {
  return encode_png_region(image, image.rect, path, error);
}
