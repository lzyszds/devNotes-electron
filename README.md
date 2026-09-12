# DevNotes

基于 Chrome 扩展 **FeHelper (前端助手)** 改造的 Electron 桌面应用，原名 FeHelper Electron。

## 功能特性

- ✅ **30+ 开发工具** - JSON格式化、编解码、二维码、正则、时间戳等
- ✅ **原生桌面体验** - 系统托盘、快捷键、全局窗口控制
- ✅ **独立应用** - 无需浏览器扩展，直接运行

## 已实现工具

| 工具 | 状态 | 说明 |
|------|------|------|
| JSON 美化 | ✅ | JSON 格式化、排序、压缩 |
| 二维码 | ✅ | 生成和解码二维码 |
| 编码转换 | ✅ | Base64/URL/Unicode/MD5/SHA1 |
| 时间戳 | ✅ | 时间戳与日期互转 |
| 正则测试 | ✅ | 常用正则模板 |
| 密码生成 | ✅ | 随机密码生成器 |
| 工具市场 | ✅ | 工具安装管理 |

## 安装运行

### 前置要求

- Node.js 18+
- npm 或 yarn

### 安装步骤

```bash
cd fehelper-electron
npm install
npm start
```

### 打包应用

```bash
npm run build
```

打包后的应用将生成在 `dist/` 目录。

## 项目结构

```
fehelper-electron/
├── package.json          # 项目配置
├── src/
│   ├── main/
│   │   └── index.js     # Electron 主进程
│   ├── preload.js       # 预加载脚本（Chrome API 桥接）
│   └── renderer/
│       ├── popup/       # 工具面板
│       │   └── index.html
│       └── tools/       # 工具页面
│           ├── json-format/
│           ├── qr-code/
│           ├── en-decode/
│           ├── timestamp/
│           ├── regexp/
│           ├── password/
│           └── options/
├── assets/              # 图标资源
└── README.md
```

## API 桥接

本项目通过 `preload.js` 将 Chrome 扩展 API 桥接到 Electron：

- `chrome.runtime` → Electron IPC
- `chrome.storage` → electron-store
- `chrome.tabs` → BrowserWindow 管理
- `chrome.notifications` → Electron Notification
- `chrome.contextMenus` → Electron Menu

## 开发说明

### 添加新工具

1. 在 `src/renderer/tools/` 下创建工具目录
2. 创建 `index.html` 作为工具页面
3. 在 `src/main/index.js` 的 `openTool` 函数中添加标题映射
4. 在 `popup/index.html` 的 `TOOL_MAP` 中添加工具定义

### 快捷键

- `Alt+Shift+J` - 显示/隐藏主窗口

## 与原版差异

| 功能 | Chrome 扩展 | Electron 版本 |
|------|-------------|---------------|
| 浏览器注入 | ✅ 支持 | ❌ 不支持 |
| 内容脚本 | ✅ 支持 | ⚠️ 部分支持 |
| 截图工具 | ✅ | ⚠️ 受限于平台 |
| 系统通知 | ✅ | ✅ |
| 全局快捷键 | ✅ | ✅ |
| 系统托盘 | ❌ | ✅ |

## 许可证

MIT License - 与 [FeHelper 原版](https://github.com/zxlie/FeHelper) 保持一致

## 致谢

- 原版 FeHelper: [zxlie/FeHelper](https://github.com/zxlie/FeHelper)
- FeHelper 官网: [fehelper.com](https://fehelper.com)
