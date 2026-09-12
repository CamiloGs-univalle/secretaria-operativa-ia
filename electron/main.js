const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, shell } = require('electron')
const path = require('path')
let win, tray
let Store
try{ Store = require('electron-store') }catch(e){ Store = null }
const store = Store ? new Store({ name:'mascota-config' }) : { get:(k,d)=>d, set:()=>{} }
const isDev = process.argv.includes('--dev')
const PROD_URL = 'https://secretaria-operativa-ia.vercel.app'

function createWindow(){
  win = new BrowserWindow({
    width: 380, height: 560,
    minWidth: 320, minHeight: 460,
    frame: true,
    transparent: false,
    backgroundColor: '#f8fafc',
    alwaysOnTop: true,
    skipTaskbar: false, resizable: true,
    show: false,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { 
      nodeIntegration: false, 
      contextIsolation: true, 
      preload: path.join(__dirname,'preload.js'),
      webSecurity: false
    }
  })

  const url = isDev ? 'http://localhost:5174' : PROD_URL
  console.log('[Mascota] cargando:', url)
  win.loadURL(url).catch(e=> console.error('loadURL failed', e))

  win.once('ready-to-show', ()=> {
    win.show()
    // Flotante en escritorio: abajo-derecha, siempre visible como mano derecha
    try{
      const { screen } = require('electron')
      const disp = screen.getPrimaryDisplay().workArea
      win.setPosition(Math.max(0, disp.width - 400), Math.max(0, disp.height - 600))
      win.setAlwaysOnTop(true, 'floating')
    }catch{}
  })

  win.webContents.setWindowOpenHandler(({url})=>{ shell.openExternal(url); return {action:'deny'} })
  win.webContents.on('did-fail-load', (e, code, desc, url)=> {
    console.error('did-fail-load', code, desc, url)
  })

  if(isDev) win.webContents.openDevTools({mode:'detach'})
}

function getFrequencyHours(){
  const freq = store.get('frecuencia','3h')
  if(freq==='1h') return [8,9,10,11,12,13,14,15,16,17]
  if(freq==='6h') return [8,14]
  return [8,11,14,17]
}

function buildTrayMenu(){
  const freq = store.get('frecuencia','3h')
  return Menu.buildFromTemplate([
    { label: 'Mostrar mascota', click: ()=> { if(win) win.show() } },
    { label: 'Sincronizar Gmail', click: ()=> { if(win) win.webContents.send('sync-gmail'); new Notification({title:'Secretaria IA', body:'Sincronizando Gmail real...'}).show() } },
    { label: 'Abrir web', click: ()=> shell.openExternal(PROD_URL) },
    { type:'separator' },
    { label: 'Iniciar con Windows', type:'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (m)=> app.setLoginItemSettings({ openAtLogin: m.checked, openAsHidden:false }) },
    { label: 'Frecuencia', submenu:[
      { label:'Cada 1h', type:'radio', checked: freq==='1h', click: ()=>{ store.set('frecuencia','1h'); updateTray(); new Notification({title:'Mascota', body:'Frecuencia: cada 1 hora'}).show() } },
      { label:'Cada 3h', type:'radio', checked: freq==='3h', click: ()=>{ store.set('frecuencia','3h'); updateTray(); new Notification({title:'Mascota', body:'Frecuencia: cada 3 horas (8,11,14,17)'}).show() } },
      { label:'Cada 6h', type:'radio', checked: freq==='6h', click: ()=>{ store.set('frecuencia','6h'); updateTray(); new Notification({title:'Mascota', body:'Frecuencia: cada 6 horas (8,14)'}).show() } },
    ]},
    { type:'separator' },
    { label: 'Quitar', click: ()=> app.quit() }
  ])
}

function updateTray(){
  try{
    const menu = buildTrayMenu()
    if(tray) tray.setContextMenu(menu)
  }catch(e){ console.error('updateTray', e) }
}

function createTray(){
  try{
    const icon = nativeImage.createFromDataURL('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="%231e40af"/><text x="16" y="21" text-anchor="middle" fill="white" font-size="14">🐶</text></svg>')
    tray = new Tray(icon)
    const ctx = buildTrayMenu()
    tray.setToolTip('Secretaria Operativa IA — Mascota (conectada a Vercel)')
    tray.setContextMenu(ctx)
    tray.on('click', ()=> { if(!win) return; win.isVisible() ? win.hide() : win.show() })
  }catch(e){ console.error('tray error', e)}
}

let lastStats = null
function scheduleNotifications(){
  setInterval(()=>{
    const h = new Date().getHours()
    const mins = new Date().getMinutes()
    if(mins!==0) return
    const hours = getFrequencyHours()
    if(!hours.includes(h)) return
    // Anti-duplicado mismo día+hora
    const key = `notif_${new Date().toISOString().slice(0,10)}_${h}`
    if(store.get(key,false)) return
    store.set(key,true)
    // reset keys al día siguiente se limpia solo con nueva fecha
    let body
    if(lastStats){
      const {crit=0,alta=0,venc=0,total=0}=lastStats
      if(h===8) body=`¡Buenos días Coordinadora! ☀️ Resumen inicial: ${crit} críticas, ${alta} altas, ${total} procesos activos.${venc?` ⚠️ ${venc} vencida(s)`:''}`
      else if(h===11) body=`Actualización 11:00 🟡 ${crit} críticas • ${alta} altas • ${venc} vencidas. ${venc?'¡Atienda las vencidas!':''}`
      else if(h===14) body=`Revisión 14:00 🟠 Quedan ${lastStats.esperando||0} esperando respuesta externa. Recuerde dejar 30% libre.`
      else body=`Cierre 17:00 📋 ${total} procesos, ${venc} vencidos, ${crit} críticos. ¿Marcamos algún listo?`
    } else {
      body = h===8?'¡Buenos días Señora! Tienes procesos críticos pendientes.' : h===11?'Actualización: revise seguimientos que vencen hoy.' : h===14?'Revisión de la tarde — verifique reprogramaciones.' : 'Cierre del día — revise procesos por cerrar.'
    }
    new Notification({ title:'Secretaria Operativa IA', body, silent:false }).show()
    if(win) win.webContents.send('notif', { hour:h, stats:lastStats })
  }, 60*1000)
  setTimeout(()=> new Notification({title:'Mascota Secretaria IA', body:'¡Mascota conectada a '+PROD_URL+' — Gmail REAL activo! Frecuencia: cada '+store.get('frecuencia','3h')}).show(), 3000)
}

app.whenReady().then(()=>{ createWindow(); createTray(); scheduleNotifications()
  app.on('activate', ()=>{ if(BrowserWindow.getAllWindows().length===0) createWindow() })
})
app.on('window-all-closed', ()=>{ if(process.platform!=='darwin') app.quit() })

ipcMain.on('instruccion', (e, txt)=>{
  console.log('[Mascota] instrucción:', txt)
  if(/reenviar|enviar|eliminar|cerrar/.test(txt)){
    const { dialog } = require('electron')
    const choice = dialog.showMessageBoxSync(win, { type:'question', buttons:['Cancelar','Confirmar'], message:`¿Confirmar acción? "${txt}"`, detail:'Action Guard: requiere autorización (RF-026)' })
    e.reply('instruccion-result', { ok: choice===1 })
  } else {
    e.reply('instruccion-result', { ok:true })
  }
})

// Recibe stats reales desde el renderer para notificaciones dinámicas (RF-021)
ipcMain.on('mascota-stats', (e, stats)=>{
  lastStats = stats
  // Actualiza tooltip dinámico
  try{
    if(tray && stats) tray.setToolTip(`Secretaria IA — ${stats.crit||0} críticas • ${stats.venc||0} vencidas • ${stats.total||0} procesos`)
  }catch{}
})
// Sincroniza frecuencia desde web
ipcMain.on('mascota-frecuencia', (e, freq)=>{
  if(['1h','3h','6h'].includes(freq)){ store.set('frecuencia', freq); updateTray() }
})
