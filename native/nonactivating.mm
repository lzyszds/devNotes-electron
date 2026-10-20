#include <node_api.h>
#import <AppKit/AppKit.h>

/*
 * 把窗口设成 non-activating：交互（点击、hover、成为 key window）不会激活 app，
 * 唤出面板前那个应用的焦点得以保留。
 *
 * 关键：用 N-API（node_api.h）而不是 V8 API —— N-API 是稳定 ABI，用 Node headers
 * 编译出的 .node 在 Electron 里也能直接加载，不用 electron-rebuild。
 */

static napi_value MakeNonActivating(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  void* data = nullptr;
  size_t len = 0;
  if (argc < 1 ||
      napi_get_buffer_info(env, args[0], &data, &len) != napi_ok ||
      !data ||
      len < sizeof(void*)) {
    napi_throw_type_error(env, nullptr, "expected window handle Buffer");
    return nullptr;
  }

  // getNativeWindowHandle 返回的 Buffer 内容是 NSView* 的地址值（8 字节）
  NSView* view = *reinterpret_cast<NSView* const*>(data);
  NSWindow* window = view ? [view window] : nil;
  if (!window) {
    napi_throw_type_error(env, nullptr, "no NSWindow for the given handle");
    return nullptr;
  }

  // 追加 nonactivating mask —— 注意是 |= 追加，绝不能 setStyleMask 整体覆盖，
  // 否则会丢掉窗口原有的边框/标题等样式。
  window.styleMask |= NSWindowStyleMaskNonactivatingPanel;

  // 事后改 mask，WindowServer 不会自动更新激活标签，必须手动同步。
  // _setPreventsActivation: 是 NSWindow 的私有 SPI（对应 kCGSPreventsActivationTagBit）。
  SEL sel = NSSelectorFromString(@"_setPreventsActivation:");
  if ([window respondsToSelector:sel]) {
    [window performSelector:sel withObject:@(YES)];
  }

  return nullptr;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "makeNonActivating", NAPI_AUTO_LENGTH,
                       MakeNonActivating, nullptr, &fn);
  napi_set_named_property(env, exports, "makeNonActivating", fn);
  return exports;
}
