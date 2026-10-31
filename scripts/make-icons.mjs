// make-icons.mjs: turns build/pong.svg into the PNG icons. Run with `npm run icons`.
// It runs inside Electron (not plain Node) because Chromium is the SVG renderer we
// already have: an offscreen window draws the SVG at each size and saves a screenshot.
//   build/icon.png      1024 px, electron-builder makes the .ico from it
//   build/tray.png      16 px tray icon
//   build/tray@2x.png   32 px, for 200% scaling
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const svg = readFileSync(join(ROOT, 'build/pong.svg'), 'utf8')
const SIZES = { 'icon.png': 1024, 'tray.png': 16, 'tray@2x.png': 32 }

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  // Draw once at 1024 px, then scale down: Chromium refuses windows as small as 16 px.
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true }
  })
  const html = `<html><body style="margin:0;background:transparent">
    ${svg.replace('<svg ', '<svg width="1024" height="1024" ')}</body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  for (const [file, size] of Object.entries(SIZES)) {
    writeFileSync(join(ROOT, 'build', file), image.resize({ width: size, height: size, quality: 'best' }).toPNG())
    console.log(`build/${file}  ${size}px`)
  }
  app.quit()
})
