import { BrowserWindow, nativeImage, type NativeImage } from 'electron'

/*
 * 菜单栏「两行迷你仪表」。
 *
 * macOS 的 Tray.setTitle 只有单行、字号固定，塞两行会被菜单栏裁掉。所以把
 * 「应用图标 + 上下两行读数」画成一张 @2x 位图当托盘图标：
 *  - 离屏 BrowserWindow 用系统等宽字体栅格化：抗锯齿正常，不再是 5×7 点阵；
 *  - 左侧保留彩色应用 icon（与普通托盘一致），不再整图替换成纯文字；
 *  - 文字纯黑、无光晕，观感接近系统 setTitle；彩色 icon 叠在左侧；
 *  - 不做 setTemplateImage（否则彩色 logo 会被压成剪影）；
 *  - 只在文字变化时重绘；painter 窗口常驻复用。
 */

export interface TrayCell {
  label: string
  value: string
}

/** 一列 = 上下两个读数，列内标签宽度、数值宽度各自对齐 */
export type TrayColumn = [TrayCell, TrayCell]

const SCALE = 2
/** 菜单栏图标逻辑高度（pt） */
const HEIGHT_PT = 22
/** 与 createTray 里 resize(22) 一致，别再缩成 16 显得比旁边系统图标矮一截 */
const ICON_PT = 22

let painter: BrowserWindow | null = null
let painterReady: Promise<BrowserWindow> | null = null

function ensurePainter(): Promise<BrowserWindow> {
  if (painter && !painter.isDestroyed()) return Promise.resolve(painter)
  if (painterReady) return painterReady

  painterReady = (async () => {
    const win = new BrowserWindow({
      show: false,
      width: 320 * SCALE,
      height: HEIGHT_PT * SCALE,
      useContentSize: true,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      skipTaskbar: true,
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    win.setMenuBarVisibility(false)
    await win.loadURL('about:blank')
    painter = win
    win.on('closed', () => {
      if (painter === win) painter = null
      painterReady = null
    })
    return win
  })()

  return painterReady
}

/** 应用退出时关掉离屏窗口，避免残留进程 */
export function disposeTrayPainter() {
  painterReady = null
  if (painter && !painter.isDestroyed()) {
    painter.destroy()
  }
  painter = null
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function pad(text: string, width: number, right: boolean): string {
  const t = text.slice(0, width)
  return right ? t.padStart(width, ' ') : t.padEnd(width, ' ')
}

/** 裁掉右侧空白，并带上 @2x scaleFactor */
function finalizeImage(shot: NativeImage, contentWidthPx: number): NativeImage {
  const { height } = shot.getSize()
  const width = Math.max(1, Math.min(shot.getSize().width, contentWidthPx))
  const srcFull = Buffer.from(shot.toBitmap())
  const srcW = shot.getSize().width
  const out = Buffer.alloc(width * height * 4)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * srcW + x) * 4
      const di = (y * width + x) * 4
      out[di] = srcFull[si]
      out[di + 1] = srcFull[si + 1]
      out[di + 2] = srcFull[si + 2]
      out[di + 3] = srcFull[si + 3]
    }
  }

  return nativeImage.createFromBitmap(out, {
    width,
    height,
    scaleFactor: SCALE,
  })
}

/**
 * 把若干列画成一张托盘位图（含可选应用图标）。
 * 返回 null 表示没有可画的内容（调用方退回普通图标）。
 */
export async function renderTrayDual(
  columns: TrayColumn[],
  baseIcon?: NativeImage | null,
): Promise<NativeImage | null> {
  if (columns.length === 0) return null

  const win = await ensurePainter()
  if (win.isDestroyed()) return null

  /*
   * 用原图缩到 22pt @2x = 44px 再画，避免拿已经缩过的 22 逻辑像素去拉伸。
   */
  let iconDataUrl = ''
  if (baseIcon && !baseIcon.isEmpty()) {
    const paintIcon = baseIcon.resize({
      width: ICON_PT * SCALE,
      height: ICON_PT * SCALE,
      quality: 'best',
    })
    iconDataUrl = paintIcon.toDataURL()
  }

  /*
   * 显式按「列」包一层，避免 grid-auto-flow 在不同 Chromium 版本上表现不一致；
   * 列内标签左齐、数值右齐，上下两行个位对齐。
   */
  const columnsHtml = columns
    .map((col) => {
      const labelW = Math.max(col[0].label.length, col[1].label.length)
      const valueW = Math.max(col[0].value.length, col[1].value.length)
      const lines = [0, 1]
        .map((i) => {
          const value = escapeHtml(pad(col[i].value, valueW, true))
          // label 为空就只画数字（账户列故意不挂 PNL/EQ）
          if (!col[i].label || labelW === 0) {
            return `<div class="cell"><span class="value">${value}</span></div>`
          }
          const label = escapeHtml(pad(col[i].label, labelW, false))
          return `<div class="cell"><span class="label">${label}</span><span class="value">${value}</span></div>`
        })
        .join('')
      return `<div class="col">${lines}</div>`
    })
    .join('')

  /*
   * 在 @2x 缓冲里用「逻辑 pt × SCALE」的 CSS 像素画，capture 后按 scaleFactor:2
   * 交给菜单栏，Retina 上才是真抗锯齿，而不是 1x 位图被拉大。
   */
  const html = `<!doctype html>
<html><head><style>
  /* 离屏窗一旦内容略超高/宽，Chromium 会画出系统滚动条，capture 时会被烤进托盘图 */
  html, body {
    margin: 0; padding: 0; background: transparent;
    overflow: hidden;
    width: auto; height: ${HEIGHT_PT * SCALE}px;
  }
  ::-webkit-scrollbar { display: none; width: 0; height: 0; }
  .row {
    display: inline-flex; align-items: center; height: ${HEIGHT_PT * SCALE}px;
    gap: ${4 * SCALE}px; padding: 0 ${2 * SCALE}px; box-sizing: border-box;
    max-height: ${HEIGHT_PT * SCALE}px;
  }
  .icon {
    width: ${ICON_PT * SCALE}px; height: ${ICON_PT * SCALE}px; flex: none;
    object-fit: contain;
    display: block; /* 避免 img 基线空隙把行撑出滚动条 */
  }
  .grid {
    display: flex;
    align-items: center;
    gap: ${10 * SCALE}px;
    height: 100%;
  }
  .col {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: ${1 * SCALE}px;
  }
  .cell {
    display: flex; align-items: baseline; gap: ${3 * SCALE}px;
    font: 400 ${9 * SCALE}px/${10.5 * SCALE}px ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    white-space: pre;
    font-variant-numeric: tabular-nums;
    /* 纯黑、无描边无阴影：跟右边系统 setTitle 一个观感，不再糊一圈光晕 */
    color: #111;
    -webkit-font-smoothing: antialiased;
  }
  .label { opacity: 0.55; font-weight: 400; }
  .value { font-weight: 400; }
</style></head><body>
  <div class="row" id="row">
    ${iconDataUrl ? `<img class="icon" src="${iconDataUrl}" alt="" />` : ''}
    <div class="grid">${columnsHtml}</div>
  </div>
</body></html>`

  await win.webContents.executeJavaScript(
    `document.open();document.write(${JSON.stringify(html)});document.close();0`,
  )

  // 等一帧布局，再按内容宽度收窗口，避免右侧大片透明把托盘撑宽
  const contentWidth = (await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      requestAnimationFrame(() => {
        const row = document.getElementById('row');
        resolve(row ? Math.ceil(row.getBoundingClientRect().width) + ${2 * SCALE} : 0);
      });
    })
  `)) as number

  if (!contentWidth || contentWidth < 8) return null

  const pixelW = Math.ceil(contentWidth)
  const pixelH = HEIGHT_PT * SCALE
  win.setContentSize(pixelW, pixelH)
  await new Promise((r) => setTimeout(r, 24))

  const shot = await win.webContents.capturePage({
    x: 0,
    y: 0,
    width: pixelW,
    height: pixelH,
  })
  if (shot.isEmpty()) return null

  return finalizeImage(shot, pixelW)
}

/** 金额读数：带符号可选，≥1000 折成 1.2K，保证最多 5 个字符 */
export function formatTrayMoney(value: number, withSign: boolean): string {
  const sign = value < 0 ? '-' : withSign ? '+' : ''
  const abs = Math.abs(value)
  const body =
    abs >= 10_000
      ? `${Math.round(abs / 1000)}K`
      : abs >= 1000
        ? `${(abs / 1000).toFixed(1)}K`
        : `${Math.round(abs)}`
  return `${sign}${body}`
}
