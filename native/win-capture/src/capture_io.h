#pragma once

#include <windows.h>

#include <cstdint>
#include <string>
#include <vector>

#include "selection_state.h"

// 物理像素 BGRA，行序自上而下（DIB 使用负 biHeight）。
// alpha 由抓屏时统一填 0xFF，否则 GDI 留下的 alpha=0 会让 PNG 整张透明。
struct CapturedImage {
  PixelRect rect{};
  int stride = 0;
  std::vector<uint8_t> pixels;
};

// 抓取虚拟桌面的一块区域。SRCCOPY 走合成后的桌面，CAPTUREBLT 保留叠加层窗口。
// 失败时 error 里是给用户看的中文原因。
bool capture_desktop_region(const PixelRect& rect, CapturedImage& out, std::wstring& error);

// 把快照里的某块区域编码成 PNG。WIC 按 BGRA 接收，alpha 已在抓屏时填成不透明。
bool encode_png_region(const CapturedImage& source, const PixelRect& region,
                       const std::wstring& path, std::wstring& error);

// 整张快照编码。自检走这条，框选走 encode_png_region 只编码选区。
bool encode_png(const CapturedImage& image, const std::wstring& path, std::wstring& error);
