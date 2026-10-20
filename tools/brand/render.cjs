// Draws brand images from an HTML source with Electron, once its fonts have loaded.
//
//   electron tools/brand/render.cjs <source.html> <out dir> name=WIDTHxHEIGHT ...
//
// Each name is both the source's ?kind= (banner) and the file written (banner.png).
// From PowerShell or Git Bash, clear ELECTRON_RUN_AS_NODE first, and give no bare numbers
// as arguments (Electron then exits at once).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const [source, outDir, ...jobs] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  for (const job of jobs) {
    const [name, size] = job.split('=');
    const [width, height] = size.split('x').map(Number);
    const win = new BrowserWindow({ width, height, useContentSize: true, show: false, frame: false, webPreferences: { offscreen: true } });
    await win.loadURL(`${pathToFileURL(path.resolve(source)).href}?kind=${name}`);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => document.fonts.size)');
    await new Promise((r) => setTimeout(r, 500));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
    const file = path.join(outDir, `${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    const s = image.getSize();
    console.log(`${file}: ${s.width} x ${s.height}`);
    win.destroy();
  }
  app.quit();
});
