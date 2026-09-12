import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/**
 * 改名前的应用目录名:
 * - 'fehelper-electron' 来自 package.json 的 name(开发模式)
 * - 'FeHelper'          来自 electron-builder 的 productName(打包版)
 */
const LEGACY_DIR_NAMES = ['FeHelper', 'fehelper-electron']

/**
 * 一次性数据迁移。
 *
 * userData 目录由 app.getName() 决定,应用改名后目录随之变化,
 * 不迁移的话用户会看到「笔记全没了」(文件其实还在旧目录里)。
 * 这里在新目录还没有配置文件时,从旧目录复制一份 config.json
 * (内含笔记、云同步配置、备份快照),只复制不删除,旧文件留作备份。
 */
export function migrateUserDataIfNeeded(): void {
  try {
    const currentName = app.getName()
    const appData = app.getPath('appData')
    const currentDir = app.getPath('userData')
    const currentConfig = path.join(currentDir, 'config.json')

    // 已有配置:要么已经迁移过,要么本来就是全新安装
    if (fs.existsSync(currentConfig)) return

    const source = LEGACY_DIR_NAMES.filter((name) => name !== currentName)
      .map((name) => path.join(appData, name, 'config.json'))
      .filter((file) => {
        try {
          return fs.statSync(file).isFile()
        } catch {
          return false
        }
      })
      // 两个旧目录都存在时(开发模式与打包版各存过一份),取最近改动的那份
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]

    if (!source) return

    fs.mkdirSync(currentDir, { recursive: true })
    fs.copyFileSync(source, currentConfig)
    console.log(`[migrate] 已从 ${source} 迁移配置到 ${currentConfig}`)
  } catch (error) {
    // 迁移失败不能挡住应用启动,旧文件也还在
    console.warn('[migrate] userData 迁移失败:', error)
  }
}
