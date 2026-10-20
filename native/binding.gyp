{
  "targets": [
    {
      "target_name": "nonactivating",
      "sources": ["nonactivating.mm"],
      "xcode_settings": {
        "OTHER_LDFLAGS": ["-framework", "AppKit", "-framework", "Cocoa"],
        "MACOSX_DEPLOYMENT_TARGET": "10.15",
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17"
      }
    }
  ]
}
