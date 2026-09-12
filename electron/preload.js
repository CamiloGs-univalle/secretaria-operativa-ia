// preload para mascota — expone API segura
const { ipcRenderer } = require('electron')
window.mascotaAPI = {
  onSync: (cb)=> ipcRenderer.on('sync-gmail', cb),
  onNotif: (cb)=> ipcRenderer.on('notif', cb),
  enviarInstruccion: (txt)=> ipcRenderer.send('instruccion', txt),
  onResult: (cb)=> ipcRenderer.on('instruccion-result', (e,d)=>cb(d))
}
