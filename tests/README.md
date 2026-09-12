# 测试

两层，各管一段，互不替代：

| 目录 | 跑什么 | 命令 |
|---|---|---|
| `unit/` | 纯函数原语（`editorView` 的文档操作、`markdownFormat` 的规范化、字数统计、快捷插入片段） | `npm run test:unit` |
| `e2e/` | 真实打包产物里的右键菜单、暗色配色、布局稳定性、无边框窗口 | `npm run test:e2e` |

`npm test` 先跑单测再跑 E2E。

## 单元测试

用 Node 内置的 test runner（`node --test`），直接 import `src/utils/*.ts` —— Node 24 默认开启类型擦除，这些模块又不碰 DOM，所以**不需要打包器，也不需要 jsdom**。

`src/` 里的相对导入都写成 `'./markdownStats'` 这种无扩展名形式（tsconfig 是 `moduleResolution: bundler`），Node 原生 ESM 解析不了，所以 `tests/lib/ts-resolve.mjs` 挂了一个 resolve 钩子补 `.ts`。为了测试去改 60 多处源码不值得，钩子只有十几行。

组件（`.tsx`）不在单测范围内：Node 的类型擦除不处理 JSX。

## 端到端测试

`driver.mjs` 启动真实的 `dist-electron/main.js`，用 CDP（`--remote-debugging-port`）把 `checks/*.js` 注入渲染进程执行。检查脚本不是模块，而是**片段**：driver 把它和 `lib/harness.js` 拼成一段 async IIFE 再求值，所以脚本里可以直接用 `check()` / `q()` / `openEditorMenu()` 这些工具，最后 `return { checks, notes, errors }`。

因为片段带顶层 `await` 又不构成模块，`checks/*.js` **不能**直接 `node --check`，语法错误会在运行时以「脚本抛异常」的形式报出来。

```bash
npm run test:e2e                    # 先 build 再跑全部检查
npm run test:e2e:run                # 不重新 build，直接跑
npm run test:e2e:run editor-menu    # 只跑某一个检查
node tests/e2e/driver.mjs --verbose # 通过的断言也逐条打印
node tests/e2e/driver.mjs --keep    # 保留隔离目录，便于事后排查
```

新增检查：在 `checks/` 下放一个 `.js` 片段即可，driver 会自动发现（按文件名排序）。

**每个检查都会重启一次应用。** 笔记是落盘的，检查之间共用同一个页面会互相污染（前一个检查改过正文，后一个检查的撤销基线就错位了）；只有重启才真正回到夹具那个起点。

### 三条不能动的安全底线

> 这里真出过事故：测试夹具的笔记被自动同步推到了用户真实的 Cloudflare KV（键 `fehelper_notes_backup`）。起因是一个想当然的假设 ——「夹具里不放 `fehelper-cf-sync-config`，没有凭据就不会联网」。**它是错的**，于是有了下面三条。

1. **必须带 `--user-data-dir` 指向 `tests/e2e/.userdata`**，绝不能沿用真实 userData。
2. **夹具里的 `fehelper-cf-sync-config` 必须显式写。** 省掉它不是「没有凭据」，而是让应用退回 `DEFAULT_CF_CONFIG` —— 那份默认值里 `workerUrl` 是硬编码的真实地址，`enabled` / `autoSync` / `autoSyncOnStartup` 全为 `true`。而且这份配置必须满足 `enabled: false` **且 `workerUrl` 非空**：`loadCloudflareConfig()` 末尾有个分支，只要 `workerUrl` 为空就强制 `enabled = true` 并填回真实地址，把配置就地改写。夹具里的 `workerUrl` 指向 `http://127.0.0.1:9`（discard 端口），逻辑被绕过也打不出去。
3. **启动后回读应用自己认到的配置**（`assertSyncBlocked()`，electron-store 与 localStorage 都查）。夹具写得对是一回事，应用有没有把它改回去是另一回事。任一处显示同步开着，就当场杀进程、以退出码 3 结束。

另外，**每次启动前整个 `.userdata` 目录都会被删掉重建**，不是只重写 `config.json`：Chromium 自己的 Local Storage 也在那个目录里，而 `loadCloudflareConfig()` 在 store 读不到东西时会回退去读 localStorage 的同名配置 —— 一份上一轮遗留的「`enabled: true` + 真实 workerUrl」就藏在那儿（这条是护栏真抓出来的）。夹具写完立刻断言内容符合预期；这一步失败就直接退出，因为 `electron/main.ts` 的 `migrateUserDataIfNeeded()` 会把用户真实目录的配置（含 CF 凭据）搬进来。启动参数里还带了 `--host-resolver-rules`，把真实 worker 域名解析到 `127.0.0.1`，作为网络层的兜底。

`.userdata/` 已在 `.gitignore` 里。

### 环境相关

本机 Windows 显示缩放 125%。窗口是**无边框**的（系统的标题栏与菜单栏都不要，顶部只留应用自绘的那条 `.drag-region`），所以 1280×800 的窗口现在整个 **1280×800 CSS px** 都是可用视口 —— 改造前外框比内容区多出 14×62 CSS px（系统标题栏 + Electron 默认菜单栏），`frameless.js` 的第一条断言量的就是这个差值必须为 0。

菜单类 UI 的高度断言要按**实际视口**来，别照窗口尺寸想当然 —— `editor-menu.js` 里的「根菜单不溢出视口」就是靠这条抓出过 bug（根菜单曾经高 716px 且被入场动画的 `scale(0.96)` 量小，贴边收拢算不够）。
