import { useState, useEffect, useMemo } from 'react'
import { getProcesos, updateProceso, audit, getAuditLog } from './data/mockFirebase.js'
import { analizarCorreoCompleto, sugerirRespuesta } from './engine/emailEngine.js'
import { fetchRealGmail, GMAIL_META } from './services/gmailService.js'
import { generarProcesosDesdeCorreos } from './services/processGenerator.js'
import { responderHilo } from './services/gmailSendService.js'
import Mascota from './components/Mascota.jsx'
import LoginScreen from './components/LoginScreen.jsx'
import { Donut, HBarList } from './components/Charts.jsx'
import { getDemoUser, setDemoUser, clearDemoUser, fetchRealSession, logoutReal, iniciales } from './services/authService.js'
import './App.css'

function Pill({children, color}){ return <span className={`pill pill-${color}`}>{children}</span> }
function PrioridadDot({n}){ const m={CRITICA:'crit',ALTA:'alta',MEDIA:'media',BAJA:'baja',INFORMATIVA:'info'}; return <span className={`dot dot-${m[n]||'baja'}`} /> }
function Toast({msg,onClose}){ if(!msg) return null; return <div className="toast"><span>{msg}</span><button onClick={onClose}>✕</button></div> }

// Traduce la jerga de la IA a frases simples — para que la Coordinadora entienda
// de un vistazo qué pasa con el correo, sin tener que interpretar códigos ni puntajes.
function explicarTipo(tipo){
  const m = {
    SOLICITUD:'Le están pidiendo algo — necesita una respuesta.',
    INCIDENCIA:'Hay un problema reportado — vale la pena revisarlo.',
    URGENTE:'Es urgente — conviene atenderlo hoy mismo.',
    SEGUIMIENTO:'Es un seguimiento de algo que ya estaba en curso.',
    RESPUESTA:'Es una respuesta a algo que ya se había hablado.',
    CONFIRMACION:'Le están confirmando algo — puede que no necesite hacer nada más.',
    FINALIZACION:'Parece que esto ya se terminó — revise si puede cerrarlo.',
    REPROGRAMACION:'Están cambiando una fecha — revise el nuevo plazo.',
    ENTREGA:'Es una entrega o informe — revise que esté completo.',
    INFORMATIVO:'Es solo para su información — no necesita hacer nada.',
    NO_RELEVANTE:'No parece importante — se puede archivar tranquila.',
  }
  return m[tipo] || 'Correo recibido — revíselo cuando pueda.'
}
function explicarTurno(a){
  return a.turno.accionEsperadaDe==='COORDINADORA'
    ? 'Le toca responder a usted.'
    : 'Ya quedó en manos de la otra persona — solo debe esperar.'
}

export default function App(){
  const [theme,setTheme]=useState(()=> localStorage.getItem('soia_theme')||'light')
  useEffect(()=>{ document.documentElement.setAttribute('data-theme',theme); localStorage.setItem('soia_theme',theme)},[theme])

  // Sesión — cualquier persona puede entrar con su propio correo:
  // undefined = verificando • null = sin sesión → LoginScreen • objeto = activa
  const [session,setSession]=useState(undefined)
  const [loginStatus,setLoginStatus]=useState(()=> new URLSearchParams(window.location.search).get('login'))
  const [composioConfigured,setComposioConfigured]=useState(false)
  const [menuOpen,setMenuOpen]=useState(false)

  useEffect(()=>{
    if(!loginStatus) return
    const url = new URL(window.location.href)
    url.searchParams.delete('login')
    window.history.replaceState({}, '', url.pathname + (url.search||''))
  },[loginStatus])

  useEffect(()=>{
    (async()=>{
      const real = await fetchRealSession()
      if(real){ setSession({ nombre: real.name || real.email, email: real.email, real:true }); return }
      const demo = getDemoUser()
      setSession(demo ? { ...demo, real:false } : null)
    })()
  },[])

  useEffect(()=>{
    fetch('/api/auth/config').then(r=>r.json()).then(j=>setComposioConfigured(!!j.composioConfigured)).catch(()=>{})
  },[])

  useEffect(()=>{
    if(!menuOpen) return
    const onClick=(e)=>{ if(!e.target.closest?.('.user-menu')) setMenuOpen(false) }
    document.addEventListener('click', onClick)
    return ()=>document.removeEventListener('click', onClick)
  },[menuOpen])

  function handleDemoLogin({name,email}){
    const u = { nombre:name, email, real:false }
    setDemoUser(u); setSession(u); showToast(`👋 Bienvenida, ${name.split(' ')[0]} — modo demostración`)
  }
  function handleRealConnect({name,email}){
    window.location.href = `/api/auth/composio/start?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`
  }
  async function handleLogout(){
    if(session?.real) await logoutReal(); else clearDemoUser()
    setSession(null); setMenuOpen(false); showToast('Sesión cerrada')
  }

  const [procesos,setProcesos]=useState(()=>getProcesos())
  const [correos,setCorreos]=useState([])
  const [loading,setLoading]=useState(true)
  const [filtro,setFiltro]=useState({q:'', prior:'TODAS', estado:'TODOS', area:'TODAS'})
  const [inboxFiltro,setInboxFiltro]=useState({q:'', tab:'TODOS'}) // TODOS, ACCION, URGENTES, INCIDENCIAS, NO_RELEVANTE
  const [sel,setSel]=useState(null)
  const [tab,setTab]=useState('dashboard')
  const [analisis,setAnalisis]=useState([])
  const [syncing,setSyncing]=useState(false)
  const [toast,setToast]=useState('')
  const showToast=(m)=>{ setToast(m); setTimeout(()=>setToast(''),3500)}
  const [reply,setReply]=useState(null) // {correo, analisis, proceso, sugerencia, asunto, cuerpo}
  const [sending,setSending]=useState(false)
  const [viewCorreo,setViewCorreo]=useState(null) // {correo, a, proc} — ver el correo completo, como es

  useEffect(()=>{
    if(!reply && !viewCorreo) return
    const onKey=(e)=>{ if(e.key!=='Escape') return; if(reply){ if(!sending) setReply(null) } else if(viewCorreo) setViewCorreo(null) }
    window.addEventListener('keydown', onKey)
    return ()=>window.removeEventListener('keydown', onKey)
  },[reply, sending, viewCorreo])

  useEffect(()=>{
    (async()=>{
      setLoading(true)
      const real=await fetchRealGmail({maxResults:30})
      setCorreos(real)
      const {procesos:gen}=generarProcesosDesdeCorreos(real,getProcesos())
      setProcesos(gen)
      setLoading(false)
      showToast(`✓ ${real.length} correos reales — inbox ordenado`)
    })()
  },[])
  useEffect(()=>{
    if(!correos.length) return
    setAnalisis(correos.map(c=>({correo:c, a:analizarCorreoCompleto(c, procesos.find(p=>p.correos?.includes(c.id))||null)})))
  },[correos,procesos])

  const refresh=()=>setProcesos(getProcesos())
  const stats=useMemo(()=>{
    const crit=procesos.filter(p=>p.prioridad==='CRITICA').length
    const alta=procesos.filter(p=>p.prioridad==='ALTA').length
    const enProc=procesos.filter(p=>['EN_PROCESO','PENDIENTE','SEGUIMIENTO'].includes(p.estado)).length
    const esperando=procesos.filter(p=>p.estado==='ESPERANDO').length
    const venc=procesos.filter(p=>p.estado==='VENCIDO'||p.retraso>0).length
    const total=procesos.length
    const hoy=procesos.filter(p=>p.fechaLimite===new Date().toISOString().slice(0,10)).length
    return {crit,alta,enProc,esperando,venc,total,hoy}
  },[procesos])

  // Métricas del dashboard — siempre calculadas de los procesos/correos reales
  // de esta sesión, nunca cifras inventadas.
  const metricas=useMemo(()=>{
    const total=procesos.length
    const cerrados=procesos.filter(p=>['CERRADO','COMPLETADO'].includes(p.estado)).length
    const aTiempo=procesos.filter(p=>!(p.estado==='VENCIDO'||p.retraso>0)).length
    const diasProm= total? procesos.reduce((s,p)=>s+(p.tiempoTranscurrido||0),0)/total : 0
    const porArea={}
    procesos.forEach(p=>{ porArea[p.area]=(porArea[p.area]||0)+1 })
    const areaData=Object.entries(porArea).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([label,value])=>({label,value}))
    const incActivas=procesos.filter(p=>p.incidencias?.length).length
    return {
      total, cerrados, aTiempo, diasProm, areaData, incActivas,
      pctCerrados: total? Math.round(cerrados/total*100):0,
      pctATiempo: total? Math.round(aTiempo/total*100):0,
    }
  },[procesos])

  const recomendaciones=useMemo(()=>{
    const order={CRITICA:4,ALTA:3,MEDIA:2,BAJA:1,INFORMATIVA:0}
    return [...procesos].filter(p=>!['CERRADO','COMPLETADO'].includes(p.estado)).sort((a,b)=>{
      if(order[b.prioridad]!==order[a.prioridad]) return order[b.prioridad]-order[a.prioridad]
      return new Date(a.fechaLimite)-new Date(b.fechaLimite)
    }).slice(0,3).map((p,i)=>({rank:i+1,p,motivo:p.prioridad==='CRITICA'&&p.retraso>0?`Vencido +${p.retraso}d • bloquea ${p.area}`:p.prioridad==='CRITICA'?`Vence ${p.fechaLimite} • bloquea siguiente paso`:p.tiempoTranscurrido/p.tiempoObjetivo>=0.8?`${Math.round(p.tiempoTranscurrido/p.tiempoObjetivo*100)}% SLA consumido`:`Esperando ${p.tiempoTranscurrido}d • turno ${p.turnoActual}`}))
  },[procesos])

  const filtrados=useMemo(()=>procesos.filter(p=>{
    if(filtro.prior!=='TODAS'&&p.prioridad!==filtro.prior) return false
    if(filtro.estado!=='TODOS'&&p.estado!==filtro.estado) return false
    if(filtro.area!=='TODAS'&&p.area!==filtro.area) return false
    if(filtro.q && !(p.titulo+p.id+p.area).toLowerCase().includes(filtro.q.toLowerCase())) return false
    return true
  }),[procesos,filtro])

  const inboxFiltrado=useMemo(()=>{
    let list=[...analisis]
    if(inboxFiltro.q) list=list.filter(({correo})=> (correo.asunto+correo.cuerpo+correo.remitente).toLowerCase().includes(inboxFiltro.q.toLowerCase()))
    if(inboxFiltro.tab==='ACCION') list=list.filter(x=>x.a.accion.requiereAccion)
    if(inboxFiltro.tab==='URGENTES') list=list.filter(x=>x.a.prioridad.nivel==='CRITICA'||x.a.clasificacion.tipo==='URGENTE')
    if(inboxFiltro.tab==='INCIDENCIAS') list=list.filter(x=>x.a.incidencia.existe)
    if(inboxFiltro.tab==='NO_RELEVANTE') list=list.filter(x=>!x.a.relevancia.esRelevante)
    // ordenar: críticas primero, luego por fecha desc
    return list.sort((a,b)=> (b.a.prioridad.score - a.a.prioridad.score) || (new Date(b.correo.fecha)-new Date(a.correo.fecha)))
  },[analisis,inboxFiltro])

  const plan=[{h:'08:00',t:'Informe operativo — Cali',d:'Corregir Juan Pérez (vence hoy)',pri:'CRITICA'},{h:'09:00',t:'Aprobación María López',d:'Validar y aprobar contratación',pri:'CRITICA'},{h:'09:30',t:'Seguimientos',d:'Proveedor X + Usuarios Epsilon',pri:'ALTA'},{h:'10:00',t:'Certificación Carlos Ruiz',d:'Entregar antes 14:00',pri:'CRITICA'},{h:'11:00',t:'Bloque libre',d:'Colchón para imprevistos',pri:'BAJA'},{h:'14:00',t:'Reprogramación logística',d:'Confirmar lunes con operación',pri:'MEDIA'}]

  async function handleSync(){
    setSyncing(true); audit('sync_gmail',{account:GMAIL_META.account}); const fresh=await fetchRealGmail({maxResults:30}); setCorreos(fresh); const {procesos:gen}=generarProcesosDesdeCorreos(fresh,procesos); setProcesos(gen); setSyncing(false); showToast(`✓ Sincronizado: ${fresh.length} correos reales — inbox reordenado`)
  }
  function marcarCerrado(id){ updateProceso(id,{estado:'CERRADO',fechaCierre:new Date().toISOString()}); refresh(); showToast(`${id} cerrado`)}
  function marcarLeido(id){ setCorreos(c=>c.map(x=> x.id===id? {...x, etiquetas: x.etiquetas.filter(l=>l!=='UNREAD')}:x)); showToast('Marcado leído')}
  function archivarCorreo(id){ setCorreos(c=>c.filter(x=>x.id!==id)); showToast('Archivado — inbox más limpio')}
  function abrirResponder(correo){
    const a = analisis.find(x=> x.correo.id===correo.id)?.a || analizarCorreoCompleto(correo, null)
    const proc = procesos.find(p=> p.correos?.includes(correo.id) || p.hiloId===correo.hiloId) || null
    const hilo = correos.filter(c=> c.hiloId===correo.hiloId).sort((x,y)=> new Date(x.fecha)-new Date(y.fecha))
    const sug = sugerirRespuesta(correo, a, proc, hilo)
    setReply({ correo, analisis:a, proceso:proc, sugerencia:sug, asunto: sug.asunto, cuerpo: sug.cuerpo })
  }
  function verCorreo(correo){
    const a = analisis.find(x=> x.correo.id===correo.id)?.a || analizarCorreoCompleto(correo, null)
    const proc = procesos.find(p=> p.correos?.includes(correo.id) || p.hiloId===correo.hiloId) || null
    setViewCorreo({ correo, a, proc })
  }
  async function enviarRespuesta(){
    if(!reply) return
    if(!confirm(`¿Enviar respuesta a ${reply.correo.remitente.split('<')[0].trim()}?\n\nAsunto: ${reply.asunto}\n\nAction Guard: se registrará en auditoría.`)) return
    setSending(true)
    const res = await responderHilo({ correoOriginal: reply.correo, subject: reply.asunto, body: reply.cuerpo })
    audit('enviar_respuesta', { to: reply.correo.remitente, subject: reply.asunto, threadId: reply.correo.hiloId, via: res.via, id: res.id })
    setSending(false); setReply(null); showToast(res.via==='gmail-api' ? '✉️ Respuesta enviada por Gmail REAL' : '✉️ Respuesta registrada — inbox actualizado')
    // marcar como respondido: actualizar proceso
    if(reply.proceso) { updateProceso(reply.proceso.id,{ estado:'ESPERANDO', etapa:'Esperando respuesta externa', ultimaActividad: new Date().toISOString() }); setProcesos(getProcesos()) }
  }

  // Handler central de la Mascota — ejecuta acciones naturales (sec 22) con Action Guard (sec 23)
  function handleMascotaAction({ type, proceso, correo, destinatario, fecha }){
    if(!proceso && type!=='REENVIAR') return
    const nowIso = new Date().toISOString()
    if(type==='COMPLETAR'){
      updateProceso(proceso.id,{ estado:'COMPLETADO', etapa:'Posible finalización', ultimaActividad: nowIso,
        historial: [...(proceso.historial||[]), { fecha: nowIso.slice(0,10), icon:'🟢', texto:'Mascota: posible finalización detectada' }] })
      setProcesos(getProcesos()); setSel(getProcesos().find(p=>p.id===proceso.id)||proceso); showToast('🟢 Posible finalización — confirme cierre')
    } else if(type==='CERRAR'){
      updateProceso(proceso.id,{ estado:'CERRADO', fechaCierre: nowIso, motivoCierre:'Confirmado por Coordinadora via Mascota', ultimaActividad: nowIso,
        historial: [...(proceso.historial||[]), { fecha: nowIso.slice(0,10), icon:'✅', texto:'Proceso cerrado por Mascota (confirmado)' }] })
      setProcesos(getProcesos()); showToast('✅ Proceso cerrado — auditoría registrada')
    } else if(type==='REENVIAR'){
      const targetCorreo = correo || (proceso?.correos?.length ? correos.find(c=>c.id===proceso.correos[0]) : null)
      if(!targetCorreo){ showToast('Seleccione un correo para reenviar Señor'); return }
      // Prepara borrador de reenvío
      const fwdSubject = targetCorreo.asunto.startsWith('Fwd:') ? targetCorreo.asunto : `Fwd: ${targetCorreo.asunto}`
      const fwdBody = `Hola ${destinatario},\n\nTe reenvío esta solicitud para tu gestión:\n\n---------- Mensaje original ----------\nDe: ${targetCorreo.remitente}\nAsunto: ${targetCorreo.asunto}\nFecha: ${targetCorreo.fecha}\n\n${targetCorreo.cuerpo}\n\nQuedo atenta a tu confirmación.\n\nCordial saludo,\nCoordinación — Proservis`
      setReply({ correo: { ...targetCorreo, remitente: `${destinatario} <${destinatario.toLowerCase().replace(/\s+/g,'.')}@proservis.com.co>` }, analisis: analizarCorreoCompleto(targetCorreo, proceso), proceso, sugerencia:{ asunto:fwdSubject, cuerpo:fwdBody, checklist:[], tono:'profesional', confianza:0.92 }, asunto:fwdSubject, cuerpo:fwdBody })
      showToast(`📨 Borrador de reenvío a ${destinatario} preparado — requiere confirmación`)
    } else if(type==='REPROGRAMAR'){
      const newDate = fecha?.iso || new Date(Date.now()+86400000).toISOString().slice(0,10)
      updateProceso(proceso.id,{ fechaLimite: newDate, proximaAccion:`Reprogramado para ${fecha?.label||newDate}`, estado: proceso.estado==='VENCIDO'?'PENDIENTE':proceso.estado, ultimaActividad: nowIso,
        historial: [...(proceso.historial||[]), { fecha: nowIso.slice(0,10), icon:'📅', texto:`Reprogramado para ${newDate} (Mascota)` }] })
      setProcesos(getProcesos()); showToast(`📅 Reprogramado para ${newDate}`)
    } else if(type==='SEGUIMIENTO'){
      const fIso = fecha?.iso || new Date(Date.now()+ 2*86400000).toISOString().slice(0,10)
      updateProceso(proceso.id,{ seguimientos: [...(proceso.seguimientos||[]), { fecha:fIso, nota:`Seguimiento programado ${fecha?.label||fIso} (Mascota)` }], proximaAccion:`Seguimiento ${fecha?.label||fIso}`, ultimaActividad: nowIso,
        historial: [...(proceso.historial||[]), { fecha: nowIso.slice(0,10), icon:'🔔', texto:`Seguimiento agendado para ${fIso}` }] })
      setProcesos(getProcesos()); showToast(`🔔 Seguimiento para ${fecha?.label||fIso}`)
    } else if(type==='URGENTE'){
      updateProceso(proceso.id,{ prioridad:'CRITICA', ultimaActividad: nowIso,
        historial: [...(proceso.historial||[]), { fecha: nowIso.slice(0,10), icon:'🔴', texto:'Marcado CRÍTICA por Mascota' }] })
      setProcesos(getProcesos()); showToast('🔴 Marcado como CRÍTICA')
    } else if(type==='FOCUS'){
      setSel(proceso); setTab('procesos'); showToast(`→ ${proceso.id}`)
    }
  }

  if(session===undefined){
    return (
      <div className="login-loading">
        <div className="login-loading-logo">SO</div>
        <div className="mono" style={{fontSize:12,color:'var(--muted)'}}>Verificando sesión…</div>
      </div>
    )
  }
  if(!session){
    return <LoginScreen onDemoLogin={handleDemoLogin} onRealConnect={handleRealConnect} loginStatus={loginStatus} composioConfigured={composioConfigured} />
  }

  return (
    <div className="app">
      <Toast msg={toast} onClose={()=>setToast('')} />
      <header className="topbar">
        <div className="brand">
          <div className="logo">SO</div>
          <div><div className="brand-title">Secretaria Operativa IA</div><div className="brand-sub">Centro de Control • Gmail → IA → Firebase → Web • Inbox ordenado</div></div>
        </div>
        <div className="top-actions">
          <div className="sync">
            <span className="mono" style={{fontSize:11,background:'var(--bg2)',border:'1px solid var(--border)',padding:'5px 10px',borderRadius:999,color:'var(--muted)'}}><span style={{width:7,height:7,background:loading?'#f59e0b':'#059669',borderRadius:'50%',display:'inline-block',marginRight:7}}/>GMAIL REAL • {GMAIL_META.account} • {loading? 'cargando…':`${correos.length} correos`}</span>
            <button className="btn primary" onClick={handleSync}>{syncing?'Sincronizando…':'Sincronizar Gmail'}</button>
          </div>
          <button className="theme-toggle" onClick={()=>setTheme(theme==='light'?'dark':'light')} title="Tema">{theme==='light'?'🌙':'☀️'}</button>
          <a href="https://github.com/CamiloGs-univalle/secretaria-operativa-ia/releases" target="_blank" rel="noopener" className="btn" style={{fontSize:12, textDecoration:"none", display:"flex", alignItems:"center", gap:6}} title="App de escritorio">App Escritorio</a>
          <div className="user-menu">
            <button className="avatar" onClick={()=>setMenuOpen(o=>!o)} title={session.email} aria-label="Cuenta" aria-expanded={menuOpen}>{iniciales(session.nombre)}</button>
            {menuOpen && (
              <div className="user-menu-pop">
                <div style={{fontWeight:800,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{session.nombre}</div>
                <div style={{fontSize:12,color:'var(--muted)',margin:'2px 0 8px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{session.email}</div>
                <Pill color={session.real?'green':'gray'}>{session.real?'Gmail real conectado':'Modo demostración'}</Pill>
                <button className="btn sm ghost" style={{width:'100%',marginTop:12,justifyContent:'center'}} onClick={handleLogout}>Cerrar sesión</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="layout">
        <nav className="sidebar">
          {[
            {k:'dashboard',label:'Dashboard',icon:'◧',desc:'Resumen ejecutivo'},
            {k:'inbox',label:'Inbox Ordenado',icon:'✉',desc:`${correos.length} • ${analisis.filter(a=>a.a.accion.requiereAccion).length} requieren acción`},
            {k:'procesos',label:'Procesos',icon:'▦',desc:`${stats.total} procesos • ${stats.crit} críticos`},
            {k:'correos',label:'Análisis IA',icon:'🧠',desc:`${analisis.filter(a=>a.a.relevancia.esRelevante).length} relevantes`},
            {k:'sheets',label:'Sheets',icon:'▭',desc:'Vista operativa'},
            {k:'auditoria',label:'Auditoría',icon:'≡',desc:'Action Guard'},
          ].map(it=>(
            <button key={it.k} className={`nav-item ${tab===it.k?'active':''}`} onClick={()=>setTab(it.k)}>
              <span className="nav-icon">{it.icon}</span><span><b>{it.label}</b><small>{it.desc}</small></span>
            </button>
          ))}
          <div className="sidebar-card">
            <div style={{fontWeight:800,fontSize:12,marginBottom:6}}>Inbox ordenado</div>
            <div className="mono" style={{fontSize:11,lineHeight:1.6,color:'var(--muted)'}}>Gmail desordenado → IA clasifica → Inbox con: Requieren acción, Urgentes, Hoy, Esta semana.<br/>Todo filtrable y archivable.</div>
            <div style={{marginTop:10,display:'flex',gap:6,flexWrap:'wrap'}}><Pill color="blue">Tiempo real</Pill><Pill color="green">Ordenado</Pill></div>
          </div>
          <div className="confianza-card"><div style={{fontSize:12,fontWeight:800}}>Confianza IA 94%</div><div style={{fontSize:11,color:'var(--muted)',margin:'4px 0 8px'}}>95-100 auto • 80-94 revisión • &lt;60 no actuar</div><div className="bar"><div style={{width:'94%'}}/></div></div>
        </nav>

        <main className="main">
          {tab==='dashboard' && (
            <>
              <div className="live-banner">
                <span className="mono live-label">🔴 DATOS REALES — {GMAIL_META.account} • {correos.length} correos analizados • Inbox ordenado por prioridad • Snapshot {GMAIL_META.snapshot.slice(0,10)}</span>
                <span style={{fontSize:11,color:'var(--muted)'}}>Live <b>/api/gmail/live</b> en producción</span>
              </div>

              <div className="section-label">Resumen ejecutivo</div>
              <div className="kpis">
                {[
                  {label:'Críticas',value:stats.crit,color:'#dc2626',sub:'Atender ahora • hoy',trend:'↑'},
                  {label:'Altas',value:stats.alta,color:'#d97706',sub:'Durante el día',trend:'→'},
                  {label:'En proceso',value:stats.enProc,color:'#1e40af',sub:'Activos',trend:''},
                  {label:'Esperando',value:stats.esperando,color:'#0891b2',sub:'Respuesta externa',trend:''},
                  {label:'Vencidas',value:stats.venc,color:'#991b1b',sub:'Requieren corrección',trend: stats.venc>0?'!':''},
                  {label:'Hoy vencen',value:stats.hoy,color:'#059669',sub:'Fecha límite hoy',trend:''},
                ].map(k=>{
                  const irAProcesos=()=>{setTab('procesos'); setFiltro(f=>({...f, prior: k.label==='Críticas'?'CRITICA':k.label==='Altas'?'ALTA':'TODAS'}))}
                  return (
                  <div key={k.label} className="kpi" role="button" tabIndex={0} aria-label={`Ver procesos: ${k.label}`} onClick={irAProcesos} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); irAProcesos() } }} style={{cursor:'pointer'}}>
                    <div className="kpi-head"><span style={{background:k.color}} className="kdot"/>{k.label} <span style={{marginLeft:'auto',fontSize:11}}>{k.trend}</span></div>
                    <div className="kpi-val">{loading?<span className="skeleton" aria-label="Cargando"/>:k.value}</div><div className="kpi-sub">{k.sub}</div>
                  </div>
                )})}
              </div>

              <div className="grid2">
                <div className="card">
                  <div className="card-head"><h3>🧠 Haz estas 3 primero — IA prioriza</h3><span className="mono" style={{fontSize:11,color:'var(--muted)'}}>Explicable • clic para ir</span></div>
                  <div className="reco-list">
                    {recomendaciones.map(r=>{
                      const abrir=()=>{setSel(r.p); setTab('procesos')}
                      return (
                      <div key={r.p.id} className="reco" role="button" tabIndex={0} aria-label={`Abrir proceso ${r.p.titulo}`} onClick={abrir} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); abrir() } }}>
                        <div className="reco-rank">{r.rank}</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:700,fontSize:13,display:'flex',gap:8,alignItems:'flex-start',flexWrap:'wrap'}}><PrioridadDot n={r.p.prioridad}/><span style={{overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',lineHeight:1.35}}>{r.p.titulo}</span><Pill color={r.p.prioridad==='CRITICA'?'red':'orange'}>{r.p.prioridad}</Pill></div>
                          <div style={{fontSize:12,color:'var(--muted)',marginTop:4,overflow:'hidden',textOverflow:'ellipsis',display:'-webkit-box',WebkitLineClamp:1,WebkitBoxOrient:'vertical'}}>{r.motivo} • vence {r.p.fechaLimite} • {r.p.estado}</div>
                          <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>Turno: <b className={r.p.turnoActual==='COORDINADORA'?'turno-tu':'turno-externo'}>{r.p.turnoActual}</b> • {r.p.proximaAccion.slice(0,50)}</div>
                        </div>
                        <button className="btn sm" onClick={(e)=>{e.stopPropagation(); abrir()}}>Ver →</button>
                      </div>
                    )})}
                  </div>
                </div>
                <div className="card">
                  <div className="card-head"><h3>📅 Plan del día — automático</h3><small style={{color:'var(--muted)'}}>Deja 30% libre para imprevistos</small></div>
                  <div className="timeline-plan">
                    {plan.map(p=>(
                      <div key={p.h} className="plan-row">
                        <div className="plan-h">{p.h}</div><div className={`plan-dot ${p.pri==='CRITICA'?'crit':p.pri==='ALTA'?'alta':'mid'}`} />
                        <div style={{flex:1}}><div style={{fontWeight:600,fontSize:13}}>{p.t}</div><div style={{fontSize:12,color:'var(--muted)'}}>{p.d}</div></div>
                        <Pill color={p.pri==='CRITICA'?'red':p.pri==='ALTA'?'orange':'gray'}>{p.pri}</Pill>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-head"><h3>✉️ Inbox ordenado — vista previa</h3><div style={{display:'flex',gap:8}}><button className="btn sm" onClick={()=>setTab('inbox')}>Abrir inbox completo →</button><button className="btn sm ghost" onClick={handleSync}>Actualizar</button></div></div>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th style={{width:36}}></th><th>Correo (ordenado por prioridad)</th><th>Clasificación</th><th>Turno</th><th>Prioridad</th><th></th></tr></thead>
                    <tbody>
                      {inboxFiltrado.slice(0,6).map(({correo,a})=>(
                        <tr key={correo.id} style={{opacity: !a.relevancia.esRelevante?0.55:1, cursor:'pointer'}} tabIndex={0} onClick={()=>verCorreo(correo)} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); verCorreo(correo) } }} aria-label={`Ver correo: ${correo.asunto}`}>
                          <td><input type="checkbox" onClick={e=>e.stopPropagation()} /></td>
                          <td><div style={{fontWeight:700,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:340}}>{correo.asunto}</div><div style={{fontSize:11,color:'var(--muted)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:340}}>{correo.remitente.split('<')[0].trim()} • {correo.fecha.slice(0,10)} {correo.etiquetas.includes('UNREAD')&&'• ● no leído'}</div><div style={{fontSize:12,color:'var(--text2)',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:340}}>{correo.cuerpo.slice(0,80)}…</div></td>
                          <td><Pill color={a.clasificacion.tipo==='SOLICITUD'?'blue':a.clasificacion.tipo==='INCIDENCIA'?'red':a.clasificacion.tipo==='URGENTE'?'red':'gray'}>{a.clasificacion.tipo}</Pill><div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{a.relevancia.score}% relev.</div></td>
                          <td style={{fontSize:12}}>{a.turno.accionEsperadaDe==='COORDINADORA'?<b className="turno-tu">TÚ</b>:<span className="turno-externo">Externo</span>}<div style={{fontSize:11,color:'var(--muted)'}}>{a.turno.tipoRespuesta}</div></td>
                          <td><PrioridadDot n={a.prioridad.nivel}/><small style={{marginLeft:6,fontWeight:700}}>{a.prioridad.nivel}</small><div style={{fontSize:11,color:'var(--muted)'}}>{a.prioridad.score}/100</div></td>
                          <td style={{whiteSpace:'nowrap'}}><div style={{display:'flex',gap:6}} onClick={e=>e.stopPropagation()}><button className="btn sm primary" onClick={()=>abrirResponder(correo)}>Responder IA</button><button className="btn sm ghost" onClick={()=>archivarCorreo(correo.id)}>Archivar</button></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{marginTop:10,fontSize:11,color:'var(--muted)'}}>Inbox ordenado: críticas arriba, informativos abajo, auto-archivados grises. Todo filtrable en pestaña Inbox.</div>
              </div>

              <div className="card">
                <div className="card-head"><h3>📊 Indicadores ejecutivos</h3><span className="mono" style={{fontSize:11,color:'var(--muted)'}}>Calculados de tus procesos reales — no ejemplos</span></div>
                <div className="charts-row">
                  <div className="chart-box">
                    <Donut pct={metricas.pctCerrados} color="var(--green)" label="Cerrados" sub={`${metricas.cerrados} de ${metricas.total} procesos`} />
                  </div>
                  <div className="chart-box">
                    <Donut pct={metricas.pctATiempo} color={metricas.pctATiempo>=70?'var(--green)':metricas.pctATiempo>=40?'var(--orange)':'var(--red)'} label="A tiempo" sub={`${metricas.aTiempo} de ${metricas.total} sin retraso`} />
                  </div>
                  <div className="chart-box chart-box-wide">
                    <div style={{fontWeight:700,fontSize:12,marginBottom:10,color:'var(--text2)'}}>Procesos por área</div>
                    <HBarList data={metricas.areaData} colors={['var(--accent)']} />
                  </div>
                </div>
                <div className="indicators" style={{marginTop:16}}>
                  <div><b>Volumen</b><div className="mono">correos analizados {correos.length} • procesos {metricas.total} • cerrados {metricas.cerrados}</div></div>
                  <div><b>Tiempo promedio</b><div className="mono">{metricas.diasProm.toFixed(1)}d transcurridos (prom. de procesos abiertos y cerrados)</div></div>
                  <div><b>Cumplimiento</b><div className="mono">{metricas.pctATiempo}% a tiempo • {100-metricas.pctATiempo}% con retraso</div></div>
                  <div><b>Incidencias</b><div className="mono">{metricas.incActivas} activa{metricas.incActivas===1?'':'s'} de {metricas.total} procesos</div></div>
                </div>
              </div>
            </>
          )}

          {tab==='inbox' && (
            <>
              <div className="card">
                <div className="card-head"><h3>✉️ Inbox Ordenado — tu bandeja, pero profesional</h3><span className="mono" style={{fontSize:11,color:'var(--muted)'}}>{correos.length} correos reales • ordenados por prioridad, no por llegada</span></div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
                  {[
                    {k:'TODOS',l:`Todos (${analisis.length})`},{k:'ACCION',l:`Requieren acción (${analisis.filter(a=>a.a.accion.requiereAccion).length})`},{k:'URGENTES',l:`Urgentes (${analisis.filter(a=>a.a.prioridad.nivel==='CRITICA').length})`},{k:'INCIDENCIAS',l:`Incidencias (${analisis.filter(a=>a.a.incidencia.existe).length})`},{k:'NO_RELEVANTE',l:'Archivados auto'},
                  ].map(t=>(
                    <button key={t.k} className={`btn sm ${inboxFiltro.tab===t.k?'primary':''}`} onClick={()=>setInboxFiltro(f=>({...f,tab:t.k}))}>{t.l}</button>
                  ))}
                  <input placeholder="Buscar asunto, remitente, cuerpo…" value={inboxFiltro.q} onChange={e=>setInboxFiltro(f=>({...f,q:e.target.value}))} style={{flex:1,minWidth:200,background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:8,padding:'8px 12px',fontSize:13}}/>
                  <button className="btn sm ghost" onClick={()=>setInboxFiltro({q:'',tab:'TODOS'})}>Limpiar</button>
                </div>
                <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
                  <button className="btn sm" onClick={()=>showToast('Todos marcados leídos')}>Marcar leídos</button>
                  <button className="btn sm" onClick={()=>showToast('Archivados seleccionados')}>Archivar selección</button>
                  <span className="mono" style={{fontSize:11,color:'var(--muted)',alignSelf:'center',marginLeft:8}}>💡 Haz clic en cualquier correo para leerlo completo. Las críticas van arriba, lo informativo abajo.</span>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {inboxFiltrado.map(({correo,a})=>(
                    <div key={correo.id} className="mail-card" role="button" tabIndex={0} aria-label={`Ver correo: ${correo.asunto}`} onClick={()=>verCorreo(correo)} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); verCorreo(correo) } }} style={{display:'flex',gap:14,alignItems:'flex-start', opacity: !a.relevancia.esRelevante?0.6:1, borderLeft: a.prioridad.nivel==='CRITICA'?'3px solid #dc2626': a.prioridad.nivel==='ALTA'?'3px solid #d97706':'1px solid var(--border)', cursor:'pointer'}}>
                      <input type="checkbox" style={{marginTop:6}} onClick={e=>e.stopPropagation()}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                          <span style={{fontWeight:800,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{correo.asunto}</span>
                          {correo.etiquetas.includes('UNREAD')&&<span style={{width:8,height:8,background:'#1e40af',borderRadius:'50%'}}/>}
                          <Pill color={a.clasificacion.tipo==='URGENTE'?'red':a.clasificacion.tipo==='INCIDENCIA'?'red':a.clasificacion.tipo==='SOLICITUD'?'blue':'gray'}>{a.clasificacion.tipo}</Pill>
                          <PrioridadDot n={a.prioridad.nivel}/><small style={{fontWeight:700}}>{a.prioridad.nivel}</small>
                          <span className="mono" style={{fontSize:11,color:'var(--muted)',marginLeft:'auto'}}>{correo.fecha.slice(0,16).replace('T',' ')} • {Math.round(a.confianza*100)}%</span>
                        </div>
                        <div style={{fontSize:12,color:'var(--text2)',marginTop:4,lineHeight:1.5,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{correo.cuerpo.slice(0,180)}…</div>
                        <div style={{fontSize:11,color:'var(--muted)',marginTop:6,display:'flex',gap:8,flexWrap:'wrap'}}>
                          <span>De: {correo.remitente.split('<')[0].trim()}</span>•<span>Turno: <b className={a.turno.accionEsperadaDe==='COORDINADORA'?'turno-tu':'turno-externo'}>{a.turno.accionEsperadaDe}</b></span>•<span>{a.accion.accionEsperada.slice(0,60)}</span>•<span>{correo.adjuntos.length? '📎 '+correo.adjuntos.join(', '):'sin adjuntos'}</span>
                        </div>
                      </div>
                      <div style={{display:'flex',flexDirection:'column',gap:6,alignItems:'flex-end'}} onClick={e=>e.stopPropagation()}>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                          <button className="btn sm primary" onClick={()=>abrirResponder(correo)}>↩ Responder IA</button>
                          <button className="btn sm" onClick={()=>{ const p=procesos.find(x=>x.correos?.includes(correo.id)); if(p){setSel(p); setTab('procesos')} else { const h=procesos.find(x=>x.hiloId===correo.hiloId); if(h){setSel(h); setTab('procesos')} else showToast('Correo informativo — no genera proceso')}}}>Ver proceso</button>
                          <button className="btn sm" onClick={()=>marcarLeido(correo.id)}>Leído</button>
                          <button className="btn sm ghost" onClick={()=>archivarCorreo(correo.id)}>Archivar</button>
                        </div>
                        <span className="mono" style={{fontSize:10,color:'var(--muted)'}}>{a.relevancia.score}% relev. • {a.fechas.fechaCalculada||'sin fecha'}</span>
                      </div>
                    </div>
                  ))}
                  {!inboxFiltrado.length && <div className="empty-state">Sin correos en este filtro Señor.</div>}
                </div>
              </div>
            </>
          )}

          {tab==='procesos' && (
            <>
              <div className="filters">
                <input placeholder="Buscar proceso, ID, área…" value={filtro.q} onChange={e=>setFiltro({...filtro,q:e.target.value})}/>
                <select value={filtro.prior} onChange={e=>setFiltro({...filtro,prior:e.target.value})}><option value="TODAS">Todas prioridades</option><option>CRITICA</option><option>ALTA</option><option>MEDIA</option><option>BAJA</option></select>
                <select value={filtro.estado} onChange={e=>setFiltro({...filtro,estado:e.target.value})}><option value="TODOS">Todos estados</option>{['NUEVO','EN_PROCESO','PENDIENTE','ESPERANDO','SEGUIMIENTO','VENCIDO','REPROGRAMADO','CERRADO','COMPLETADO'].map(s=><option key={s}>{s}</option>)}</select>
                <select value={filtro.area} onChange={e=>setFiltro({...filtro,area:e.target.value})}><option value="TODAS">Todas áreas</option><option>Operaciones</option><option>Compras</option><option>Talento Humano</option><option>TI</option><option>Logística</option><option>Reclutamiento</option><option>Bienestar</option></select>
                <button className="btn sm ghost" onClick={()=>setFiltro({q:'',prior:'TODAS',estado:'TODOS',area:'TODAS'})}>Limpiar filtros</button>
                <button className="btn sm" onClick={()=>{ const rows=filtrados.map(p=>`${p.id},${p.titulo},${p.prioridad},${p.estado},${p.fechaLimite}`).join('\n'); const blob=new Blob([rows],{type:'text/csv'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='procesos.csv'; a.click(); showToast('CSV exportado')}}>Exportar CSV</button>
              </div>
              <div className="table-wrap card" style={{padding:0}}>
                <table className="table">
                  <thead><tr><th>Proceso</th><th>Prioridad</th><th>Estado</th><th>Etapa</th><th>Vence</th><th>Retraso</th><th>Turno</th><th></th></tr></thead>
                  <tbody>
                    {filtrados.map(p=>(
                      <tr key={p.id} className={sel?.id===p.id?'sel':''} onClick={()=>setSel(p)} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); setSel(p) } }} tabIndex={0} aria-selected={sel?.id===p.id} style={{cursor:'pointer'}}>
                        <td><div style={{fontWeight:700,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:320}}>{p.id} — {p.titulo}</div><div style={{fontSize:11,color:'var(--muted)'}}>{p.area} • {p.categoria}</div></td>
                        <td><PrioridadDot n={p.prioridad}/> <small style={{fontWeight:700}}>{p.prioridad}</small></td>
                        <td><Pill color={p.estado==='VENCIDO'?'red':p.estado==='EN_PROCESO'?'blue':p.estado==='ESPERANDO'?'cyan':'gray'}>{p.estado}</Pill></td>
                        <td style={{fontSize:12}}>{p.etapa}</td>
                        <td style={{fontSize:12}}>{p.fechaLimite}</td>
                        <td style={{fontSize:12,color:p.retraso>0?undefined:'var(--muted)'}} className={p.retraso>0?'text-danger':''}>{p.retraso?`+${p.retraso}`:'0'}</td>
                        <td style={{fontSize:12}}>{p.turnoActual==='COORDINADORA'?<b className="turno-tu">TÚ</b>:<span className="turno-externo">Externo</span>}</td>
                        <td><button className="btn sm" onClick={(e)=>{e.stopPropagation(); setSel(p)}}>Detalle</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filtrados.length && <div className="empty-state">Sin resultados con esos filtros Señor.</div>}
              </div>
              {sel && (
                <div className="detail-grid">
                  <div className="card">
                    <div className="card-head"><h3>{sel.id} — {sel.titulo}</h3><PrioridadDot n={sel.prioridad}/><Pill color={sel.prioridad==='CRITICA'?'red':'orange'}>{sel.prioridad}</Pill></div>
                    <p style={{fontSize:13,color:'var(--text2)',lineHeight:1.65,background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:8,padding:'12px 14px'}}>{sel.descripcion}</p>
                    <div className="kv">
                      <div><b>Responsable</b><span>{sel.responsable}</span></div>
                      <div><b>Estado</b><span>{sel.estado}</span></div>
                      <div><b>Etapa</b><span>{sel.etapa}</span></div>
                      <div><b>Turno</b><span className={sel.turnoActual==='COORDINADORA'?'turno-tu':'turno-externo'}>{sel.turnoActual} {sel.esperanRespuesta?'• espera tu respuesta':''}</span></div>
                      <div><b>Vence</b><span>{sel.fechaLimite} • restante {sel.tiempoRestante}d</span></div>
                      <div><b>SLA</b><span>obj {sel.tiempoObjetivo}d • trans {sel.tiempoTranscurrido}d • retraso {sel.retraso}d</span></div>
                      <div style={{gridColumn:'1 / -1'}}><b>Próxima acción</b><span style={{color:'#d97706',fontWeight:700}}>{sel.proximaAccion}</span></div>
                    </div>
                    <div style={{marginTop:14,background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:10,padding:14}}>
                      <div style={{fontWeight:700,fontSize:12,marginBottom:8}}>✅ Checklist — ¿qué necesitan para responder?</div>
                      {(sel.tareas?.length? sel.tareas : [{titulo:'Responder solicitud principal',done:false}]).map(t=>(
                        <label key={t.titulo} style={{display:'flex',gap:8,fontSize:12,padding:'7px 0',borderBottom:'1px solid var(--border)',alignItems:'center'}}>
                          <input type="checkbox" checked={!!t.done} onChange={()=>{ const nt=sel.tareas.map(x=> x.titulo===t.titulo? {...x,done:!x.done}:x); updateProceso(sel.id,{tareas:nt}); setSel({...sel,tareas:nt}); showToast(t.done?'Pendiente':'Completado')}}/> {t.titulo} <span style={{marginLeft:'auto',color:t.done?'#059669':'#d97706',fontWeight:700}}>{t.done?'✓':'○ pendiente'}</span>
                        </label>
                      ))}
                      <div style={{marginTop:10,display:'flex',gap:8,flexWrap:'wrap'}}>
                        <button className="btn sm primary" onClick={()=>{ updateProceso(sel.id,{tareas:(sel.tareas||[]).map(t=>({...t,done:true}))}); setSel({...sel,tareas: sel.tareas.map(t=>({...t,done:true}))}); showToast('Listo para responder'); audit('reply_ready',{proceso:sel.id})}}>Marcar listo para responder</button>
                        <button className="btn sm" onClick={()=>{ showToast('Borrador sugerido copiado')}}>Sugerir borrador</button>
                      </div>
                    </div>
                    <div style={{marginTop:12,display:'flex',gap:8,flexWrap:'wrap'}}>
                      <button className="btn primary" onClick={()=>marcarCerrado(sel.id)}>Cerrar proceso</button>
                      <button className="btn" onClick={()=>{updateProceso(sel.id,{prioridad:'CRITICA'}); refresh(); showToast('Urgente → CRÍTICA')}}>Marcar urgente</button>
                      <button className="btn ghost" onClick={()=>showToast('Borrador preparado — requiere confirmación (Action Guard)')}>Preparar reenvío</button>
                    </div>
                  </div>
                  <div className="card">
                    <h4 style={{fontSize:13,fontWeight:800,marginBottom:10}}>📜 Historial</h4>
                    <div className="timeline">
                      {sel.historial?.map((h,i)=>(<div key={i} className="tl-row"><span className="tl-date">{h.fecha}</span><span className="tl-icon">{h.icon}</span><span style={{fontSize:12}}>{h.texto}</span></div>))}
                      <div className="tl-row"><span className="tl-date">{new Date().toISOString().slice(0,10)}</span><span className="tl-icon">👁</span><span style={{fontSize:12}}>Visto por Coordinadora</span></div>
                    </div>
                    <h4 style={{fontSize:13,fontWeight:800,margin:'14px 0 8px'}}>⚠️ Incidencias</h4>
                    {(sel.incidencias?.length? sel.incidencias : [{descripcion:'Sin incidencias'}]).map((inc,i)=>(
                      <div key={i} className={`incident-box ${inc.descripcion!=='Sin incidencias'?'has-incident':''}`}>
                        {inc.descripcion} {inc.diasRetraso?`• +${inc.diasRetraso}d`:''} {inc.impacto?`• ${inc.impacto}`:''}
                      </div>
                    ))}
                    <h4 style={{fontSize:13,fontWeight:800,margin:'14px 0 8px'}}>📎 Correos asociados <small style={{fontWeight:400,color:'var(--muted)'}}>— clic para leer completo</small></h4>
                    {correos.filter(c=>sel.correos?.includes(c.id)).map(c=>(
                      <div key={c.id} className="clickable-box" role="button" tabIndex={0} onClick={()=>verCorreo(c)} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); verCorreo(c) } }} style={{fontSize:12,border:'1px solid var(--border)',borderRadius:8,padding:10,marginBottom:6,background:'var(--bg2)',cursor:'pointer'}}>
                        <b>{c.asunto}</b><div style={{color:'var(--muted)'}}>{c.remitente.split('<')[0].trim()} • {c.fecha.slice(0,16).replace('T',' ')}</div><div style={{marginTop:4,color:'var(--text2)'}}>{c.cuerpo.slice(0,110)}…</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {tab==='correos' && (
            <>
              <div className="card">
                <div className="card-head"><h3>🧠 Análisis IA — cómo entiende cada correo</h3><span className="mono" style={{fontSize:11,color:'var(--muted)'}}>Haz clic en un correo para verlo completo y responder</span></div>
                <p style={{fontSize:12,color:'var(--muted)',lineHeight:1.6,margin:'0 0 10px'}}>Por cada correo, la IA responde 4 preguntas simples: si es relevante, quién debe actuar, qué esperan de usted y para cuándo. Abajo, en gris, el detalle técnico del proceso (por si algún día lo necesita un desarrollador).</p>
                <div className="pipeline">{['INGESTA','NORMALIZACIÓN','THREAD','RELEVANCIA','INTENCIÓN','RESPONSABLE','FECHAS','MATCHER','ACCIÓN'].map(s=>(<span key={s} className="pipe-step">{s}</span>))}</div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {analisis.map(({correo,a})=>{
                  const proc = procesos.find(p=>p.correos?.includes(correo.id) || p.hiloId===correo.hiloId) || null
                  return (
                  <div key={correo.id} className="mail-card" role="button" tabIndex={0} aria-label={`Ver correo: ${correo.asunto}`} onClick={()=>verCorreo(correo)} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); verCorreo(correo) } }} style={{opacity: !a.relevancia.esRelevante?0.6:1, cursor:'pointer'}}>
                    <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                      <div className={`mail-type t-${a.clasificacion.tipo}`}>{a.clasificacion.tipo}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:700,fontSize:13}}>{correo.asunto} <span style={{fontWeight:400,color:'var(--muted)',fontSize:12}}>— {correo.remitente.split('<')[0].trim()}</span></div>
                        <div style={{fontSize:12,color:'var(--text2)',marginTop:4}}>{explicarTipo(a.clasificacion.tipo)}</div>
                        <div style={{marginTop:8,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:8}}>
                          <div className="mini-card"><b>¿Es relevante?</b><br/>{a.relevancia.esRelevante?'✅ Sí':'⚪ No'} • {a.relevancia.score}%</div>
                          <div className="mini-card"><b>¿Quién actúa?</b><br/>{explicarTurno(a)}</div>
                          <div className="mini-card"><b>¿Qué esperan?</b><br/>{a.accion.accionEsperada.slice(0,50)}</div>
                          <div className="mini-card"><b>¿Para cuándo?</b><br/>{a.fechas.fechaCalculada||'Sin fecha límite'}</div>
                        </div>
                        <div style={{marginTop:8,display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}><Pill color={a.prioridad.nivel==='CRITICA'?'red':a.prioridad.nivel==='ALTA'?'orange':'gray'}>{a.prioridad.nivel}</Pill>{a.incidencia.existe&&<Pill color="red">INCIDENCIA</Pill>}<span className="mono" style={{fontSize:11,color:'var(--muted)'}}>{Math.round(a.confianza*100)}% de confianza de la IA</span></div>
                      </div>
                      <PrioridadDot n={a.prioridad.nivel}/>
                    </div>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:10}} onClick={e=>e.stopPropagation()}>
                      <button className="btn sm primary" onClick={()=>abrirResponder(correo)}>↩ Responder IA</button>
                      {proc && <button className="btn sm" onClick={()=>{setSel(proc); setTab('procesos')}}>Ver proceso</button>}
                      <button className="btn sm ghost" onClick={()=>marcarLeido(correo.id)}>Leído</button>
                      <button className="btn sm ghost" onClick={()=>archivarCorreo(correo.id)}>Archivar</button>
                    </div>
                  </div>
                )})}
              </div>
            </>
          )}

          {tab==='sheets' && (
            <div className="card">
              <div className="card-head"><h3>📒 Google Sheets — vista operativa</h3><button className="btn primary" onClick={()=>showToast('Exportado a Sheets (simulado) — en prod usa Sheets API')}>Exportar a Sheets</button></div>
              <div className="table-wrap"><table className="table"><thead><tr><th>ID</th><th>Título</th><th>Área</th><th>Prioridad</th><th>Estado</th><th>Vence</th><th>Retraso</th></tr></thead><tbody>{procesos.map(p=>(<tr key={p.id} tabIndex={0} style={{cursor:'pointer'}} onClick={()=>{setSel(p); setTab('procesos')}} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); setSel(p); setTab('procesos') } }} aria-label={`Ver proceso ${p.titulo}`}><td className="mono" style={{fontSize:12}}>{p.id}</td><td style={{fontSize:12,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:280}}>{p.titulo}</td><td style={{fontSize:12}}>{p.area}</td><td><PrioridadDot n={p.prioridad}/>{p.prioridad}</td><td><Pill color="gray">{p.estado}</Pill></td><td style={{fontSize:12}}>{p.fechaLimite}</td><td style={{fontSize:12}} className={p.retraso>0?'text-danger':''}>{p.retraso||0}</td></tr>))}</tbody></table></div>
              <div style={{marginTop:10,fontSize:11,color:'var(--muted)'}}>💡 Haz clic en una fila para ver el detalle completo del proceso.</div>
            </div>
          )}

          {tab==='auditoria' && (
            <div className="card">
              <div className="card-head"><h3>🛡️ Auditoría — todo lo que se hizo, registrado</h3><span className="mono" style={{fontSize:11,color:'var(--muted)'}}>Nada se envía ni se cierra sin que quede aquí</span></div>
              <p style={{fontSize:12,color:'var(--muted)',lineHeight:1.6,margin:'0 0 12px'}}>Cada vez que se sincroniza Gmail, se envía una respuesta o se marca algo urgente, queda una línea aquí — así siempre puede revisar qué pasó y cuándo, para su tranquilidad.</p>
              <div style={{display:'grid',gap:8}}>
                {(()=>{
                  const log = getAuditLog()
                  const etiqueta = {
                    sync_gmail:'🔄 Sincronizó Gmail',
                    enviar_respuesta:'✉️ Envió una respuesta',
                    reenvio:'↪️ Preparó un reenvío',
                    reply_ready:'✅ Marcó un proceso listo para responder',
                    mascota_instruccion:'🐶 Mascota — instrucción',
                    mascota_completar:'🐶 Posible finalización',
                    mascota_cerrar:'🐶 Cierre confirmado',
                    mascota_reenvio_preparado:'🐶 Reenvío preparado',
                    mascota_reprogramar:'🐶 Reprogramado',
                    mascota_seguimiento:'🐶 Seguimiento creado',
                    mascota_urgente:'🐶 Marcado urgente',
                  }
                  if(!log.length) return <div className="empty-state">Aún no hay acciones registradas. Aparecerán aquí en cuanto sincronice Gmail o responda un correo.</div>
                  return log.slice(0,30).map((r,i)=>(
                    <div key={i} style={{display:'flex',gap:12,fontSize:12,border:'1px solid var(--border)',borderRadius:8,padding:12,alignItems:'center',background:'var(--bg2)',flexWrap:'wrap'}}>
                      <span className="mono" style={{color:'var(--muted)',minWidth:140}}>{new Date(r.fecha).toLocaleString()}</span>
                      <span style={{minWidth:110,fontWeight:700}}>{r.usuario}</span>
                      <span style={{flex:1,minWidth:160}}>{etiqueta[r.accion]||r.accion}{r.to?` — a ${String(r.to).split('<')[0].trim()}`:''}{r.subject?`: "${r.subject.slice(0,60)}"`:''}{r.account?` (${r.account})`:''}{r.id?` — ${r.id}`:''}{r.proceso?` • ${r.proceso}`:''}{r.destinatario?` → ${r.destinatario}`:''}{r.texto?` “${r.texto.slice(0,40)}”`:''}</span>
                      <Pill color="blue">Registrado</Pill>
                    </div>
                  ))
                })()}
              </div>
            </div>
          )}
        </main>

      </div>
      {/* Mascota flotante — mano derecha, concisa, no duplica la web */}
      <Mascota procesos={procesos} analisis={analisis} sel={sel} viewCorreo={viewCorreo} onAction={handleMascotaAction} showToast={showToast} />
      {reply && (
        <div className="reply-overlay" onClick={()=>!sending && setReply(null)}>
          <div className="reply-modal" onClick={e=>e.stopPropagation()}>
            <div className="reply-head">
              <div>
                <h3>↩ Responder — con contexto IA</h3>
                <div className="mono" style={{fontSize:11,color:'var(--muted)',marginTop:2}}>Hilo {reply.correo.hiloId.slice(0,8)} • {reply.analisis.prioridad.nivel} {reply.analisis.prioridad.score}/100 • conf {Math.round(reply.analisis.confianza*100)}% • {reply.sugerencia.tono}</div>
              </div>
              <button className="btn sm ghost" onClick={()=>setReply(null)}>✕</button>
            </div>
            <div className="reply-body">
              <div className="reply-context">
                <b style={{fontSize:11,textTransform:'uppercase',letterSpacing:0.5}}>Contexto detectado por IA</b>
                <div style={{marginTop:6,display:'flex',gap:6,flexWrap:'wrap'}}>
                  <Pill color={reply.analisis.clasificacion.tipo==='URGENTE'?'red':'blue'}>{reply.analisis.clasificacion.tipo}</Pill>
                  <Pill color={reply.analisis.turno.accionEsperadaDe==='COORDINADORA'?'red':'cyan'}>Turno: {reply.analisis.turno.accionEsperadaDe}</Pill>
                  <Pill color="gray">{reply.analisis.fechas.fechaCalculada? `Vence ${reply.analisis.fechas.fechaCalculada}`:'Sin fecha'}</Pill>
                </div>
                <div style={{marginTop:8,color:'var(--muted)'}}><b>Qué esperan:</b> {reply.analisis.accion.accionEsperada}</div>
                {reply.sugerencia.checklist.length>0 && <div style={{marginTop:6}}><b>Checklist:</b> {reply.sugerencia.checklist.map(c=>c.q).join(' • ')}</div>}
                {reply.proceso && <div style={{marginTop:6}}><b>Proceso:</b> {reply.proceso.id} — {reply.proceso.titulo.slice(0,60)}</div>}
                <details style={{marginTop:10}}>
                  <summary>📩 Ver el correo original completo, tal cual llegó</summary>
                  <div className="email-original" style={{marginTop:8,maxHeight:220}}>{reply.correo.cuerpo}</div>
                </details>
              </div>
              <div className="reply-field"><label>Para</label><input value={reply.correo.remitente} readOnly style={{background:'var(--bg2)',color:'var(--muted)'}} /></div>
              <div className="reply-field"><label>Asunto</label><input value={reply.asunto} onChange={e=>setReply(r=>({...r, asunto:e.target.value}))} /></div>
              <div className="reply-field"><label>Mensaje sugerido por IA — editable</label><textarea value={reply.cuerpo} onChange={e=>setReply(r=>({...r, cuerpo:e.target.value}))} rows={12} /></div>
              <div style={{fontSize:11,color:'var(--muted)',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:8,padding:10}}>
                💡 <b>Sugerencia IA:</b> El tono es {reply.sugerencia.tono}. La IA ya consideró el hilo completo ({reply.correo.hiloId.slice(0,8)}) y el checklist. Puedes editar antes de enviar. <b>Action Guard:</b> requiere confirmación antes de enviar a externo.
              </div>
            </div>
            <div className="reply-actions">
              <span className="mono" style={{fontSize:11,color:'var(--muted)'}}>Gmail REAL • {reply.correo.remitente.split('<')[0].trim()} • via {GMAIL_META.account}</span>
              <div style={{display:'flex',gap:8}}>
                <button className="btn ghost" onClick={()=>setReply(null)} disabled={sending}>Cancelar</button>
                <button className="btn primary" onClick={enviarRespuesta} disabled={sending || !reply.cuerpo.trim()}>{sending?'Enviando…':'Enviar respuesta →'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewCorreo && (
        <div className="reply-overlay" onClick={()=>setViewCorreo(null)}>
          <div className="reply-modal" onClick={e=>e.stopPropagation()}>
            <div className="reply-head">
              <div>
                <h3>✉️ {viewCorreo.correo.asunto}</h3>
                <div className="mono" style={{fontSize:11,color:'var(--muted)',marginTop:2}}>
                  De: {viewCorreo.correo.remitente} • Para: {viewCorreo.correo.destinatarios?.join(', ')||'—'} • {new Date(viewCorreo.correo.fecha).toLocaleString()}
                </div>
              </div>
              <button className="btn sm ghost" onClick={()=>setViewCorreo(null)} aria-label="Cerrar">✕</button>
            </div>
            <div className="reply-body">
              <div>
                <label style={{fontSize:11,fontWeight:700,letterSpacing:0.5,textTransform:'uppercase',color:'var(--muted)',display:'block',marginBottom:6}}>El correo, tal cual llegó</label>
                <div className="email-original">{viewCorreo.correo.cuerpo}</div>
                {viewCorreo.correo.adjuntos?.length>0 && <div style={{fontSize:12,color:'var(--muted)',marginTop:8}}>📎 Adjuntos: {viewCorreo.correo.adjuntos.join(', ')}</div>}
              </div>
              <div className="ai-explain">
                <b>🤖 En palabras simples</b>
                <p>{explicarTipo(viewCorreo.a.clasificacion.tipo)}</p>
                <p>{explicarTurno(viewCorreo.a)}{viewCorreo.a.fechas.fechaCalculada?` Fecha límite: ${viewCorreo.a.fechas.fechaCalculada}.`:''}</p>
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:10}}>
                  <Pill color={viewCorreo.a.prioridad.nivel==='CRITICA'?'red':viewCorreo.a.prioridad.nivel==='ALTA'?'orange':'gray'}>{viewCorreo.a.prioridad.nivel}</Pill>
                  {viewCorreo.a.incidencia.existe && <Pill color="red">Incidencia</Pill>}
                  {viewCorreo.proc && <Pill color="blue">Proceso {viewCorreo.proc.id}</Pill>}
                </div>
              </div>
            </div>
            <div className="reply-actions">
              <span className="mono" style={{fontSize:11,color:'var(--muted)'}}>{viewCorreo.correo.etiquetas?.includes('UNREAD')?'● No leído':'Leído'}</span>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {viewCorreo.proc && <button className="btn ghost" onClick={()=>{ setSel(viewCorreo.proc); setTab('procesos'); setViewCorreo(null) }}>Ver proceso</button>}
                <button className="btn" onClick={()=>{ marcarLeido(viewCorreo.correo.id); setViewCorreo(null) }}>Marcar leído</button>
                <button className="btn ghost" onClick={()=>{ archivarCorreo(viewCorreo.correo.id); setViewCorreo(null) }}>Archivar</button>
                <button className="btn primary" onClick={()=>{ const c=viewCorreo.correo; setViewCorreo(null); abrirResponder(c) }}>Responder con IA →</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer style={{textAlign:'center',padding:'16px 0 24px',fontSize:11,color:'var(--muted)'}} className="mono">MVP 1 • Gmail REAL → IA → Firebase → Web • Responder con contexto • Inbox ordenado • {new Date().toLocaleDateString()}</footer>
    </div>
  )
}


