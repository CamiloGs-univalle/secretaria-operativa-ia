const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage } = require('electron')
const path = require('path')
let win, tray
const isDev = process.argv.includes('--dev')

function createWindow(){
  win = new BrowserWindow({
    width: 380, height: 560,
    minWidth: 340, minHeight: 480,
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: false, resizable: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false, preload: path.join(__dirname,'preload.js') }
  })
  // carga la web (en prod: dist/index.html, en dev: vite dev server)
  const url = isDev ? 'http://localhost:5174' : `file://${path.join(__dirname,'../dist/index.html')}`
  win.loadURL(url)
  // posición flotante abajo-derecha
  const { screen } = require('electron')
  const disp = screen.getPrimaryDisplay().workArea
  win.setPosition(disp.width - 400, disp.height - 600)

  win.on('minimize', (e)=>{ e.preventDefault(); win.hide() })
}

function createTray(){
  const icon = nativeImage.createFromDataURL('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="%231e40af"/><text x="16" y="21" text-anchor="middle" fill="white" font-size="14">🐶</text></svg>')
  tray = new Tray(icon)
  const ctx = Menu.buildFromTemplate([
    { label: 'Mostrar mascota', click: ()=> win.show() },
    { label: 'Sincronizar Gmail', click: ()=> win.webContents.send('sync-gmail') },
    { type:'separator' },
    { label: 'Iniciar con Windows', type:'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (m)=> app.setLoginItemSettings({ openAtLogin: m.checked }) },
    { label: 'Frecuencia 3h', submenu:[
      { label:'Cada 1h', type:'radio' }, { label:'Cada 3h', type:'radio', checked:true }, { label:'Cada 6h', type:'radio' }
    ]},
    { type:'separator' },
    { label: 'Quitar', click: ()=> app.quit() }
  ])
  tray.setToolTip('Secretaria Operativa IA — Mascota')
  tray.setContextMenu(ctx)
  tray.on('click', ()=> win.isVisible() ? win.hide() : win.show())
}

function scheduleNotifications(){
  // 08:00, 11:00, 14:00, 17:00 — configurable
  const hours = [8,11,14,17]
  setInterval(()=>{
    const h = new Date().getHours()
    if(hours.includes(h) && new Date().getMinutes()===0){
      const n = new Notification({ title:'Secretaria Operativa IA', body: h===8?'¡Buenos días Señora! Tienes 4 críticos pendientes.' : h===11?'Actualización: 2 seguimientos vencen hoy.' : h===14?'Revisión de la tarde — 1 reprogramación detectada.' : 'Cierre del día — 3 procesos por cerrar.', silent:false })
      n.show()
      if(win) win.webContents.send('notif', { hour:h })
    }
  }, 60*1000)
}

app.whenReady().then(()=>{ createWindow(); createTray(); scheduleNotifications()
  app.on('activate', ()=>{ if(BrowserWindow.getAllWindows().length===0) createWindow() })
})
app.on('window-all-closed', ()=>{ if(process.platform!=='darwin') app.quit() })

// IPC — instrucciones naturales desde la mascota hacia el backend
ipcMain.on('instruccion', (e, txt)=>{
  // aquí iría: AI parse → Action Guard → Firebase
  console.log('[Mascota] instrucción:', txt)
  // ejemplo: si requiere confirmación, mostrar diálogo
  if(/reenviar|enviar|eliminar|cerrar/.test(txt)){
    const choice = require('electron').dialog.showMessageBoxSync(win, { type:'question', buttons:['Cancelar','Confirmar'], message:`¿Confirmar acción? "${txt}"`, detail:'Action Guard: requiere autorización' })
    e.reply('instruccion-result', { ok: choice===1 })
  } else {
    e.reply('instruccion-result', { ok:true })
  }
})
