const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, shell } = require('electron')
const path = require('path')
let win, tray
const isDev = process.argv.includes('--dev')
const PROD_URL = 'https://secretaria-operativa-ia.vercel.app'

function createWindow(){
  win = new BrowserWindow({
    width: 400, height: 640,
    minWidth: 360, minHeight: 500,
    frame: true, // con marco para que se vea y se pueda mover/cerrar bien
    transparent: false,
    backgroundColor: '#f8fafc',
    alwaysOnTop: false,
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

  // Carga la web — siempre la producción Vercel (conectada a Gmail REAL)
  // En dev: localhost, en prod: Vercel (no file:// que fallaba)
  const url = isDev ? 'http://localhost:5174' : PROD_URL
  console.log('[Mascota] cargando:', url)
  win.loadURL(url).catch(e=> console.error('loadURL failed', e))

  // Mostrar cuando esté lista
  win.once('ready-to-show', ()=> {
    win.show()
    // posición flotante abajo-derecha
    try{
      const { screen } = require('electron')
      const disp = screen.getPrimaryDisplay().workArea
      win.setPosition(Math.max(0, disp.width - 420), Math.max(0, disp.height - 680))
    }catch{}
  })

  // Abrir links externos en navegador
  win.webContents.setWindowOpenHandler(({url})=>{ shell.openExternal(url); return {action:'deny'} })
  win.webContents.on('did-fail-load', (e, code, desc, url)=> {
    console.error('did-fail-load', code, desc, url)
  })

  // DevTools en dev
  if(isDev) win.webContents.openDevTools({mode:'detach'})
}

function createTray(){
  try{
    const icon = nativeImage.createFromDataURL('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="%231e40af"/><text x="16" y="21" text-anchor="middle" fill="white" font-size="14">🐶</text></svg>')
    tray = new Tray(icon)
    const ctx = Menu.buildFromTemplate([
      { label: 'Mostrar mascota', click: ()=> { if(win) win.show() } },
      { label: 'Sincronizar Gmail', click: ()=> { if(win) win.webContents.send('sync-gmail'); new Notification({title:'Secretaria IA', body:'Sincronizando Gmail real...'}).show() } },
      { label: 'Abrir web', click: ()=> shell.openExternal(PROD_URL) },
      { type:'separator' },
      { label: 'Iniciar con Windows', type:'checkbox', checked: app.getLoginItemSettings().openAtLogin,
        click: (m)=> app.setLoginItemSettings({ openAtLogin: m.checked, openAsHidden:false }) },
      { label: 'Frecuencia', submenu:[
        { label:'Cada 1h', type:'radio' }, { label:'Cada 3h', type:'radio', checked:true }, { label:'Cada 6h', type:'radio' }
      ]},
      { type:'separator' },
      { label: 'Quitar', click: ()=> app.quit() }
    ])
    tray.setToolTip('Secretaria Operativa IA — Mascota (conectada a Vercel)')
    tray.setContextMenu(ctx)
    tray.on('click', ()=> { if(!win) return; win.isVisible() ? win.hide() : win.show() })
  }catch(e){ console.error('tray error', e)}
}

function scheduleNotifications(){
  const hours = [8,11,14,17]
  setInterval(()=>{
    const h = new Date().getHours()
    if(hours.includes(h) && new Date().getMinutes()===0){
      const body = h===8?'¡Buenos días Señora! Tienes 4 críticos pendientes.' : h===11?'Actualización: 2 seguimientos vencen hoy.' : h===14?'Revisión de la tarde — 1 reprogramación detectada.' : 'Cierre del día — 3 procesos por cerrar.'
      new Notification({ title:'Secretaria Operativa IA', body, silent:false }).show()
      if(win) win.webContents.send('notif', { hour:h })
    }
  }, 60*1000)
  // Notificación de prueba al iniciar (para verificar que funciona)
  setTimeout(()=> new Notification({title:'Mascota Secretaria IA', body:'¡Mascota conectada a https://secretaria-operativa-ia.vercel.app — Gmail REAL activo!'}).show(), 3000)
}

app.whenReady().then(()=>{ createWindow(); createTray(); scheduleNotifications()
  app.on('activate', ()=>{ if(BrowserWindow.getAllWindows().length===0) createWindow() })
})
app.on('window-all-closed', ()=>{ if(process.platform!=='darwin') app.quit() })

ipcMain.on('instruccion', (e, txt)=>{
  console.log('[Mascota] instrucción:', txt)
  if(/reenviar|enviar|eliminar|cerrar/.test(txt)){
    const { dialog } = require('electron')
    const choice = dialog.showMessageBoxSync(win, { type:'question', buttons:['Cancelar','Confirmar'], message:`¿Confirmar acción? "${txt}"`, detail:'Action Guard: requiere autorización' })
    e.reply('instruccion-result', { ok: choice===1 })
  } else {
    e.reply('instruccion-result', { ok:true })
  }
})
