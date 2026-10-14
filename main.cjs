// 创世小镇 - Electron 主进程
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

app.setAppUserModelId('com.godtown.game');
Menu_remove();

function Menu_remove() {
  try { require('electron').Menu.setApplicationMenu(null); } catch (e) { /* 忽略 */ }
}

let win = null;

// ---------- 自定义数据存储路径 ----------
// 数据路径配置文件：记录用户选择的数据存储目录
const DATA_PATH_FILE = () => path.join(app.getPath('userData'), 'data-path.json');

function getDataDir() {
  // 命令行参数优先（--data-dir=<path>：用于指定数据目录，不改默认行为避免影响冒烟测试）
  const arg = process.argv.find(a => a.startsWith('--data-dir='));
  if (arg) {
    const dir = arg.slice('--data-dir='.length);
    try {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch { /* 无效路径，继续往下 */ }
  }
  try {
    const raw = fs.readFileSync(DATA_PATH_FILE(), 'utf8');
    const cfg = JSON.parse(raw);
    if (cfg.dir && fs.existsSync(cfg.dir)) return cfg.dir;
  } catch { /* 首次运行或配置损坏，用默认 */ }
  return app.getPath('userData');
}

function setDataDir(dir) {
  fs.writeFileSync(DATA_PATH_FILE(), JSON.stringify({ dir }, null, 1), 'utf8');
}

// 查询当前数据存储路径
ipcMain.handle('gd:get-data-dir', () => getDataDir());

// 选择新的数据存储路径
ipcMain.handle('gd:choose-data-dir', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择数据存储位置',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: getDataDir()
  });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
  const dir = r.filePaths[0];
  // 迁移现有存档文件（如果有）
  const oldDir = getDataDir();
  const saveFile = 'godtown-save.json';
  const oldSave = path.join(oldDir, saveFile);
  const newSave = path.join(dir, saveFile);
  try {
    if (fs.existsSync(oldSave) && !fs.existsSync(newSave)) {
      fs.copyFileSync(oldSave, newSave);
    }
  } catch { /* 迁移失败不阻断 */ }
  setDataDir(dir);
  return { ok: true, dir };
});

// 存档文件读写（自定义数据路径下的文件存储）
ipcMain.handle('gd:save-data', async (e, content) => {
  try {
    const dir = getDataDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'godtown-save.json'), content, 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('gd:load-data', async () => {
  try {
    const p = path.join(getDataDir(), 'godtown-save.json');
    if (!fs.existsSync(p)) return { ok: false, empty: true };
    const text = fs.readFileSync(p, 'utf8');
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('gd:clear-data', async () => {
  try {
    const p = path.join(getDataDir(), 'godtown-save.json');
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// 判断是否为便携版（PORTABLE_EXECUTABLE_DIR 环境变量由 electron-builder 便携版注入）
ipcMain.handle('gd:is-portable', () => !!process.env.PORTABLE_EXECUTABLE_DIR);

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    title: '创世小镇',
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('page-title-updated', (e) => e.preventDefault());
}

// 文件导出：世界快照导出为 JSON（跨设备迁移）
ipcMain.handle('gd:save-file', async (e, name, content) => {
  const r = await dialog.showSaveDialog(win, {
    title: '导出世界快照',
    defaultPath: name || '创世小镇.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(r.filePath, content, 'utf8');
    return { ok: true, path: r.filePath };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// 文件导入：读取世界快照 JSON（跨设备迁移）
ipcMain.handle('gd:load-file', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '导入世界快照',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
  try {
    const text = fs.readFileSync(r.filePaths[0], 'utf8');
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
