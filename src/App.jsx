import { useState, useEffect, useMemo, useRef } from 'react'
import { updateProceso, audit } from './data/mockFirebase.js'
import LoginScreen from './components/LoginScreen.jsx'
import { Donut, HBarList, TrendBars } from './components/Charts.jsx'
import { iniciales } from './services/authService.js'
import {
  Sparkles, ChevronRight, ChevronLeft, Home, Mail, RefreshCw,
  CheckSquare, Calendar, CalendarPlus, Users, Settings, Bot, Leaf, CornerUpLeft,
  Clock, ListChecks, Reply, Archive, Check, Send, AlertTriangle,
  MessageSquare, Plus, LayoutGrid, Building2,
  X, GripVertical, BarChart3, ExternalLink, Trash2, Brain, ScanSearch, Loader2,
} from 'lucide-react'
import './App.css'
import { fechaLocalISO, diasEntre } from './utils/dateUtils.js'
import { explicarTipo, explicarTurno, explicarEtapa, formatEstado, estadoVisualProceso, estadoVisualCorreo, estadoKanban, KANBAN_COLUMNAS, subtareasProgreso } from './utils/estadoUtils.js'
import { RE_EMAIL, colorDeAvatar, inicialesDe, nombreDeRemitente, correoDeRemitente } from './utils/contactoUtils.js'
import { prioridadMockup, saludoPorHora } from './utils/textoUtils.js'
import { mensajeAsistente } from './engine/asistenteChat.js'
import Pill from './components/ui/Pill.jsx'
import PrioridadDot from './components/ui/PrioridadDot.jsx'
import Switch from './components/ui/Switch.jsx'
import EstadoBadge from './components/ui/EstadoBadge.jsx'
import TaskDetailModal from './components/TaskDetailModal.jsx'
import TaskCreateModal from './components/TaskCreateModal.jsx'
import Sidebar from './components/Sidebar.jsx'
import Topbar from './components/Topbar.jsx'
import { useTheme } from './hooks/useTheme.js'
import { useToasts } from './hooks/useToasts.js'
import { useAuthSession } from './hooks/useAuthSession.js'
import { useConfiguracionPersistida } from './hooks/useConfiguracionPersistida.js'
import { useCorreosYProcesos } from './hooks/useCorreosYProcesos.js'
import { useAsistenteChat } from './hooks/useAsistenteChat.js'
import { useGoogleCalendar } from './hooks/useGoogleCalendar.js'
import { useMemoriaAsistente } from './hooks/useMemoriaAsistente.js'
import { useClasificacionIA } from './hooks/useClasificacionIA.js'
import { estadoIA, diagnosticoIA } from './services/aiService.js'
import ChatMensaje from './components/ChatMensaje.jsx'
import { useEntrenamientoIA } from './hooks/useEntrenamientoIA.js'
import ConfiguracionView from './components/config/ConfiguracionView.jsx'
import CorregirModal from './components/CorregirModal.jsx'

// Íconos lineales únicos (Lucide, sección 42 de la especificación) para cada
// pestaña del sidebar — reemplazan los emoji sueltos que usaba cada quien a
// su gusto antes de esta especificación formal.
const NAV_ICONS = {
  dashboard: Home,
  inbox: Mail,
  seguimientos: RefreshCw,
  procesos: CheckSquare,
  calendario: Calendar,
  estadisticas: BarChart3,
  contactos: Users,
  configuracion: Settings,
}

export default function App(){
  const [theme,setTheme]=useTheme()
  const { toasts, showToast, dismissToast } = useToasts()
  const [procesos,setProcesos]=useState([])
  const { session, setSession, loginStatus, loginEsperado, loginConectado, composioConfigured, menuOpen, setMenuOpen, gmailConectado, setGmailConectado, handleDemoLogin, handleGoogleLogin, handleRealConnect, handleLogout } = useAuthSession({ setProcesos, showToast })

  const [filtro,setFiltro]=useState({q:'', prior:'TODAS', estado:'TODOS', area:'TODAS'})
  const [inboxFiltro,setInboxFiltro]=useState({q:'', tab:'TODOS'}) // TODOS, ACCION, URGENTES, INCIDENCIAS, NO_RELEVANTE
  const [sel,setSel]=useState(null)
  const [tab,setTab]=useState('dashboard')
  const [procesosVista,setProcesosVista]=useState('kanban') // 'kanban' | 'tabla' — Tareas (mockup: Kanban por defecto)
  const [taskModal,setTaskModal]=useState(null) // {mode:'view'|'create', proceso?}
  const [dragOverCol,setDragOverCol]=useState(null)
  const [calMes,setCalMes]=useState(()=>{ const d=new Date(); return {y:d.getFullYear(), m:d.getMonth()} })
  const [calDiaSel,setCalDiaSel]=useState(()=>fechaLocalISO())

  // --- "Mi Asistente": rediseño completo pedido por el Señor (documento de
  // 63 secciones) — mismo proyecto, mismos datos reales, nueva capa de
  // estado para lo que antes no existía: correos archivados (de verdad, no
  // borrados), configuración de la persona, y el panel de chat real del
  // "Asistente personal". Todo se guarda por cuenta (session.email) para
  // que las 4 personas que usan la app no se pisen el localStorage entre sí.
  const { archivados, setArchivados, configuracion, setConfiguracion, recordatoriosGenerales, setRecordatoriosGenerales } = useConfiguracionPersistida(session?.email)
  const [mailMenuAbierto,setMailMenuAbierto]=useState(null) // id del correo con el menú kebab abierto
  const [ordenBandeja,setOrdenBandeja]=useState('URGENCIA') // URGENCIA | RECIENTE
  const [busquedaTop,setBusquedaTop]=useState('') // buscador del topbar (mockup) — busca en asunto/remitente/cuerpo

  const {
    correos, setCorreos, loading, analisis, gmailError, syncing, sheetsSyncing,
    refresh, stats, metricas, resumenSemana, correosPorDia, prioridadesData,
    filtrados, inboxFiltrado, buckets, verMas, setVerMas,
    contactosDerivados, seguimientosFlat, sugerenciaIA,
    kpiHoy, kpiDelta, planDelDia, confianzaProm,
    handleSync, exportarCSV, sincronizarSheetsReal, correosDeTarea,
    moverAArchivados, restaurarArchivado, actualizarSeguimiento, posponerSeguimiento,
    sincronizarCorreosDeTareaConGmail, agregarHistorial, marcarCerrado, marcarProcesoListo,
    moverKanban, crearTareaManual, eliminarTareaManual, marcarLeido, archivarCorreo,
    seleccionados, setSeleccionados, toggleSeleccion, marcarLeidosSeleccionados, archivarSeleccionados,
    reply, setReply, sending, confirmSend, setConfirmSend, sendError, setSendError,
    viewCorreo, setViewCorreo,
    abrirResponder, prepararReenvio, verCorreo, enviarRespuesta,
  } = useCorreosYProcesos({ session, showToast, gmailConectado, setGmailConectado, archivados, setArchivados, sel, setSel, tab, setTab, setInboxFiltro, filtro, inboxFiltro, procesos, setProcesos })

  // Google Calendar real (Composio): estado de conexión + eventos del mes visible.
  const { gcal, gcalEventos, gcalCargando, gcalError, gcalCreando, conectarCalendar, desconectarCalendar, recargarCalendar, enviarTareaACalendar } = useGoogleCalendar({ session, calMes, showToast, refresh })

  // --- Secretaria IA (Gemini): ¿está configurada en el servidor?, memoria
  // duradera por persona, chat con acciones confirmables y revisión
  // automática de cada conversación del correo.
  const [ia,setIa]=useState({ configured:false })
  useEffect(()=>{ if(!session?.real){ setIa({configured:false}); return } estadoIA().then(setIa).catch(()=>setIa({configured:false})) },[session?.real, session?.email])
  const { memoria, recordar, olvidar } = useMemoriaAsistente(session?.real ? session.email : null)
  const iaPorHiloRef = useRef({})
  const { entrenamiento, actualizar: actualizarEntrenamiento, agregarRegla, quitarRegla, agregarEjemplo, guardado: entrenamientoGuardado } = useEntrenamientoIA(session?.real ? session.email : null)
  const [corrigiendo,setCorrigiendo]=useState(null) // correo que la persona está corrigiendo

  // Lo que la secretaria puede hacer cuando la persona confirma una acción.
  const buscarProceso = id => { const p = procesos.find(x=>x.id===id); if(!p) throw new Error('No encontré esa tarea'); return p }
  const ejecutoresIA = {
    crear_seguimiento: async a => {
      const fecha = /^\d{4}-\d{2}-\d{2}$/.test(a.fecha||'') ? a.fecha : fechaLocalISO(new Date(Date.now()+86400000))
      const p = a.procesoId ? procesos.find(x=>x.id===a.procesoId) : null
      if(p){ const seguimientos=[...(p.seguimientos||[]), {fecha, nota:a.nota||a.descripcion}]; await updateProceso(p.id,{seguimientos}); refresh(); if(sel?.id===p.id) setSel(s=>s?{...s,seguimientos}:s); return `Seguimiento el ${fecha}` }
      setRecordatoriosGenerales(r=>[{id:`rec-${Date.now()}`, texto:a.nota||a.descripcion, fecha, creado:new Date().toISOString()}, ...r])
      return `Recordatorio el ${fecha}`
    },
    marcar_listo: async a => { buscarProceso(a.procesoId); marcarProcesoListo(a.procesoId); return 'Marcada como lista' },
    cambiar_prioridad: async a => { buscarProceso(a.procesoId); await updateProceso(a.procesoId,{prioridad:a.prioridad||'ALTA'}); refresh(); return `Prioridad ${a.prioridad}` },
    crear_tarea: async a => { const p = crearTareaManual({ titulo:a.titulo||a.descripcion, descripcion:a.nota||'', prioridad:a.prioridad||'MEDIA', area:'Operaciones', fechaLimite:a.fecha, subtareas:[] }); return `Tarea ${p.id} creada` },
    archivar_correo: async a => { if(!correos.some(c=>c.id===a.correoId)) throw new Error('No encontré ese correo'); archivarCorreo(a.correoId); return 'Archivado' },
    marcar_leido: async a => { if(!correos.some(c=>c.id===a.correoId)) throw new Error('No encontré ese correo'); marcarLeido(a.correoId); return 'Marcado leído' },
    redactar_respuesta: async a => {
      const c = correos.find(x=>x.id===a.correoId); if(!c) throw new Error('No encontré ese correo')
      abrirResponder(c); if(a.cuerpo) setReply(r=> r?{...r, cuerpo:a.cuerpo}:r)
      return 'Borrador abierto — revísalo y envíalo tú'
    },
    agregar_regla: async a => {
      const nombres = { vip:'Remitente VIP', palabrasClave:'Tema importante', ignorar:'Ignorar' }
      if(!agregarRegla(a.reglaTipo, a.valor)) throw new Error('Regla inválida')
      return `${nombres[a.reglaTipo]||'Regla'}: ${a.valor}`
    },
    agendar_calendar: async a => {
      if(!gcal.connected) throw new Error('Primero conecta Google Calendar en Configuración')
      const r = await enviarTareaACalendar(buscarProceso(a.procesoId), { hora:/^\d{2}:\d{2}$/.test(a.hora||'')?a.hora:'09:00' })
      if(!r) throw new Error('No se pudo agendar'); return 'Agendado en Google Calendar'
    },
  }

  const { chatOpen, setChatOpen, chatInput, setChatInput, chatMessages, setChatMessages, chatEnviando, enviarPreguntaChat, resolverAccion, agregarMensajeAsistente, borrarConversacion } = useAsistenteChat({ session, iaConfigurada: ia.configured, procesos, correos, seguimientosFlat, recordatoriosGenerales, gcalEventos, getIaPorHilo: ()=>iaPorHiloRef.current, memoria, entrenamiento, recordar, olvidar, ejecutores: ejecutoresIA, showToast, sel, setSel, setRecordatoriosGenerales })

  const { iaPorHilo, clasificando, clasificarAhora, reanalizarTodo, corregirHilo } = useClasificacionIA({ session, iaConfigurada: ia.configured, correos, procesos, refresh, configuracion, gmailConectado, agregarMensajeAsistente, showToast, entrenamiento })
  iaPorHiloRef.current = iaPorHilo

  // --- Fila de correo estilo mockup — un solo componente usado tanto en el
  // resumen "Bandeja inteligente" de Inicio como en la pestaña dedicada, así
  // no hay dos vistas ligeramente distintas de lo mismo (el Señor pidió
  // eliminar duplicados). El menú kebab reemplaza los 4 botones que antes
  // estaban siempre visibles en cada fila.
  function renderMailRow(correo, a){
    const nombre = nombreDeRemitente(correo.remitente)
    const email = correoDeRemitente(correo.remitente)
    const pr = prioridadMockup(a)
    const menuAbierto = mailMenuAbierto===correo.id
    return (
      <div key={correo.id} className="mailrow" role="button" tabIndex={0} onClick={()=>verCorreo(correo)} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); verCorreo(correo) } }}>
        <div className="mailrow-avatar" style={{background:colorDeAvatar(email||nombre)}}>{inicialesDe(nombre)}</div>
        <div className="mailrow-body">
          <div className="mailrow-top">
            <span className="mailrow-sender">{nombre}</span>
            <span className="mailrow-email">{email}</span>
          </div>
          <div className="mailrow-subject">{correo.asunto}{correo.etiquetas.includes('UNREAD') && <span style={{display:'inline-block',width:7,height:7,background:'var(--accent)',borderRadius:'50%',marginLeft:8,verticalAlign:'middle'}}/>}</div>
          <div className="mailrow-preview">{iaPorHilo[correo.hiloId]?.resumen || correo.cuerpo.slice(0,110)}</div>
          {iaPorHilo[correo.hiloId]?.falta && <div className="mailrow-falta">Falta: {iaPorHilo[correo.hiloId].falta}</div>}
        </div>
        <div className="mailrow-right" onClick={e=>e.stopPropagation()}>
          {iaPorHilo[correo.hiloId]?.etiquetas?.length
            ? <span className="pill-ia" title={iaPorHilo[correo.hiloId].siguientePaso}><Sparkles size={10}/> {iaPorHilo[correo.hiloId].etiquetas[0]}</span>
            : <Pill color={pr.color}>{pr.label}</Pill>}
          <div className="mailrow-meta">
            <span>{correo.fecha.slice(5,16).replace('T',' ')}</span>
            <span title="Gmail">📧</span>
            <button className="mailrow-kebab" onClick={()=>setMailMenuAbierto(m=>m===correo.id?null:correo.id)} aria-label="Más acciones">⋮</button>
          </div>
          {menuAbierto && (
            <div className="mailrow-menu">
              <button onClick={()=>{setMailMenuAbierto(null); abrirResponder(correo)}}>↩ Responder</button>
              <button onClick={()=>{setMailMenuAbierto(null); const p=procesos.find(x=>x.correos?.includes(correo.id)); if(p){setSel(p); setTab('procesos')} else { const h=procesos.find(x=>x.hiloId===correo.hiloId); if(h){setSel(h); setTab('procesos')} else showToast('Correo informativo — no genera ninguna tarea')}}}>🗂 Ver tarea</button>
              <button onClick={()=>{setMailMenuAbierto(null); marcarLeido(correo.id)}}>✓ Marcar leído</button>
              <button onClick={()=>{setMailMenuAbierto(null); archivarCorreo(correo.id)}}>🗄 Archivar</button>
              {session?.real && <button onClick={()=>{setMailMenuAbierto(null); setCorrigiendo(correo)}}>🎓 Corregir a la secretaria</button>}
            </div>
          )}
        </div>
      </div>
    )
  }

  if(session===undefined){
    return (
      <div className="login-loading">
        <div className="login-loading-logo"><Sparkles size={22} strokeWidth={2.2}/></div>
        <div className="mono" style={{fontSize:12,color:'var(--muted)'}}>Verificando sesión…</div>
      </div>
    )
  }
  if(!session){
    return <LoginScreen onDemoLogin={handleDemoLogin} onGoogleLogin={handleGoogleLogin} onRealConnect={handleRealConnect} loginStatus={loginStatus} loginEsperado={loginEsperado} loginConectado={loginConectado} composioConfigured={composioConfigured} />
  }

  return (
    <div className="app">
      <div className="toast-container">
        {toasts.map(t=>(<div key={t.id} className="toast"><span>{t.msg}</span><button onClick={()=>dismissToast(t.id)}><X size={13}/></button></div>))}
      </div>
      <button className="fab" title="Nueva tarea" aria-label="Nueva tarea" onClick={()=>{ setTab('procesos'); setProcesosVista('kanban'); setTaskModal({mode:'create'}) }}><Plus size={24}/></button>
      <Topbar
        busquedaTop={busquedaTop} setBusquedaTop={setBusquedaTop} setInboxFiltro={setInboxFiltro} setTab={setTab}
        gmailConectado={gmailConectado} session={session} handleSync={handleSync} handleRealConnect={handleRealConnect}
        loading={loading} syncing={syncing} stats={stats}
        menuOpen={menuOpen} setMenuOpen={setMenuOpen} iniciales={iniciales}
        theme={theme} setTheme={setTheme} handleLogout={handleLogout}
      />

      {gmailError && (
        <div style={{background:'var(--red-bg)',border:'1px solid var(--red)',color:'#991b1b',borderRadius:10,padding:'12px 28px',margin:'0 28px',display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <span style={{fontWeight:700}}>⚠️ No se pudo leer su Gmail real conectado ({session.email}):</span>
          <span className="mono" style={{fontSize:12}}>{gmailError}</span>
          <button className="btn sm" style={{marginLeft:'auto'}} onClick={handleSync}>Reintentar</button>
        </div>
      )}

      <div className={`layout ${tab==='dashboard'?'con-asistente':''}`}>
        <Sidebar tab={tab} setTab={setTab} correos={correos} seguimientosFlat={seguimientosFlat} stats={stats} analisis={analisis} archivados={archivados} setInboxFiltro={setInboxFiltro} gmailConectado={gmailConectado} session={session} navIcons={NAV_ICONS} />

        <main className="main">
          {tab==='dashboard' && (
            <>
              <div className="welcome-banner">
                <div className="banner-top">
                  <div className="banner-title"><Sparkles size={20}/> {saludoPorHora()}, {session.nombre?.split(' ')[0]||''}</div>
                  <div className="banner-date"><Calendar size={13}/> {new Date().toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long'})}</div>
                </div>
                <div className="banner-subtitle">
                  {gmailConectado ? <>Datos reales de <b>{session.email}</b> · {correos.length} correos analizados · inbox ordenado por prioridad</>
                    : session.firebase ? <>Sesión Google de <b>{session.email}</b> · Gmail aún no conectado — <button className="btn sm" style={{background:'rgba(255,255,255,0.18)',color:'#fff',border:'1px solid rgba(255,255,255,0.3)'}} onClick={()=>handleRealConnect({name:session.nombre, email:session.email})}>Conectar Gmail real →</button></>
                    : <>Modo demostración · {correos.length} correos de ejemplo · ningún dato real de Proservis</>}
                </div>
                <div className="banner-quote"><Leaf size={12}/> "Más enfoque, menos correos."</div>
              </div>

              {/* 5 tarjetas KPI del mockup, con delta real "desde ayer" —
                  nunca inventado: se compara contra la foto guardada el día
                  anterior en localStorage (ver kpiAyer/kpiHoy más arriba). */}
              <div className="kpi-grid">
                {[
                  {campo:'requierenRespuesta', label:'Requieren tu respuesta', valor:kpiHoy.requierenRespuesta, color:'red', icon:Mail, irA:()=>{setTab('inbox'); setInboxFiltro(f=>({...f,tab:'ACCION'}))}},
                  {campo:'incidencias', label:'Incidencias', valor:analisis.filter(a=>a.a.incidencia.existe).length, color:'orange', icon:AlertTriangle, irA:()=>{setTab('inbox'); setInboxFiltro(f=>({...f,tab:'INCIDENCIAS'}))}},
                  {campo:'esperandoRespuesta', label:'Esperando respuesta', valor:kpiHoy.esperandoRespuesta, color:'yellow', icon:CornerUpLeft, irA:()=>setTab('seguimientos')},
                  {campo:'seguimientos', label:'Seguimientos', valor:kpiHoy.seguimientos, color:'blue', icon:Clock, irA:()=>setTab('seguimientos')},
                  {campo:'tareas', label:'Tareas', valor:kpiHoy.tareas, color:'green', icon:CheckSquare, irA:()=>setTab('procesos')},
                ].map(k=>{
                  const d = kpiDelta(k.campo)
                  const KpiIcon = k.icon
                  return (
                    <button key={k.campo} className={`kpi-card ${k.color}`} onClick={k.irA}>
                      <div className="kpi-header">
                        <span className="kpi-icon"><KpiIcon size={16} strokeWidth={2.2}/></span>
                        <span style={{color:'var(--muted2)'}}><ChevronRight size={15}/></span>
                      </div>
                      <div className="kpi-label">{k.label}</div>
                      <div className="kpi-value">{k.valor}</div>
                      <div className={`kpi-delta ${d==null?'':d>0?'up':d<0?'down':'flat'}`}>{d==null?'Sin datos de ayer aún':d===0?'Igual que ayer':`${d>0?'↑':'↓'} ${Math.abs(d)} desde ayer`}</div>
                    </button>
                  )
                })}
              </div>

              {/* "Tu asistente te recuerda" — un solo mensaje dinámico, nunca
                  texto fijo: prioriza lo más urgente/atrasado real de esta
                  cuenta (secciones 5/41 del documento). */}
              <div className="asis-card asis-verde" style={{display:'flex',gap:14,alignItems:'center',flexWrap:'wrap'}}>
                <div className="asis-avatar" style={{width:44,height:44}}>🤖</div>
                <div style={{flex:1,minWidth:220}}>
                  <b style={{fontSize:13,display:'block',marginBottom:2}}>Tu asistente te recuerda</b>
                  <span style={{fontSize:12.5,color:'var(--text2)'}}>{mensajeAsistente({
                    urgentes: buckets.atenderAhora.map(x=>({titulo:x.correo.asunto})),
                    sinRespuesta: buckets.seguimientos.map(x=>({titulo:x.correo.asunto, responsable:nombreDeRemitente(x.correo.remitente), ultimaActividad:x.correo.fecha})),
                    requierenResp: buckets.requiereRespuesta.map(x=>({titulo:x.correo.asunto})),
                    seguimientosProximos: seguimientosFlat.filter(s=>s.estado==='PROXIMO'),
                  })}</span>
                </div>
                <button className="btn primary sm" onClick={()=>{setTab('inbox'); setInboxFiltro(f=>({...f,tab:'ACCION'}))}}>Ver pendientes →</button>
              </div>

              {/* Bandeja inteligente — el mismo componente de fila que usa la
                  pestaña dedicada (sin duplicar la vista), con sus pestañas de
                  filtro y "Ordenar por". */}
              <div className="card">
                <div className="card-head"><h3>Bandeja inteligente</h3>
                  <select className="input" style={{width:'auto'}} value={ordenBandeja} onChange={e=>setOrdenBandeja(e.target.value)}>
                    <option value="URGENCIA">Ordenar por: Urgencia</option>
                    <option value="RECIENTE">Ordenar por: Más reciente</option>
                  </select>
                </div>
                <div className="bandeja-tabs">
                  {[
                    {k:'TODOS',l:'Todos',n:analisis.length},
                    {k:'ACCION',l:'Requieren respuesta',n:analisis.filter(a=>a.a.accion.requiereAccion && a.a.turno.accionEsperadaDe==='COORDINADORA').length},
                    {k:'ESPERANDO',l:'Esperando respuesta',n:analisis.filter(a=>a.a.turno.accionEsperadaDe!=='COORDINADORA').length},
                    {k:'SEGUIMIENTOS',l:'Seguimientos',n:seguimientosFlat.filter(s=>['PENDIENTE','PROXIMO','VENCIDO'].includes(s.estado)).length},
                    {k:'TAREAS',l:'Tareas',n:stats.total},
                  ].map(t=>(
                    <button key={t.k} className={`bandeja-tab ${inboxFiltro.tab===t.k?'active':''}`} onClick={()=>{ if(t.k==='TAREAS'){ setTab('procesos'); return } if(t.k==='SEGUIMIENTOS'){ setTab('seguimientos'); return } setInboxFiltro(f=>({...f,tab:t.k}))}}>{t.l} <span className="n">{t.n}</span></button>
                  ))}
                </div>
                <div>
                  {[...inboxFiltrado].sort((a,b)=> ordenBandeja==='RECIENTE' ? new Date(b.correo.fecha)-new Date(a.correo.fecha) : (b.a.prioridad.score-a.a.prioridad.score)).slice(0,8).map(({correo,a})=>renderMailRow(correo,a))}
                  {!inboxFiltrado.length && <div className="empty-state">Sin correos en este filtro.</div>}
                </div>
                <div className="acciones-rapidas">
                  <span style={{fontSize:11.5,fontWeight:800,color:'var(--muted)'}}>Acciones rápidas</span>
                  <button className="btn sm" onClick={()=>{ if(inboxFiltrado[0]) abrirResponder(inboxFiltrado[0].correo); else showToast('No hay correos para responder')}}><Reply size={13}/> Responder</button>
                  <button className="btn sm" onClick={()=>setTab('seguimientos')}><CalendarPlus size={13}/> Programar seguimiento</button>
                  <button className="btn sm" onClick={marcarLeidosSeleccionados} disabled={!seleccionados.size}><Check size={13}/> Marcar como leído</button>
                  <button className="btn sm" onClick={archivarSeleccionados} disabled={!seleccionados.size}><Archive size={13}/> Archivar</button>
                  <span className="card-link" style={{marginLeft:'auto'}} onClick={()=>setTab('inbox')}>Ver más acciones →</span>
                </div>
              </div>

              <button className="btn ghost sm" style={{margin:'4px 0 18px'}} onClick={()=>setVerMas(v=>!v)}>{verMas?'▲ Ocultar detalle y números':'▼ Ver más detalle (plan por horas, indicadores, vista previa)'}</button>

              {verMas && (
                <>
                  <div className="section-label">Resumen numérico</div>
                  <div className="kpis">
                    {[
                      {label:'Críticas',value:stats.crit,color:'#dc2626',sub:'Atender ahora • hoy',trend:'↑'},
                      {label:'Altas',value:stats.alta,color:'#d97706',sub:'Durante el día',trend:'→'},
                      {label:'En proceso',value:stats.enProc,color:'var(--accent)',sub:'Activos',trend:''},
                      {label:'Esperando',value:stats.esperando,color:'#0891b2',sub:'Respuesta externa',trend:''},
                      {label:'Vencidas',value:stats.venc,color:'#991b1b',sub:'Requieren corrección',trend: stats.venc>0?'!':''},
                      {label:'Hoy vencen',value:stats.hoy,color:'#059669',sub:'Fecha límite hoy',trend:''},
                    ].map(k=>{
                      const irAProcesos=()=>{
                        setTab('procesos')
                        if(k.label==='Vencidas') setFiltro(f=>({...f, prior:'TODAS', estado:'VENCIDO'}))
                        else setFiltro(f=>({...f, estado:'TODOS', prior: k.label==='Críticas'?'CRITICA':k.label==='Altas'?'ALTA':'TODAS'}))
                      }
                      return (
                      <div key={k.label} className="kpi" role="button" tabIndex={0} aria-label={`Ver tareas: ${k.label}`} onClick={irAProcesos} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); irAProcesos() } }} style={{cursor:'pointer'}}>
                        <div className="kpi-head"><span style={{background:k.color}} className="kdot"/>{k.label} <span style={{marginLeft:'auto',fontSize:11}}>{k.trend}</span></div>
                        <div className="kpi-val">{loading?<span className="skeleton" aria-label="Cargando"/>:k.value}</div><div className="kpi-sub">{k.sub}</div>
                      </div>
                    )})}
                  </div>

                  <div className="card">
                    <div className="card-head"><h3>📅 Plan del día — de tus procesos reales</h3><small style={{color:'var(--muted)'}}>Ordenado por prioridad y fecha límite</small></div>
                    <div className="timeline-plan">
                      {!planDelDia.length && <div className="empty-state">Sin procesos activos todavía — aparecerán en cuanto sincronice su correo.</div>}
                      {planDelDia.map((p,i)=>(
                        <div key={p.id||p.h+i} className="plan-row" role={p.id?'button':undefined} tabIndex={p.id?0:undefined} style={p.id?{cursor:'pointer'}:undefined} onClick={p.id?()=>{const proc=procesos.find(x=>x.id===p.id); if(proc){setSel(proc); setTab('procesos')}}:undefined}>
                          <div className="plan-h">{p.h}</div><div className={`plan-dot ${p.pri==='CRITICA'?'crit':p.pri==='ALTA'?'alta':'mid'}`} />
                          <div style={{flex:1}}><div style={{fontWeight:600,fontSize:13}}>{p.t}</div><div style={{fontSize:12,color:'var(--muted)'}}>{p.d}</div></div>
                          <Pill color={p.pri==='CRITICA'?'red':p.pri==='ALTA'?'orange':'gray'}>{p.pri}</Pill>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="card">
                    <div className="card-head"><h3>✉️ Inbox ordenado — vista previa</h3><div style={{display:'flex',gap:8}}><button className="btn sm" onClick={()=>setTab('inbox')}>Abrir inbox completo →</button><button className="btn sm ghost" onClick={handleSync}>Actualizar</button></div></div>
                    <div className="table-wrap">
                      <table className="table">
                        <thead><tr><th>Correo (ordenado por prioridad)</th><th>Clasificación</th><th>Turno</th><th>Prioridad</th><th></th></tr></thead>
                        <tbody>
                          {inboxFiltrado.slice(0,6).map(({correo,a})=>(
                            <tr key={correo.id} style={{opacity: !a.relevancia.esRelevante?0.55:1, cursor:'pointer'}} tabIndex={0} onClick={()=>verCorreo(correo)} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); verCorreo(correo) } }} aria-label={`Ver correo: ${correo.asunto}`}>
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
            </>
          )}

          {tab==='inbox' && (
            <>
              <div className="card">
                <div className="card-head"><h3>Bandeja inteligente</h3><span className="mono" style={{fontSize:11,color:'var(--muted)'}}>{correos.length} correos reales • ordenados por prioridad, no por llegada</span></div>
                <div className="bandeja-tabs">
                  {[
                    {k:'TODOS',l:'Todos',n:analisis.length},
                    {k:'ACCION',l:'Requieren respuesta',n:analisis.filter(a=>a.a.accion.requiereAccion && a.a.turno.accionEsperadaDe==='COORDINADORA').length},
                    {k:'URGENTES',l:'Urgentes',n:analisis.filter(a=>a.a.prioridad.nivel==='CRITICA').length},
                    {k:'INCIDENCIAS',l:'Incidencias',n:analisis.filter(a=>a.a.incidencia.existe).length},
                    {k:'NO_RELEVANTE',l:'Archivados auto',n:analisis.filter(a=>!a.a.relevancia.esRelevante).length},
                    {k:'ARCHIVADOS',l:'Archivados',n:archivados.length},
                  ].map(t=>(
                    <button key={t.k} className={`bandeja-tab ${inboxFiltro.tab===t.k?'active':''}`} onClick={()=>setInboxFiltro(f=>({...f,tab:t.k}))}>{t.l} <span className="n">{t.n}</span></button>
                  ))}
                </div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
                  <input placeholder="Buscar asunto, remitente, cuerpo…" value={inboxFiltro.q} onChange={e=>setInboxFiltro(f=>({...f,q:e.target.value}))} style={{flex:1,minWidth:200,background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:8,padding:'8px 12px',fontSize:13}}/>
                  <button className="btn sm ghost" onClick={()=>setInboxFiltro({q:'',tab:'TODOS'})}>Limpiar</button>
                </div>
                {inboxFiltro.tab==='ARCHIVADOS' ? (
                  <div>
                    {!archivados.length && <div className="empty-state">Todavía no has archivado ningún correo.</div>}
                    {archivados.filter(a=>!inboxFiltro.q || (a.asunto+a.cuerpo+a.remitente).toLowerCase().includes(inboxFiltro.q.toLowerCase())).map(a=>(
                      <div key={a.id} className="mailrow">
                        <div className="mailrow-avatar" style={{background:colorDeAvatar(a.remitente)}}>{inicialesDe(nombreDeRemitente(a.remitente))}</div>
                        <div className="mailrow-body">
                          <div className="mailrow-top"><span className="mailrow-sender">{nombreDeRemitente(a.remitente)}</span></div>
                          <div className="mailrow-subject">{a.asunto}</div>
                          <div className="mailrow-preview">{a.archivadoMotivo} • {(a.archivadoFecha||'').slice(0,10)}</div>
                        </div>
                        <div className="mailrow-right"><button className="btn sm" onClick={()=>restaurarArchivado(a.id)}>↩ Restaurar</button></div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <div style={{display:'flex',gap:8,marginBottom:4,flexWrap:'wrap',alignItems:'center'}}>
                      <button className="btn sm" onClick={marcarLeidosSeleccionados} disabled={!seleccionados.size}>Marcar leídos{seleccionados.size?` (${seleccionados.size})`:''}</button>
                      <button className="btn sm" onClick={archivarSeleccionados} disabled={!seleccionados.size}>Archivar selección{seleccionados.size?` (${seleccionados.size})`:''}</button>
                      {seleccionados.size>0 && <button className="btn sm ghost" onClick={()=>setSeleccionados(new Set())}>Deseleccionar</button>}
                      <span className="mono" style={{fontSize:11,color:'var(--muted)',alignSelf:'center',marginLeft:8}}>💡 Marca la casilla para acciones masivas, o haz clic en el correo para leerlo completo.</span>
                    </div>
                    <div>
                      {inboxFiltrado.map(({correo,a})=>(
                        <div key={correo.id} style={{display:'flex',alignItems:'flex-start',gap:8}}>
                          <input type="checkbox" style={{marginTop:18}} checked={seleccionados.has(correo.id)} onChange={()=>toggleSeleccion(correo.id)}/>
                          <div style={{flex:1,minWidth:0, opacity: !a.relevancia.esRelevante?0.6:1}}>{renderMailRow(correo,a)}</div>
                        </div>
                      ))}
                      {!inboxFiltrado.length && <div className="empty-state">Sin correos en este filtro.</div>}
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {tab==='procesos' && (
            <>
              <p style={{fontSize:12,color:'var(--muted)',margin:'0 0 10px'}}>Estas son <b>sus propias tareas</b> — generadas a partir de su correo. Cada persona que use esta app ve únicamente las suyas, nunca las de otra cuenta.</p>
              <div className="filters">
                <input placeholder="Buscar tarea, área…" value={filtro.q} onChange={e=>setFiltro({...filtro,q:e.target.value})}/>
                <select value={filtro.prior} onChange={e=>setFiltro({...filtro,prior:e.target.value})}><option value="TODAS">Todas prioridades</option><option>CRITICA</option><option>ALTA</option><option>MEDIA</option><option>BAJA</option></select>
                <select value={filtro.estado} onChange={e=>setFiltro({...filtro,estado:e.target.value})}><option value="TODOS">Todos estados</option>{['NUEVO','EN_PROCESO','PENDIENTE','ESPERANDO','SEGUIMIENTO','VENCIDO','REPROGRAMADO','CERRADO','COMPLETADO'].map(s=><option key={s} value={s}>{formatEstado(s)}</option>)}</select>
                <select value={filtro.area} onChange={e=>setFiltro({...filtro,area:e.target.value})}><option value="TODAS">Todas áreas</option><option>Operaciones</option><option>Compras</option><option>Talento Humano</option><option>TI</option><option>Logística</option><option>Reclutamiento</option><option>Bienestar</option></select>
                <button className="btn sm ghost" onClick={()=>setFiltro({q:'',prior:'TODAS',estado:'TODOS',area:'TODAS'})}>Limpiar filtros</button>
                <button className="btn sm" onClick={()=>exportarCSV(filtrados)}>⬇️ Descargar en Excel</button>
                <button className="btn sm ghost" onClick={sincronizarSheetsReal} disabled={sheetsSyncing}>{sheetsSyncing?'Enviando…':'↗ Google Sheets'}</button>
                <span style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
                  <div className="view-toggle">
                    <button className={procesosVista==='kanban'?'active':''} onClick={()=>setProcesosVista('kanban')}><LayoutGrid size={13}/> Kanban</button>
                    <button className={procesosVista==='tabla'?'active':''} onClick={()=>setProcesosVista('tabla')}><ListChecks size={13}/> Tabla</button>
                  </div>
                  <button className="btn sm primary" onClick={()=>setTaskModal({mode:'create'})}><Plus size={13}/> Nueva tarea</button>
                </span>
              </div>

              {procesosVista==='kanban' ? (
                <div className="kanban-board">
                  {KANBAN_COLUMNAS.map(col=>{
                    const items = filtrados.filter(p=>estadoKanban(p.estado)===col.k)
                    return (
                      <div key={col.k} className={`kanban-col ${dragOverCol===col.k?'drag-over':''}`}
                        onDragOver={e=>{e.preventDefault(); setDragOverCol(col.k)}}
                        onDragLeave={()=>setDragOverCol(c=>c===col.k?null:c)}
                        onDrop={e=>{e.preventDefault(); setDragOverCol(null); moverKanban(e.dataTransfer.getData('text/plain'), col.k)}}
                      >
                        <div className="kanban-col-head"><span>{col.label}</span><span className="badge-count">{items.length}</span></div>
                        <div className="kanban-col-body">
                          {items.map(p=>{
                            const sub = subtareasProgreso(p)
                            const v = estadoVisualProceso(p)
                            return (
                              <div key={p.id} className="task-card" draggable
                                onDragStart={e=>{e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed='move'}}
                                onClick={()=>setTaskModal({mode:'view', proceso:p})}
                              >
                                <div className="task-card-top">
                                  <span className={`task-priority ${p.prioridad==='CRITICA'?'urgente':p.prioridad==='ALTA'?'alta':p.prioridad==='MEDIA'?'media':'baja'}`}>{p.prioridad==='CRITICA'?'Urgente':p.prioridad==='ALTA'?'Alta':p.prioridad==='MEDIA'?'Media':'Baja'}</span>
                                  <GripVertical size={13} style={{color:'var(--muted2)',cursor:'grab'}}/>
                                </div>
                                <div className="task-card-title">{p.titulo}</div>
                                <div className="task-card-desc">{p.descripcion?.slice(0,90)}</div>
                                {sub.total>0 && (
                                  <div className="task-progress">
                                    <div className="task-progress-bar"><div className="task-progress-fill" style={{width:`${Math.round(sub.hechas/sub.total*100)}%`}}/></div>
                                    <span>{sub.hechas}/{sub.total} subtareas</span>
                                  </div>
                                )}
                                <div className="task-card-foot">
                                  <span className="task-card-due"><Calendar size={11}/> {p.fechaLimite}</span>
                                  <EstadoBadge v={v}/>
                                </div>
                              </div>
                            )
                          })}
                          {!items.length && <div className="kanban-empty">Sin tareas aquí.</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
              <>
              <div className="table-wrap card" style={{padding:0}}>
                <table className="table">
                  <thead><tr><th>Tarea</th><th>Estado</th><th>Etapa</th><th>Vence</th><th>Retraso</th><th></th></tr></thead>
                  <tbody>
                    {filtrados.map(p=>(
                      <tr key={p.id} className={sel?.id===p.id?'sel':''} onClick={()=>setSel(p)} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); setSel(p) } }} tabIndex={0} aria-selected={sel?.id===p.id} style={{cursor:'pointer'}}>
                        <td><div style={{display:'flex',alignItems:'center',gap:6}}><PrioridadDot n={p.prioridad}/><div style={{fontWeight:700,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:300}}>{p.titulo}</div></div><div className="mono" style={{fontSize:11,color:'var(--muted)'}}>{p.id} • {p.area} • {p.categoria}</div>
                        {/* En celular la tabla se desplaza horizontalmente y la columna Estado
                            queda fuera de vista al abrir — se repite el badge aquí, debajo del
                            título, solo en mobile (ver .estado-mobile en App.css), para que se
                            entienda por color de un vistazo sin tener que deslizar. */}
                        <div className="estado-mobile"><EstadoBadge v={estadoVisualProceso(p)}/></div></td>
                        <td><EstadoBadge v={estadoVisualProceso(p)}/></td>
                        <td style={{fontSize:12}}>{explicarEtapa(p.etapa)}</td>
                        <td style={{fontSize:12}}>{p.fechaLimite}</td>
                        <td style={{fontSize:12,color:p.retraso>0?undefined:'var(--muted)'}} className={p.retraso>0?'text-danger':''}>{p.retraso?`+${p.retraso}`:'0'}</td>
                        <td style={{display:'flex',gap:6}}>
                          {!['COMPLETADO','CERRADO','CANCELADO'].includes(p.estado) && (
                            <button className="btn sm primary" title="Marcar esta tarea como lista" onClick={(e)=>{e.stopPropagation(); marcarProcesoListo(p.id)}}>✓ Listo</button>
                          )}
                          <button className="btn sm" onClick={(e)=>{e.stopPropagation(); setSel(p)}}>Detalle</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filtrados.length && <div className="empty-state">Sin resultados con esos filtros.</div>}
              </div>
              {sel && (
                <div className="detail-grid">
                  <div className="card">
                    <div className="card-head"><h3>{sel.titulo}</h3><EstadoBadge v={estadoVisualProceso(sel)}/></div>
                    <div className="mono" style={{fontSize:11,color:'var(--muted)',margin:'-10px 0 12px'}}>{sel.id}</div>
                    <p style={{fontSize:13,color:'var(--text2)',lineHeight:1.65,background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:8,padding:'12px 14px'}}>{sel.descripcion}</p>
                    <div className="kv">
                      <div><b>Responsable</b><span>{sel.responsable}</span></div>
                      <div><b>Prioridad</b><span><PrioridadDot n={sel.prioridad}/> {sel.prioridad}</span></div>
                      <div><b>Etapa</b><span>{explicarEtapa(sel.etapa)}</span></div>
                      <div><b>¿Quién sigue?</b><span className={sel.turnoActual==='COORDINADORA'?'turno-tu':'turno-externo'}>{sel.turnoActual==='COORDINADORA'?'Tú':'La otra persona'} {sel.esperanRespuesta?'• espera tu respuesta':''}</span></div>
                      <div><b>Vence</b><span>{sel.fechaLimite} • quedan {sel.tiempoRestante}d</span></div>
                      <div><b>Retraso</b><span>{sel.retraso>0?`+${sel.retraso}d sobre lo esperado`:'Sin retraso'}</span></div>
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
                        <button className="btn sm" onClick={()=>{
                          const correoVinculado = correos.find(c=> sel.correos?.includes(c.id)) || correos.find(c=> c.hiloId===sel.hiloId)
                          if(correoVinculado) abrirResponder(correoVinculado)
                          else showToast('No hay un correo vinculado a esta tarea')
                        }}>Sugerir borrador</button>
                      </div>
                    </div>
                    <div style={{marginTop:12,display:'flex',gap:8,flexWrap:'wrap'}}>
                      <button className="btn primary" onClick={()=>marcarCerrado(sel.id)}>Cerrar tarea</button>
                      <button className="btn" onClick={()=>{updateProceso(sel.id,{prioridad:'CRITICA'}); refresh(); showToast('Urgente → CRÍTICA')}}>Marcar urgente</button>
                      <button className="btn ghost" onClick={()=>prepararReenvio(sel)}>Preparar reenvío</button>
                    </div>
                  </div>
                  <div className="card">
                    <h4 style={{fontSize:13,fontWeight:800,marginBottom:10}}>📜 Historial</h4>
                    <div className="timeline">
                      {sel.historial?.map((h,i)=>(<div key={i} className="tl-row"><span className="tl-date">{h.fecha}</span><span className="tl-icon">{h.icon}</span><span style={{fontSize:12}}>{h.texto}</span></div>))}
                      {/* Antes decía siempre "Visto por Coordinadora", sin importar
                          quién de verdad tuviera la sesión abierta — igual que el
                          resto de datos quemados con ese rol fijo ya corregidos. */}
                      <div className="tl-row"><span className="tl-date">{new Date().toISOString().slice(0,10)}</span><span className="tl-icon">👁</span><span style={{fontSize:12}}>Visto por {session?.nombre || session?.email || 'usuario'}</span></div>
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
            </>
          )}

          {corrigiendo && (
            <div className="modal-overlay" onClick={()=>setCorrigiendo(null)}>
              <CorregirModal
                correo={corrigiendo}
                actual={iaPorHilo[corrigiendo.hiloId]}
                etiquetasPropias={entrenamiento.etiquetas}
                onCerrar={()=>setCorrigiendo(null)}
                onVip={()=>{ const e=correoDeRemitente(corrigiendo.remitente); if(e) agregarRegla('vip', e) }}
                onGuardar={async({estado, etiqueta, falta, nota})=>{
                  const c = corrigiendo
                  agregarEjemplo({ asunto:c.asunto.slice(0,150), de:correoDeRemitente(c.remitente), extracto:String(c.cuerpo||'').slice(0,300), estado, etiqueta, nota })
                  await corregirHilo(c.hiloId, { estado, etiqueta, falta })
                  audit('ia_correccion', { hilo:c.hiloId, estado, etiqueta })
                  setCorrigiendo(null)
                  showToast('🎓 Gracias — la secretaria lo tendrá en cuenta')
                }}
              />
            </div>
          )}

          {taskModal && (
            <div className="modal-overlay" onClick={()=>setTaskModal(null)}>
              {taskModal.mode==='view' ? (
                <TaskDetailModal
                  proceso={taskModal.proceso}
                  onClose={()=>setTaskModal(null)}
                  onToggleSub={(subId)=>{
                    const p = taskModal.proceso
                    const nt = (p.tareas||[]).map(t=> t.id===subId? {...t,done:!t.done}: t)
                    updateProceso(p.id,{tareas:nt}); refresh()
                    setTaskModal(m=> m?{...m, proceso:{...m.proceso, tareas:nt}}:m)
                  }}
                  onMarcarListo={()=>{ marcarProcesoListo(taskModal.proceso.id); setTaskModal(null) }}
                  onEliminar={taskModal.proceso.origen==='manual' ? ()=>{ eliminarTareaManual(taskModal.proceso.id); setTaskModal(null) } : null}
                  onVerDetalleCompleto={()=>{ setSel(taskModal.proceso); setProcesosVista('tabla'); setTaskModal(null) }}
                  calendarConectado={gcal.connected}
                  enviandoCalendar={gcalCreando===taskModal.proceso.id}
                  onEnviarCalendar={async(hora)=>{ const r = await enviarTareaACalendar(taskModal.proceso, {hora}); if(r) setTaskModal(m=> m?{...m, proceso:{...m.proceso, gcalEventId:r.id||'creado', gcalEnlace:r.enlace||null}}:m) }}
                />
              ) : (
                <TaskCreateModal onClose={()=>setTaskModal(null)} onCreate={(datos)=>{ crearTareaManual(datos); setTaskModal(null) }} />
              )}
            </div>
          )}

          {/* Antes había una pestaña "Análisis IA" separada que repetía la misma
              lista de correos con una versión más técnica (porcentajes de
              confianza, un renglón "INGESTA NORMALIZACIÓN THREAD..." con el
              nombre interno de cada paso del motor). Camilo pidió que la app
              fuera "más fácil, más útil" — esta pestaña no aportaba nada que no
              esté ya en Bandeja, y el mismo detalle en palabras simples
              (explicarTipo/explicarTurno) ya se muestra al abrir cualquier
              correo. Se elimina para no duplicar y no meter jerga técnica. */}

          {tab==='seguimientos' && (
            <div className="card">
              <div className="card-head"><h3>🔁 Seguimientos</h3><span className="mono" style={{fontSize:11,color:'var(--muted)'}}>{seguimientosFlat.length} en total</span></div>
              <div style={{fontSize:11,color:'var(--muted)',margin:'-6px 0 10px'}}>Todo lo que quedó por revisar más adelante — de tus tareas y de lo que le pediste al asistente que te recordara.</div>
              {!seguimientosFlat.length && !recordatoriosGenerales.length ? (
                <div style={{padding:'24px 8px',color:'var(--muted)',fontSize:13}}>No tienes seguimientos programados todavía. Puedes pedirle al asistente "recuérdame..." desde el panel de chat.</div>
              ) : (
                <div className="table-wrap"><table className="table"><thead><tr><th>Tarea / nota</th><th>Contacto</th><th>Fecha</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
                  {seguimientosFlat.map(s=>(
                    <tr key={s.segId}>
                      <td style={{fontSize:12,maxWidth:260}}>{s.titulo}{s.nota?<div className="mono" style={{fontSize:10.5,color:'var(--muted)'}}>{s.nota.slice(0,60)}</div>:null}</td>
                      <td style={{fontSize:12}}>{s.contacto||'—'}</td>
                      <td style={{fontSize:12}}>{s.fecha}</td>
                      <td><Pill color={s.estado==='VENCIDO'?'red':s.estado==='COMPLETADO'?'green':s.estado==='CANCELADO'?'gray':s.estado==='PROXIMO'?'yellow':'blue'}>{s.estado}</Pill></td>
                      <td style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        {s.estado!=='COMPLETADO' && s.estado!=='CANCELADO' && <>
                          <button className="btn sm" onClick={()=>{actualizarSeguimiento(s.procesoId,s.idx,{completado:true}); showToast('✅ Seguimiento completado')}}>Completar</button>
                          <button className="btn sm ghost" onClick={()=>posponerSeguimiento(s.procesoId,s.idx,1)}>+1 día</button>
                          <button className="btn sm ghost" onClick={()=>{actualizarSeguimiento(s.procesoId,s.idx,{cancelado:true}); showToast('Seguimiento cancelado')}}>Cancelar</button>
                        </>}
                        <button className="btn sm ghost" onClick={()=>{const p=procesos.find(x=>x.id===s.procesoId); if(p){setSel(p); setTab('procesos')}}}>Ver tarea</button>
                      </td>
                    </tr>
                  ))}
                  {recordatoriosGenerales.map(r=>(
                    <tr key={r.id}>
                      <td style={{fontSize:12,maxWidth:260}}>{r.texto}</td>
                      <td style={{fontSize:12}}>—</td>
                      <td style={{fontSize:12}}>{r.fecha}</td>
                      <td><Pill color="pink">RECORDATORIO</Pill></td>
                      <td><button className="btn sm ghost" onClick={()=>setRecordatoriosGenerales(rs=>rs.filter(x=>x.id!==r.id))}>Quitar</button></td>
                    </tr>
                  ))}
                </tbody></table></div>
              )}
            </div>
          )}

          {tab==='estadisticas' && (
            <>
              <p style={{fontSize:12,color:'var(--muted)',margin:'0 0 14px'}}>Todo lo de aquí abajo se calcula de tus correos y tareas reales de esta cuenta — nada de cifras de ejemplo.</p>
              <div className="stats-grid-2">
                <div className="card chart-card">
                  <div className="card-head"><h3><BarChart3 size={15}/> Correos recibidos — últimos 7 días</h3></div>
                  <TrendBars data={correosPorDia}/>
                </div>
                <div className="card chart-card">
                  <div className="card-head"><h3><LayoutGrid size={15}/> Tareas por área</h3></div>
                  <HBarList data={metricas.areaData} colors={['#4B7BEC','#2ECC71','#FF9F43','#FF4B4B','#8B5CF6','#FFC107']}/>
                </div>
              </div>
              <div className="stats-grid-3" style={{marginTop:14}}>
                <div className="card" style={{display:'flex',justifyContent:'center',padding:'22px 18px'}}>
                  <Donut pct={metricas.pctCerrados} color="var(--green)" label="Tareas cerradas" sub={`${metricas.cerrados} de ${metricas.total} tareas totales`}/>
                </div>
                <div className="card" style={{display:'flex',justifyContent:'center',padding:'22px 18px'}}>
                  <Donut pct={metricas.pctATiempo} color="var(--accent)" label="A tiempo" sub="Tareas que no han vencido su fecha límite"/>
                </div>
                <div className="card">
                  <div className="card-head" style={{marginBottom:10}}><h3 style={{fontSize:13}}>Tareas por prioridad</h3></div>
                  <HBarList data={prioridadesData} colors={['#FF4B4B','#FF9F43','#FFC107','#4B7BEC']}/>
                </div>
              </div>
            </>
          )}

          {tab==='contactos' && (
            <>
              <p style={{fontSize:12,color:'var(--muted)',margin:'0 0 14px'}}>Se arman solos con quién te ha escrito de verdad — nadie se agrega a mano. <span className="mono">{contactosDerivados.length} persona(s)</span></p>
              {!contactosDerivados.length ? (
                <div className="empty-state">Todavía no hay correos suficientes para armar contactos.</div>
              ) : (
                <div className="contacts-grid">
                  {contactosDerivados.map(c=>(
                    <div key={c.email} className="contact-card" role="button" tabIndex={0} onClick={()=>{setTab('inbox'); setInboxFiltro({q:c.nombre,tab:'TODOS'})}}>
                      <div className="contact-avatar" style={{background:colorDeAvatar(c.email)}}>{inicialesDe(c.nombre)}</div>
                      <div className="contact-name">{c.nombre}</div>
                      <div className="contact-email">{c.email}</div>
                      <div className="contact-empresa"><Building2 size={11}/> {c.empresa}</div>
                      <div className="contact-stats-row">
                        <div className="contact-stat"><b>{c.conversaciones}</b><span>conversaciones</span></div>
                        <div className="contact-stat"><b>{c.ultima?.slice(0,10)||'—'}</b><span>última vez</span></div>
                      </div>
                      {(c.pendientes>0 || c.esperando>0) && (
                        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
                          {c.pendientes>0 && <Pill color="orange">{c.pendientes} pendiente{c.pendientes>1?'s':''} tuyo</Pill>}
                          {c.esperando>0 && <Pill color="blue">{c.esperando} esperando</Pill>}
                        </div>
                      )}
                      {!!c.temas.length && <div className="contact-temas">{c.temas.map((t,i)=><span key={i} className="contact-tema">{t}</span>)}</div>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab==='calendario' && (()=>{
            const eventos = [
              ...procesos.filter(p=>!['COMPLETADO','CERRADO','CANCELADO'].includes(p.estado) && p.fechaLimite).map(p=>({fecha:p.fechaLimite, tipo:'Vence', titulo:p.titulo, id:p.id, color: p.prioridad==='CRITICA'?'red':p.prioridad==='ALTA'?'orange':'blue'})),
              ...seguimientosFlat.filter(s=>!['COMPLETADO','CANCELADO'].includes(s.estado) && s.fecha).map(s=>({fecha:s.fecha, tipo:'Seguimiento', titulo:s.titulo, id:s.procesoId, color:'green'})),
              ...gcalEventos.map(e=>({fecha:e.fecha, tipo:`Google Calendar${e.hora?` · ${e.hora}`:' · todo el día'}${e.lugar?` · ${e.lugar}`:''}`, titulo:e.titulo, id:null, enlace:e.enlace, color:'gcal', hora:e.hora})),
            ]
            const porFecha={}
            eventos.forEach(e=>{ (porFecha[e.fecha]=porFecha[e.fecha]||[]).push(e) })

            const {y,m} = calMes
            const primerDia = new Date(y,m,1)
            const offset = (primerDia.getDay()+6)%7 // lunes=0
            const diasEnMes = new Date(y,m+1,0).getDate()
            const diasMesAnterior = new Date(y,m,0).getDate()
            const celdas=[]
            for(let i=offset-1;i>=0;i--) celdas.push({dia:diasMesAnterior-i, fuera:true, iso:null})
            for(let d=1; d<=diasEnMes; d++) celdas.push({dia:d, fuera:false, iso:fechaLocalISO(new Date(y,m,d))})
            while(celdas.length%7!==0 || celdas.length<35) celdas.push({dia:celdas.length - (offset+diasEnMes) + 1, fuera:true, iso:null})

            const nombreMes = new Date(y,m,1).toLocaleDateString('es-CO',{month:'long',year:'numeric'})
            const eventosDelDia = porFecha[calDiaSel] || []

            return (
              <div className="card" style={{padding:0,overflow:'hidden'}}>
                <div className="calendar-toolbar">
                  <h3 style={{margin:0}}><Calendar size={16}/> Calendario</h3>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <button className="btn sm ghost" onClick={()=>setCalMes(({y,m})=> m===0?{y:y-1,m:11}:{y,m:m-1})}><ChevronLeft size={14}/></button>
                    <b style={{fontSize:13,textTransform:'capitalize',minWidth:150,textAlign:'center'}}>{nombreMes}</b>
                    <button className="btn sm ghost" onClick={()=>setCalMes(({y,m})=> m===11?{y:y+1,m:0}:{y,m:m+1})}><ChevronRight size={14}/></button>
                    <button className="btn sm" onClick={()=>{const d=new Date(); setCalMes({y:d.getFullYear(),m:d.getMonth()}); setCalDiaSel(fechaLocalISO())}}>Hoy</button>
                    {gcal.connected
                      ? <button className="btn sm ghost" disabled={gcalCargando} onClick={recargarCalendar}><RefreshCw size={13}/> {gcalCargando?'Cargando…':'Actualizar'}</button>
                      : gcal.configured && gcal.gmail && <button className="btn sm primary" onClick={conectarCalendar}><Calendar size={13}/> Conectar Google Calendar</button>}
                  </div>
                </div>
                <div style={{fontSize:11,color:'var(--muted)',padding:'0 18px 12px'}}>
                  {gcal.connected
                    ? <>Vencimientos y seguimientos de tus tareas + <span className="calendar-event gcal" style={{display:'inline',padding:'1px 5px'}}>tus eventos de Google Calendar</span>.</>
                    : !session.real ? 'Vencimientos de tus tareas y seguimientos — en modo demostración no se conecta Google Calendar.'
                    : !gcal.gmail ? 'Vencimientos de tus tareas y seguimientos — conecta primero tu Gmail real para poder conectar Google Calendar.'
                    : !gcal.configured ? 'Vencimientos de tus tareas y seguimientos — Google Calendar aún no está configurado en el servidor.'
                    : 'Vencimientos de tus tareas y seguimientos — conecta Google Calendar para ver también tus reuniones.'}
                  {gcalError && <span style={{color:'var(--red)',display:'block',marginTop:4}}>⚠️ {gcalError}</span>}
                </div>
                <div className="calendar-grid calendar-weekdays">
                  {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d=><div key={d} className="calendar-weekday">{d}</div>)}
                </div>
                <div className="calendar-grid">
                  {celdas.map((c,i)=>{
                    const evs = c.iso ? (porFecha[c.iso]||[]) : []
                    const esHoy = c.iso===fechaLocalISO()
                    const esSel = c.iso===calDiaSel
                    return (
                      <div key={i} className={`calendar-cell ${c.fuera?'fuera':''} ${esHoy?'hoy':''} ${esSel?'sel':''}`} onClick={()=>c.iso && setCalDiaSel(c.iso)}>
                        <span className="calendar-cell-num">{c.dia}</span>
                        <div className="calendar-cell-events">
                          {evs.slice(0,3).map((e,j)=>(<div key={j} className={`calendar-event ${e.color}`}>{e.titulo}</div>))}
                          {evs.length>3 && <div className="calendar-event-more">+{evs.length-3} más</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div style={{padding:'16px 18px',borderTop:'1px solid var(--border)'}}>
                  <div style={{fontWeight:800,fontSize:12.5,marginBottom:10}}>{calDiaSel===fechaLocalISO()?'Hoy':calDiaSel} <span style={{color:'var(--muted)',fontWeight:600}}>— {eventosDelDia.length} evento{eventosDelDia.length===1?'':'s'}</span></div>
                  {!eventosDelDia.length && <div style={{fontSize:12,color:'var(--muted)'}}>Sin eventos este día.</div>}
                  {eventosDelDia.map((e,i)=>{
                    const p = e.id ? procesos.find(x=>x.id===e.id) : null
                    return (
                      <div key={i} className="plan-row" role="button" tabIndex={0} style={{cursor:'pointer'}} onClick={()=>{ if(e.enlace){ window.open(e.enlace,'_blank','noopener') } else if(p){setSel(p); setTab('procesos')} }}>
                        <span className={`dot ${e.color}`}/>
                        <div style={{flex:1}}><b>{e.titulo}</b><small style={{display:'block',color:'var(--muted)'}}>{e.tipo}</small></div>
                        {e.enlace && <ExternalLink size={13} style={{color:'var(--muted)'}}/>}
                        {p && e.tipo==='Vence' && gcal.connected && (
                          p.gcalEventId
                            ? <Pill color="green">En Calendar</Pill>
                            : <button className="btn sm ghost" disabled={gcalCreando===p.id} onClick={ev=>{ev.stopPropagation(); enviarTareaACalendar(p)}}><CalendarPlus size={13}/> {gcalCreando===p.id?'Enviando…':'A Google Calendar'}</button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}


          {tab==='configuracion' && (
            <ConfiguracionView
              session={session} theme={theme} setTheme={setTheme}
              configuracion={configuracion} setConfiguracion={setConfiguracion} confianzaProm={confianzaProm}
              ia={ia} probarIA={async()=>{ showToast('Probando conexión con Gemini…'); try{ const d=await diagnosticoIA(); showToast(d.ok?`✅ Gemini responde (${d.modelo})`:`⚠️ ${d.note}${d.detalle?` — ${d.detalle}`:''}`) }catch(e){ showToast('⚠️ '+e.message) } }}
              memoria={memoria} recordar={recordar} olvidar={olvidar}
              entrenamiento={entrenamiento} actualizarEntrenamiento={actualizarEntrenamiento} agregarRegla={agregarRegla} quitarRegla={quitarRegla} entrenamientoGuardado={entrenamientoGuardado}
              clasificando={clasificando} reanalizarTodo={reanalizarTodo}
              onProbar={()=>{ setTab('dashboard'); enviarPreguntaChat('Explícame en pocas líneas qué entendiste de mi entrenamiento: quién soy, qué es importante para mí, mis reglas y mis etiquetas. ¿Te falta algo por saber para ayudarme mejor?') }}
              gmailConectado={gmailConectado} handleRealConnect={handleRealConnect}
              gcal={gcal} conectarCalendar={conectarCalendar} desconectarCalendar={desconectarCalendar}
              exportarCSV={exportarCSV} procesos={procesos} showToast={showToast}
            />
          )}
        </main>

        {/* Columna del Asistente personal — tal cual el mockup: un panel fijo
            a la derecha (no un widget flotante) con chat real + acciones
            rápidas + agenda del día + seguimientos próximos + una tarjeta
            para pedirle que recuerde algo. Reemplaza a la antigua Mascota
            flotante y al chat flotante — eran dos asistentes distintos
            haciendo básicamente lo mismo; el Señor pidió eliminar duplicados,
            así que ahora hay UNO solo, integrado en Inicio. Solo se muestra
            en Inicio, igual que en el mockup. */}
        {tab==='dashboard' && (
          <aside className="assistant-col">
            <div className="asis-card asis-verde">
              <div className="asis-head">
                <div className="asis-avatar"><Bot size={20}/></div>
                <div style={{flex:1}}><b>Asistente personal {ia.configured && <span className="asis-ia-badge"><Sparkles size={9}/> IA</span>}</b><small>{clasificando ? 'Revisando tu correo…' : ia.configured ? 'Tu secretaria — recuerda y hace seguimiento' : 'Siempre pendiente de lo importante'}</small></div>
                {chatMessages.length>1 && <button className="asis-clear" title="Borrar conversación" onClick={borrarConversacion}><Trash2 size={13}/></button>}
              </div>
              <div className="chat-scroll" ref={el=>{ if(el) el.scrollTop = el.scrollHeight }}>
                {chatMessages.map((m,i)=>(<ChatMensaje key={i} m={m} onAccion={(j,ok)=>resolverAccion(i,j,ok)}/>))}
                {chatEnviando && <div className="chat-msg chat-asistente chat-pensando"><span/><span/><span/></div>}
              </div>
              <div className="asis-quick-grid">
                <button className="asis-quick-btn" onClick={()=>enviarPreguntaChat(ia.configured ? '¿Qué tengo pendiente hoy? Dime qué me toca a mí, qué estoy esperando de otros y qué le falta a cada cosa para cerrarse.' : '¿qué tengo pendiente?')}><ListChecks size={14}/> Ver resumen</button>
                <button className="asis-quick-btn" onClick={()=>{setTab('inbox'); setInboxFiltro(f=>({...f,tab:'ACCION'}))}}><CheckSquare size={14}/> Revisar pendientes</button>
                {ia.configured
                  ? <button className="asis-quick-btn" disabled={clasificando} onClick={clasificarAhora}>{clasificando?<Loader2 size={14} className="spin"/>:<ScanSearch size={14}/>} {clasificando?'Revisando…':'Revisar mi correo'}</button>
                  : <button className="asis-quick-btn" onClick={()=>setTab('seguimientos')}><RefreshCw size={14}/> Crear seguimiento</button>}
                <button className="asis-quick-btn" onClick={()=>setTab('calendario')}><CalendarPlus size={14}/> Programar en calendario</button>
              </div>
              <form className="asis-input-row" onSubmit={e=>{e.preventDefault(); enviarPreguntaChat()}}>
                <input className="input" value={chatInput} onChange={e=>setChatInput(e.target.value)} placeholder={ia.configured ? 'Pídeme lo que sea…' : 'Pregúntame algo…'}/>
                <button className="btn primary sm" type="submit" disabled={!chatInput.trim()||chatEnviando}><Send size={14}/></button>
              </form>
            </div>

            {(()=>{
              const hoyIso = fechaLocalISO()
              const agendaHoy = [
                ...procesos.filter(p=>!['COMPLETADO','CERRADO','CANCELADO'].includes(p.estado) && p.fechaLimite===hoyIso).map(p=>({titulo:`Vence: ${p.titulo}`, color: p.prioridad==='CRITICA'?'#DC2626':p.prioridad==='ALTA'?'#D97706':'#059669'})),
                ...seguimientosFlat.filter(s=>s.fecha===hoyIso && !['COMPLETADO','CANCELADO'].includes(s.estado)).map(s=>({titulo:`Seguimiento: ${s.titulo}`, color:'#2563EB'})),
              ]
              return (
                <div className="asis-card">
                  <div className="card-head" style={{marginBottom:10,paddingBottom:0,border:0}}><h3 style={{fontSize:13,display:'flex',alignItems:'center',gap:7}}><Calendar size={14}/> Tu agenda</h3><span className="card-link" onClick={()=>setTab('calendario')}>Ver calendario →</span></div>
                  <div style={{fontSize:11.5,fontWeight:700,color:'var(--muted)',marginBottom:6}}>Hoy</div>
                  {!agendaHoy.length && <div style={{fontSize:12,color:'var(--muted)'}}>Nada pendiente para hoy — buen momento para adelantar seguimientos.</div>}
                  {agendaHoy.slice(0,6).map((e,i)=>(
                    <div key={i} className="agenda-row"><span className="agenda-dot" style={{background:e.color}}/><span>{e.titulo}</span></div>
                  ))}
                </div>
              )
            })()}

            <div className="asis-card weekly-summary">
              <div className="card-head" style={{marginBottom:10,paddingBottom:0,border:0}}><h3 style={{fontSize:13,display:'flex',alignItems:'center',gap:7}}><BarChart3 size={14}/> Resumen de la semana</h3></div>
              <div className="stat-box-row">
                <div className="stat-box">
                  <div className="stat-box-value">{resumenSemana.correosSemana}</div>
                  <div className="stat-box-label">Correos recibidos</div>
                  {resumenSemana.pct!==null && <div className={`stat-box-trend ${resumenSemana.pct>=0?'up':'down'}`}>{resumenSemana.pct>=0?'↑':'↓'} {Math.abs(resumenSemana.pct)}% vs. semana pasada</div>}
                </div>
                <div className="stat-box">
                  <div className="stat-box-value">{resumenSemana.cerradosSemana}</div>
                  <div className="stat-box-label">Tareas cerradas</div>
                  <div className="stat-box-trend">{resumenSemana.cerradosSemanaAnt} la semana pasada</div>
                </div>
              </div>
            </div>

            <div className="asis-card ai-suggestion-card">
              <div className="card-head" style={{marginBottom:8,paddingBottom:0,border:0}}><h3 style={{fontSize:13,display:'flex',alignItems:'center',gap:7}}><Bot size={14}/> Sugerencia de tu IA</h3></div>
              <p style={{fontSize:12.5,color:'var(--text2)',lineHeight:1.5,marginBottom:10}}>{sugerenciaIA.texto}</p>
              <button className="btn sm" onClick={sugerenciaIA.irA}>Revisar →</button>
            </div>

            <div className="asis-card">
              <div className="card-head" style={{marginBottom:6,paddingBottom:0,border:0}}><h3 style={{fontSize:13,display:'flex',alignItems:'center',gap:7}}><RefreshCw size={14}/> Seguimientos próximos</h3><span className="card-link" onClick={()=>setTab('seguimientos')}>Ver todos →</span></div>
              {seguimientosFlat.filter(s=>['PENDIENTE','PROXIMO'].includes(s.estado)).slice(0,4).map(s=>(
                <div key={s.segId} className="seg-row">
                  <span style={{display:'flex',alignItems:'center'}}><span className="seg-row-dot" style={{background:s.prioridad==='CRITICA'?'#DC2626':s.prioridad==='ALTA'?'#D97706':'#2563EB'}}/>{s.titulo}</span>
                  <span style={{display:'flex',alignItems:'center',gap:6}}><span className="mono" style={{fontSize:10.5,color:'var(--muted)'}}>Vence en {Math.max(0,diasEntre(s.fecha))}d</span><Pill color={s.prioridad==='CRITICA'?'red':s.prioridad==='ALTA'?'orange':'blue'}>{s.prioridad==='CRITICA'?'Alta':s.prioridad==='ALTA'?'Alta':'Media'}</Pill></span>
                </div>
              ))}
              {!seguimientosFlat.filter(s=>['PENDIENTE','PROXIMO'].includes(s.estado)).length && <div style={{fontSize:12,color:'var(--muted)'}}>No tienes seguimientos próximos.</div>}
            </div>

            <div className="asis-cta">
              <b>¿Necesitas que recuerde algo?</b>
              <p>Solo dile a tu asistente: "Recuérdame esto mañana a las 9"</p>
              <button onClick={()=>{const el=document.querySelector('.asis-input-row input'); el?.focus()}}>Probar ahora</button>
            </div>
          </aside>
        )}
      </div>
      {reply && (
        <div className="reply-overlay" onClick={()=>!sending && setReply(null)}>
          <div className="reply-modal" onClick={e=>e.stopPropagation()}>
            <div className="reply-head">
              <div>
                <h3>{reply.modo==='reenviar' ? '↪ Reenviar — requiere confirmación' : '↩ Responder — con contexto IA'}</h3>
                <div className="mono" style={{fontSize:11,color:'var(--muted)',marginTop:2}}>Hilo {reply.correo.hiloId?.slice(0,8)} • {reply.analisis.prioridad.nivel} {reply.analisis.prioridad.score}/100 • conf {Math.round(reply.analisis.confianza*100)}% • {reply.sugerencia.tono}</div>
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
              <div className="reply-field">
                <label>Para{reply.modo==='reenviar' && ' — escriba el destinatario'}</label>
                {reply.modo==='reenviar' ? (
                  <input value={reply.correo.remitente} onChange={e=>{ const v=e.target.value; setConfirmSend(false); setSendError(null); setReply(r=>({...r, correo:{...r.correo, remitente:v}})) }} placeholder="nombre@empresa.com" />
                ) : (
                  <input value={reply.correo.remitente} readOnly style={{background:'var(--bg2)',color:'var(--muted)'}} />
                )}
              </div>
              <div className="reply-field"><label>Asunto</label><input value={reply.asunto} onChange={e=>{setConfirmSend(false); setSendError(null); setReply(r=>({...r, asunto:e.target.value}))}} /></div>
              <div className="reply-field"><label>Mensaje sugerido por IA — editable</label><textarea value={reply.cuerpo} onChange={e=>{setConfirmSend(false); setSendError(null); setReply(r=>({...r, cuerpo:e.target.value}))}} rows={12} /></div>
              <div style={{fontSize:11,color:'var(--muted)',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:8,padding:10}}>
                💡 <b>Sugerencia IA:</b> El tono es {reply.sugerencia.tono}. La IA ya consideró el hilo completo ({reply.correo.hiloId?.slice(0,8)}) y el checklist. Puedes editar antes de enviar. <b>Action Guard:</b> requiere confirmación antes de enviar a externo.
              </div>
              {sendError && (
                <div style={{fontSize:12,background:'var(--red-bg)',border:'1px solid var(--red)',color:'#991b1b',borderRadius:8,padding:10,display:'flex',gap:8,alignItems:'flex-start'}}>
                  <span style={{fontWeight:700,whiteSpace:'nowrap'}}>⚠️ No se envió:</span>
                  <span className="mono">{sendError}</span>
                </div>
              )}
            </div>
            <div className="reply-actions">
              <span className="mono" style={{fontSize:11,color:'var(--muted)'}}>{gmailConectado ? `Gmail REAL • vía ${session.email}` : 'Modo demostración — envío simulado'}{reply.modo==='reenviar' ? ` • reenvío a ${reply.correo.remitente||'—'}` : ` • a ${reply.correo.remitente.split('<')[0].trim()}`}</span>
              <div style={{display:'flex',gap:8}}>
                <button className="btn ghost" onClick={()=>{setReply(null); setConfirmSend(false); setSendError(null)}} disabled={sending}>Cancelar</button>
                <button
                  className={confirmSend ? 'btn btn-confirm' : 'btn primary'}
                  onClick={enviarRespuesta}
                  disabled={sending || !reply.cuerpo.trim() || (reply.modo==='reenviar' && !RE_EMAIL.test(reply.correo.remitente.trim()))}
                >
                  {sending?'Enviando…':(confirmSend?'✓ Confirmar y enviar':(reply.modo==='reenviar'?'Reenviar →':'Enviar respuesta →'))}
                </button>
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
                  <EstadoBadge v={estadoVisualCorreo(viewCorreo.a)}/>
                  {viewCorreo.a.incidencia.existe && <Pill color="red">⚠️ Incidencia</Pill>}
                  {viewCorreo.proc && <Pill color="blue">🗂️ Tarea {viewCorreo.proc.id}</Pill>}
                </div>
              </div>
            </div>
            <div className="reply-actions">
              <span className="mono" style={{fontSize:11,color:'var(--muted)'}}>{viewCorreo.correo.etiquetas?.includes('UNREAD')?'● No leído':'Leído'}</span>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {viewCorreo.proc && <button className="btn ghost" onClick={()=>{ setSel(viewCorreo.proc); setTab('procesos'); setViewCorreo(null) }}>Ver tarea</button>}
                <button className="btn" onClick={()=>{ marcarLeido(viewCorreo.correo.id); setViewCorreo(null) }}>Marcar leído</button>
                <button className="btn ghost" onClick={()=>{ archivarCorreo(viewCorreo.correo.id); setViewCorreo(null) }}>Archivar</button>
                <button className="btn primary" onClick={()=>{ const c=viewCorreo.correo; setViewCorreo(null); abrirResponder(c) }}>Responder con IA →</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer style={{textAlign:'center',padding:'16px 0 24px',fontSize:11,color:'var(--muted)'}} className="mono">Mi Asistente • Más enfoque, menos correos. • {new Date().toLocaleDateString()}</footer>
    </div>
  )
}


