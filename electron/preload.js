// preload para mascota — expone API segura (RF-021, RF-026)
const { ipcRenderer } = require('electron')
window.mascotaAPI = {
  onSync: (cb)=> ipcRenderer.on('sync-gmail', cb),
  onNotif: (cb)=> ipcRenderer.on('notif', cb),
  enviarInstruccion: (txt)=> ipcRenderer.send('instruccion', txt),
  onResult: (cb)=> ipcRenderer.on('instruccion-result', (e,d)=>cb(d)),
  sendStats: (stats)=> ipcRenderer.send('mascota-stats', stats),
  sendFrecuencia: (freq)=> ipcRenderer.send('mascota-frecuencia', freq),
}
