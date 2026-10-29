cmake_minimum_required(VERSION 3.20)
project(devnotes-capture LANGUAGES CXX)

# 只依赖 Win32 系统库，不用 vcpkg / 第三方运行时，减小安装包与启动开销。
add_executable(devnotes-capture WIN32
  src/main.cpp
  src/overlay.cpp
  src/capture_io.cpp
  src/selftest.cpp
)
target_compile_features(devnotes-capture PRIVATE cxx_std_20)
target_compile_definitions(devnotes-capture PRIVATE
  UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN
)

# WIC：PNG 编解码（系统自带）；其余为 Win32 基础库
target_link_libraries(devnotes-capture PRIVATE windowscodecs shlwapi ole32 user32 gdi32)

# 固定产物路径：脚本 / CI / extraResources 都按 build/Release 查找。
# 生成器是 Ninja（单配置）。RUNTIME_OUTPUT_DIRECTORY 对单配置生成器才生效；
# 只设 *_RELEASE 时 Ninja 会忽略，exe 落到 build/ 根目录，打包就找不到。
set_target_properties(devnotes-capture PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/build/Release"
  OUTPUT_NAME "devnotes-capture"
)

# 选区坐标逻辑不依赖 Windows API，可以在任意平台和 CI 上单独跑
add_executable(devnotes-capture-test tests/selection_state_test.cpp)
target_include_directories(devnotes-capture-test PRIVATE src)
target_compile_features(devnotes-capture-test PRIVATE cxx_std_20)

enable_testing()
add_test(NAME selection_state COMMAND devnotes-capture-test)
