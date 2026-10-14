// 创世小镇 - 预加载脚本：暴露最小文件 IO 给渲染层
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gdIO', {
  saveFile: (name, content) => ipcRenderer.invoke('gd:save-file', name, content),
  loadFile: () => ipcRenderer.invoke('gd:load-file'),
  // 数据存储路径
  getDataDir: () => ipcRenderer.invoke('gd:get-data-dir'),
  chooseDataDir: () => ipcRenderer.invoke('gd:choose-data-dir'),
  isPortable: () => ipcRenderer.invoke('gd:is-portable'),
  // 存档文件读写（自定义数据路径）
  saveData: (content) => ipcRenderer.invoke('gd:save-data', content),
  loadData: () => ipcRenderer.invoke('gd:load-data'),
  clearData: () => ipcRenderer.invoke('gd:clear-data')
});
