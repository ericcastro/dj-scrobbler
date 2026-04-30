const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // Renderer → Main (invocations)
  search1001tl: (ytUrl) => ipcRenderer.invoke('search-1001tl', ytUrl),
  getSet79Url:  (scUrl) => ipcRenderer.invoke('get-set79-url', scUrl),
  getStore:     ()      => ipcRenderer.invoke('store-get'),
  setStore:     (data)  => ipcRenderer.invoke('store-set', data),

  playerToggle: () => ipcRenderer.invoke('player-toggle'),
  openDevTools: () => ipcRenderer.invoke('open-devtools'),

  // Main → Renderer (push events)
  on: (channel, callback) => {
    const allowed = ['now-playing', 'wv-status', 'tracklist-loaded']
    if (!allowed.includes(channel)) return
    ipcRenderer.on(channel, (_event, ...args) => callback(...args))
  },
})
