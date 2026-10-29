#pragma once

#include <windows.h>

#include <string>

inline std::wstring format_win_error(DWORD code) {
  wchar_t* buffer = nullptr;
  const DWORD flags = FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
                      FORMAT_MESSAGE_IGNORE_INSERTS;
  const DWORD length = FormatMessageW(flags, nullptr, code, 0,
                                      reinterpret_cast<wchar_t*>(&buffer), 0, nullptr);
  std::wstring message;
  if (length && buffer) {
    message.assign(buffer, length);
    while (!message.empty() && (message.back() == L'\r' || message.back() == L'\n')) {
      message.pop_back();
    }
  }
  if (buffer) LocalFree(buffer);
  if (message.empty()) message = L"错误码 " + std::to_wstring(code);
  return message;
}

inline std::wstring format_win_error(HRESULT hr) {
  return format_win_error(static_cast<DWORD>(hr));
}
