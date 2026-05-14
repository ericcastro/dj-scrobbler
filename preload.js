const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getStore:     ()      => ipcRenderer.invoke('store-get'),
  setStore:     (data)  => ipcRenderer.invoke('store-set', data),
  getSources:   ()      => ipcRenderer.invoke('get-sources'),

  playerToggle:    ()      => ipcRenderer.invoke('player-toggle'),
  playerGotoTrack: (args) => ipcRenderer.invoke('player-goto-track', args),
  fallbackSeek:    (secs) => ipcRenderer.invoke('fallback-seek', secs),
  tlSeek:          (secs) => ipcRenderer.invoke('tl-seek', secs),
  loadSourceUrl:   (url)  => ipcRenderer.invoke('load-source-url', url),
  openDevTools: ()      => ipcRenderer.invoke('open-devtools'),

  lfmConnect:    ()     => ipcRenderer.invoke('lfm-connect'),
  lfmDisconnect: ()     => ipcRenderer.invoke('lfm-disconnect'),
  lfmSession:    ()     => ipcRenderer.invoke('lfm-session'),
  lfmStatusGet:  ()     => ipcRenderer.invoke('lfm-status-get'),

  setTheme:     (theme) => ipcRenderer.invoke('set-theme', theme),
  getVersion:   ()      => ipcRenderer.invoke('get-version'),
  openExternal: (url)   => ipcRenderer.invoke('open-external', url),

  on: (channel, callback) => {
    const allowed = ['now-playing', 'wv-status', 'tracklist-loaded', 'tracklist-data',
                     'lfm-status', 'menu-toggle-sidebar', 'menu-reload', 'fallback-progress',
                     'tl-progress']
    if (!allowed.includes(channel)) return
    ipcRenderer.on(channel, (_event, ...args) => callback(...args))
  },
})
