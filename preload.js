const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // One-way from renderer to main
  send: (channel, data) => {
    const validChannels = ['generate-files'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  // One-way from main to renderer
  receive: (channel, func) => {
    const validChannels = ['generation-complete'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },
  // Two-way from renderer to main
  invoke: (channel, data) => {
    const validChannels = ['open-file-dialog', 'open-external-link'];
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, data);
    }
  },
});
