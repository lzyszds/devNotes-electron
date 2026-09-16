import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.devnotes.app',
  appName: 'devNotes',
  webDir: 'dist',
  android: {
    // 允许用 chrome://inspect 调试 WebView
    webContentsDebuggingEnabled: true,
  },
}

export default config
