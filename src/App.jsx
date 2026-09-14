import { useState, useEffect, useMemo } from 'react'
import { getProcesos, saveProcesos, setModoAlmacenamiento, updateProceso, audit, getAuditLog, setUsuarioActual } from './data/mockFirebase.js'
import { fetchProcesosFirestore, subscribeProcesosFirestore, saveProcesoFirestore, limpiarDatosDeEjemploFirestore } from './data/mockFirebase.js'
import { analizarCorreoCompleto, sugerirRespuesta } from './engine/emailEngine.js'
import { fetchRealGmail, archivarGmailReal, marcarLeidoGmailReal } from './services/gmailService.js'
import { generarCorreosDemo } from './data/demoGmail.js'
import { generarProcesosDesdeCorreos } from './services/processGenerator.js'
import { responderHilo } from './services/gmailSendService.js'
import Mascota from './components/Mascota.jsx'
import LoginScreen from './components/LoginScreen.jsx'
import { Donut, HBarList } from './components/Charts.jsx'
import { getDemoUser, setDemoUser, clearDemoUser, fetchRealSession, logoutReal, iniciales, signInWithGoogle, logoutFirebase, onFirebaseAuthChange } from './services/authService.js'
import './App.css'

function Pill({children, color}){ return <span className={`pill pill-${color}`}>{children}</span> }
function PrioridadDot({n}){ const m={CRITICA:'crit',ALTA:'alta',MEDIA:'media',BAJA:'baja',INFORMATIVA:'info'}; return <span className={`dot dot-${m[n]||'baja'}`} /> }
function Toast({msg,onClose}){ if(!msg) return null; return <div className="toast"><span>{msg}</span><button onClick={onClose}>✕</button></div> }

// Una de las 4 categorías del Dashboard simplificado. Muestra pocos ítems,
// un solo botón grande y bien visible por ítem, y esconde el resto detrás
// de un contador — el objetivo es que se entienda de un vistazo sin tener
// que leer puntajes ni porcentajes.
const MAX_BUCKET_ITEMS = 6
function BucketSimple({ color, emoji, titulo, items, vacio, onResponder, onVer, accionLabel='Responder' }){
  const visibles = items.slice(0, MAX_BUCKET_ITEMS)
  const restantes = items.length - visibles.length
  return (
    <div className={`bucket-card bucket-${color}`}>
      <div className="bucket-head"><span className="bucket-emoji">{emoji}</span><b>{titulo}</b><span className="bucket-count">{items.length}</span></div>
      {!items.length && <div className="bucket-vacio">{vacio}</div>}
      <div className="bucket-list">
        {visibles.map(({correo,a})=>(
          <div key={correo.id} className="bucket-item" role="button" tabIndex={0} onClick={()=>onVer(correo)} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); onVer(correo) } }}>
            <div style={{flex:1,minWidth:0}}>
              <div className="bucket-item-titulo">{correo.asunto}</div>
              <div className="bucket-item-motivo">{explicarTipo(a.clasificacion.tipo)}</div>
              <div className="bucket-item-meta">De: {correo.remitente.split('<')[0].trim()}{a.fechas.fechaCalculada?` • vence ${a.fechas.fechaCalculada}`:''}</div>
            </div>
            {onResponder ? (
              <button className="btn primary" onClick={e=>{e.stopPropagation(); onResponder(correo)}}>{accionLabel} →</button>
            ) : (
              <button className="btn" onClick={e=>{e.stopPropagation(); onVer(correo)}}>{accionLabel} →</button>
            )}
          </div>
        ))}
      </div>
      {restantes>0 && <div className="bucket-mas">+{restantes} más — ábralo desde Inbox Ordenado para verlos todos.</div>}
    </div>
  )
}

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
// Fecha LOCAL en formato YYYY-MM-DD — new Date().toISOString() usa UTC, así
// que cerca de medianoche en Colombia (UTC-5) marcaba "hoy vencen" con el día
// equivocado. fechaLimite siempre se guarda como fecha local (YYYY-MM-DD).
const RE_EMAIL = /^\S+@\S+\.\S+$/
function fechaLocalISO(d=new Date()){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0')
  return `${y}-${m}-${day}`
}
// OJO — dos cosas distintas que es fácil confundir:
//  • `p.retraso` (getter sobre tiempoObjetivo/tiempoTranscurrido) mide el
//    RITMO interno de SLA: "lleva más días abierto de los que se esperaban",
//    aunque su fecha límite de calendario todavía no haya llegado.
//  • "Vencido" en el sentido que entiende cualquier persona es la fecha
//    límite de calendario (fechaLimite) ya pasada — eso es lo que debe
//    decidir la insignia ESTADO y el KPI de "vencidas", o alguien ve
//    "VENCIDO" en un proceso cuya fecha límite es dentro de 3 días y (con
//    razón) piensa que la app está mal. Antes esta función usaba `retraso`
//    para decidir "VENCIDO" — quedaba técnicamente relacionado, pero
//    calendario-incorrecto. Ahora se separan: `retraso` sigue visible tal
//    cual en su propia columna/ficha SLA, pero el estado que se le muestra a
//    la persona se basa en la fecha real.
function fechaVencidaCalendario(p){
  return !!p.fechaLimite && p.fechaLimite < fechaLocalISO() && !['CERRADO','COMPLETADO','CANCELADO'].includes(p.estado)
}
function estadoEfectivo(p){
  return fechaVencidaCalendario(p) ? 'VENCIDO' : p.estado
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
  // Cuando login=cuenta_incorrecta (ver api/auth/composio/callback.js), estos
  // dos datos vienen en la URL para poder explicarle a la persona exactamente
  // qué pasó: qué correo pidió conectar vs. cuál realmente completó Google.
  const [loginEsperado]=useState(()=> new URLSearchParams(window.location.search).get('esperado'))
  const [loginConectado]=useState(()=> new URLSearchParams(window.location.search).get('conectado'))
  const [composioConfigured,setComposioConfigured]=useState(false)
  const [menuOpen,setMenuOpen]=useState(false)
  // Antes se asumía que session.real === "tiene Gmail conectado". Desde que
  // Firebase permite iniciar sesión con cualquier Google SIN conectar Gmail
  // todavía, eso ya no es cierto: session.real (o session.firebase) solo
  // dice "no es demo". gmailConectado dice si de verdad hay una cuenta Gmail
  // (Composio) conectada — es lo único que autoriza leer/enviar correo real.
  const [gmailConectado,setGmailConectado]=useState(false)

  useEffect(()=>{
    if(!loginStatus) return
    const url = new URL(window.location.href)
    url.searchParams.delete('login')
    url.searchParams.delete('esperado')
    url.searchParams.delete('conectado')
    window.history.replaceState({}, '', url.pathname + (url.search||''))
  },[loginStatus])

  // Firebase primero (cualquier Google) → luego Composio Gmail → luego demo
  useEffect(()=>{
    const unsub = onFirebaseAuthChange(async (fbUser)=>{
      if(fbUser){
        setModoAlmacenamiento(false)
        setSession(fbUser)
        // Carga inicial Firestore — cada persona ve solo SUS propios procesos
        // (filtrado por dueño, ver mockFirebase.js), nunca los de otra cuenta.
        const fbList = await fetchProcesosFirestore(fbUser.email)
        if(fbList) setProcesos(fbList)
        return
      }
      // No Firebase: revisa Composio Gmail o demo
      const real = await fetchRealSession()
      if(real){ setModoAlmacenamiento(false); setSession({ nombre: real.name || real.email, email: real.email, real:true }); return }
      const demo = getDemoUser()
      if(demo){ setModoAlmacenamiento(true); setSession({ ...demo, real:false }); return }
      setModoAlmacenamiento(true); setSession(null)
    })
    return ()=> unsub && unsub()
  },[])

  // Suscripción Firestore en vivo cuando hay sesión Firebase — filtrada por
  // dueño, para que cada persona solo reciba en vivo SUS propios procesos.
  useEffect(()=>{
    if(!session?.firebase) return
    const unsub = subscribeProcesosFirestore((list)=> setProcesos(list), session.email)
    return ()=> unsub && unsub()
  },[session?.firebase, session?.email])

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
    setDemoUser(u); setModoAlmacenamiento(true); setSession(u); showToast(`👋 Hola, ${name.split(' ')[0]} — modo demostración`)
  }
  async function handleGoogleLogin(){
    const u = await signInWithGoogle()
    setModoAlmacenamiento(false)
    setSession(u)
    showToast(`👋 Hola ${u.nombre.split(' ')[0]} — Google conectado, tus procesos son privados`)
  }
  function handleRealConnect({name,email}){
    // Antes esto navegaba siempre a /api/auth/composio/start, sin importar si
    // Composio ya estaba configurado en el servidor (COMPOSIO_GMAIL_AUTH_CONFIG_ID).
    // Si faltaba, esa ruta respondía con una página de error en texto plano —
    // la persona salía de la app sin ver ningún mensaje claro dentro de la
    // interfaz, y volvía a "no pasa nada" al presionar atrás. Ahora se avisa
    // aquí mismo, sin salir de la app, exactamente igual en los 3 botones que
    // llaman a esta función (barra superior, menú de usuario, banner del
    // Dashboard).
    if(!composioConfigured){
      showToast('⚠️ Conectar Gmail real aún no está disponible: falta un paso de configuración única en el servidor (Composio). Ver COMPOSIO_SETUP.md.')
      return
    }
    window.location.href = `/api/auth/composio/start?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`
  }
  async function handleLogout(){
    if(session?.firebase) await logoutFirebase()
    else if(session?.real) await logoutReal()
    else clearDemoUser()
    setUsuarioActual(null)
    setSession(null); setMenuOpen(false); showToast('Sesión cerrada')
  }

  const [procesos,setProcesos]=useState([])
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
  const [reply,setReply]=useState(null) // {correo, analisis, proceso, sugerencia, asunto, cuerpo, modo}
  const [sending,setSending]=useState(false)
  const [confirmSend,setConfirmSend]=useState(false) // 2do paso: evita enviar por un clic accidental
  const [viewCorreo,setViewCorreo]=useState(null) // {correo, a, proc} — ver el correo completo, como es
  const [seleccionados,setSeleccionados]=useState(()=> new Set()) // ids de correos marcados para acción masiva en Inbox
  const [gmailError,setGmailError]=useState(null) // mensaje honesto si falló la lectura del Gmail real conectado
  const [sendError,setSendError]=useState(null) // motivo real si falló el envío — antes desaparecía en un toast de 3.5s

  // Al salir del Inbox (o al llegar más correos), limpiar la selección — evita
  // que un id seleccionado en un filtro quede "fantasma" al cambiar de vista.
  useEffect(()=>{ setSeleccionados(new Set()) },[tab])

  useEffect(()=>{
    if(!reply && !viewCorreo) return
    const onKey=(e)=>{ if(e.key!=='Escape') return; if(reply){ if(!sending) setReply(null) } else if(viewCorreo) setViewCorreo(null) }
    window.addEventListener('keydown', onKey)
    return ()=>window.removeEventListener('keydown', onKey)
  },[reply, sending, viewCorreo])

  // Carga inicial — SOLO cuando ya sabemos si la sesión es demo o real.
  // Antes esto corría con deps [] (una sola vez, sin esperar la sesión) y
  // SIEMPRE llamaba a fetchRealGmail — es decir, una persona en modo
  // demostración terminaba viendo la bandeja REAL de la empresa, justo lo
  // contrario de lo que promete la pantalla de login. Ahora se ramifica por
  // session.real y cada modo usa su propio namespace de almacenamiento.
  useEffect(()=>{
    if(!session) return
    setModoAlmacenamiento(!session.real)
    // Para que Auditoría diga quién de verdad hizo cada acción incluso sin
    // Firebase (demo, o Gmail conectado solo por Composio) — antes siempre
    // decía "Coordinadora" sin importar la sesión activa.
    setUsuarioActual(session.nombre || session.email)
    ;(async()=>{
      setLoading(true)
      setGmailError(null)
      let correosIniciales = []
      let errorReal = null
      // "session.real" ya no significa "tiene Gmail conectado" — desde que
      // se agregó el login con Firebase, alguien puede tener session.real
      // (o session.firebase) en true por haber entrado con su Google, SIN
      // haber conectado su Gmail (Composio) todavía. Antes esto se
      // confundía: cualquier login real intentaba leer Gmail de inmediato,
      // fallaba para quien solo había hecho login con Google, y mostraba un
      // aviso de error que en realidad no era un error — solo faltaba
      // conectar Gmail. Ahora se pregunta explícitamente si hay Gmail
      // conectado (igual que ya hacía handleSync) antes de intentar leerlo.
      // BUG grave encontrado: la cookie de sesión de Gmail (Composio) es
      // independiente del login de Firebase. Si en este navegador quedó una
      // cookie de una conexión anterior de OTRA cuenta (p. ej. alguien
      // conectó su Gmail hace días, y hoy otra persona entra con su propio
      // Google), fetchRealSession() la devolvía igual — y la app mostraba el
      // correo REAL de esa otra cuenta como si fuera de la sesión actual.
      // Eso es exactamente el "dato quemado" de otra persona. Ahora se
      // verifica que el correo de la cuenta Gmail conectada coincida con el
      // de la sesión actual antes de confiar en ella; si no coincide, se
      // ignora y se limpia esa cookie vieja.
      let gmailSession = session.real ? await fetchRealSession() : null
      if(gmailSession && session.email && gmailSession.email?.toLowerCase().trim() !== session.email.toLowerCase().trim()){
        console.warn('[App] Gmail conectado pertenece a otra cuenta — se ignora:', gmailSession.email, 'vs sesión', session.email)
        logoutReal().catch(()=>{})
        gmailSession = null
      }
      setGmailConectado(!!gmailSession)
      if(gmailSession){
        try{
          correosIniciales = await fetchRealGmail({maxResults:30})
        }catch(e){
          // Antes, si esto fallaba, se mostraba en silencio la bandeja de
          // OTRA cuenta (el snapshot fijo) como si fuera la propia. Ahora se
          // muestra un aviso honesto y la app queda vacía — nunca datos
          // ajenos disfrazados de "tu Gmail real".
          console.error('[App] fetchRealGmail falló:', e.message)
          errorReal = e.message
          setGmailError(e.message)
        }
      } else if(!session.real){
        correosIniciales = generarCorreosDemo({name:session.nombre, email:session.email})
      }
      // Firebase con sesión Google pero SIN Gmail conectado: no hay bandeja
      // que leer todavía. Los procesos de este caso vienen de Firestore (ver
      // el efecto de suscripción arriba) — no se tocan aquí para no pisarlos
      // con una regeneración vacía.
      if(session.firebase && !gmailSession){
        setLoading(false)
        showToast(`👋 Sesión con Google lista, ${(session.nombre||'').split(' ')[0]} — conecta tu Gmail cuando quieras traer tu bandeja real`)
        return
      }
      setCorreos(correosIniciales)
      // Nunca partir de getProcesos() en modo demo — ese storage puede tener
      // procesos de una sesión real anterior en el mismo navegador y ya no
      // arranca con procesos semilla ficticios (ver mockFirebase.js).
      const base = gmailSession ? getProcesos() : []
      const {procesos:gen}=generarProcesosDesdeCorreos(correosIniciales, base, gmailSession ? 181 : 5000, session.email)
      // Persistir de una vez: si no se guarda aquí, updateProceso() (cerrar,
      // marcar urgente, checklist, acciones de la Mascota…) no encuentra el
      // proceso en localStorage y la siguiente lectura vuelve a una lista
      // vacía — pareciendo que la acción "no funcionó".
      saveProcesos(gen)
      setProcesos(gen)
      // Si además hay Firebase, estos procesos generados desde Gmail real
      // también se comparten en Firestore — para que el resto del equipo
      // los vea, igual que promete la pantalla de login.
      if(session.firebase && gmailSession) gen.forEach(p=> saveProcesoFirestore(p))
      setLoading(false)
      if(errorReal){
        showToast('⚠️ No se pudo leer su Gmail real — vea el aviso arriba')
      } else {
        showToast(gmailSession ? `✓ ${correosIniciales.length} correos reales — inbox ordenado` : `✓ Modo demostración — ${correosIniciales.length} correos de ejemplo`)
      }
    })()
  },[session])
  useEffect(()=>{
    if(!correos.length) return
    setAnalisis(correos.map(c=>({correo:c, a:analizarCorreoCompleto(c, procesos.find(p=>p.correos?.includes(c.id))||null, session?.email)})))
  },[correos,procesos,session?.email])

  const refresh=()=>setProcesos(getProcesos())
  const stats=useMemo(()=>{
    const crit=procesos.filter(p=>p.prioridad==='CRITICA').length
    const alta=procesos.filter(p=>p.prioridad==='ALTA').length
    const enProc=procesos.filter(p=>['EN_PROCESO','PENDIENTE','SEGUIMIENTO'].includes(p.estado)).length
    const esperando=procesos.filter(p=>p.estado==='ESPERANDO').length
    const venc=procesos.filter(fechaVencidaCalendario).length
    const total=procesos.length
    const hoy=procesos.filter(p=>p.fechaLimite===fechaLocalISO()).length
    return {crit,alta,enProc,esperando,venc,total,hoy}
  },[procesos])

  // Métricas del dashboard — siempre calculadas de los procesos/correos reales
  // de esta sesión, nunca cifras inventadas.
  const metricas=useMemo(()=>{
    const total=procesos.length
    const cerrados=procesos.filter(p=>['CERRADO','COMPLETADO'].includes(p.estado)).length
    const aTiempo=procesos.filter(p=>!fechaVencidaCalendario(p)).length
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

  const filtrados=useMemo(()=>procesos.filter(p=>{
    if(filtro.prior!=='TODAS'&&p.prioridad!==filtro.prior) return false
    if(filtro.estado!=='TODOS'&&estadoEfectivo(p)!==filtro.estado) return false
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

  // El Dashboard antes mostraba muchas tarjetas a la vez (KPIs, "haz estas 3
  // primero", plan del día, vista previa del inbox, indicadores) — demasiado
  // para entender de un vistazo. Esto agrupa TODO lo que hay que decidir en
  // las 4 categorías más simples posibles (inspirado directamente en cómo
  // debería verse el resultado final, sección 41 del documento de
  // requerimientos): atender ahora, requiere respuesta, seguimientos, sin
  // acción. Una persona no debería tener que entender "prioridad ALTA vs
  // score 87/100" — solo necesita saber en cuál de estos 4 grupos cae cada
  // cosa y qué botón tocar.
  const buckets = useMemo(()=>{
    const atenderAhora=[], requiereRespuesta=[], seguimientos=[]
    let sinAccion=0
    analisis.forEach(({correo,a})=>{
      const esMiTurno = a.turno.accionEsperadaDe==='COORDINADORA'
      if(!a.relevancia.esRelevante){ sinAccion++; return }
      if(esMiTurno && (a.prioridad.nivel==='CRITICA')){ atenderAhora.push({correo,a}); return }
      if(esMiTurno && a.accion.requiereAccion){ requiereRespuesta.push({correo,a}); return }
      if(!esMiTurno){ seguimientos.push({correo,a}); return }
      sinAccion++
    })
    const porScore=(x,y)=> y.a.prioridad.score - x.a.prioridad.score
    atenderAhora.sort(porScore); requiereRespuesta.sort(porScore); seguimientos.sort(porScore)
    return { atenderAhora, requiereRespuesta, seguimientos, sinAccion }
  },[analisis])
  const [verMas,setVerMas]=useState(false) // "Ver más" — plan del día, indicadores, detalle técnico (oculto por defecto)

  // Antes esto era una lista fija con nombres inventados (Juan Pérez, María
  // López, Carlos Ruiz…) que se mostraba SIEMPRE, sin importar de quién
  // fuera la sesión ni qué correos hubiera de verdad — el ejemplo más claro
  // de "dato quemado" que reportó el Señor. Ahora se arma con los procesos
  // reales de esta sesión, mismo orden que "Haz estas 3 primero", pero con
  // más ítems y un colchón libre al final si hay espacio.
  const planDelDia = useMemo(()=>{
    const activos=[...procesos].filter(p=>!['CERRADO','COMPLETADO'].includes(p.estado))
    const orden={CRITICA:4,ALTA:3,MEDIA:2,BAJA:1,INFORMATIVA:0}
    activos.sort((a,b)=> (orden[b.prioridad]-orden[a.prioridad]) || (new Date(a.fechaLimite)-new Date(b.fechaLimite)))
    const franjas=['Primero','Después','Luego','Más tarde','Antes de cerrar el día']
    const items = activos.slice(0,5).map((p,i)=>({h:franjas[i]||`Punto ${i+1}`, t:p.titulo.slice(0,60), d:`${(p.proximaAccion||'Revisar').slice(0,70)} • vence ${p.fechaLimite}`, pri:p.prioridad, id:p.id}))
    if(items.length) items.push({h:'Colchón', t:'Bloque libre', d:'Deja espacio para imprevistos', pri:'BAJA', id:null})
    return items
  },[procesos])
  // Antes era un "94%" fijo en el sidebar, igual para cualquier sesión y
  // cualquier bandeja. Ahora es el promedio real de confianza que la IA
  // calculó para los correos ya analizados de esta sesión.
  const confianzaProm = useMemo(()=>{
    if(!analisis.length) return null
    return Math.round(analisis.reduce((s,x)=>s+(x.a.confianza||0),0)/analisis.length*100)
  },[analisis])

  async function handleSync(){
    setSyncing(true)
    setGmailError(null)
    audit('sync_gmail',{account: session.email || 'demo', firebase: !!session.firebase})
    let fresh = []
    // Intenta Gmail real (Composio) si hay sesión de Gmail conectada — funciona para Firebase o Composio
    let gmailSession = session.real ? await fetchRealSession() : null
    // Misma verificación que en la carga inicial: nunca confiar en una
    // cookie de Gmail conectada que pertenezca a una cuenta distinta a la
    // sesión actual — ver comentario largo en el efecto de carga inicial.
    if(gmailSession && session.email && gmailSession.email?.toLowerCase().trim() !== session.email.toLowerCase().trim()){
      logoutReal().catch(()=>{})
      gmailSession = null
    }
    setGmailConectado(!!gmailSession)
    if(gmailSession){
      try{ fresh = await fetchRealGmail({maxResults:30}) }
      catch(e){ console.error('[handleSync] fetchRealGmail falló:', e.message); setGmailError(e.message); setSyncing(false); showToast('⚠️ No se pudo sincronizar su Gmail real: '+e.message); return }
    } else if(session.firebase){
      // Con Google pero sin Gmail conectado: no hay bandeja que traer — los
      // procesos siguen viniendo de Firestore (suscripción en vivo).
      setSyncing(false)
      showToast('ℹ️ Conecte su Gmail para sincronizar su bandeja real')
      return
    } else {
      fresh = generarCorreosDemo({name:session.nombre, email:session.email})
    }
    setCorreos(fresh)
    const {procesos:gen}=generarProcesosDesdeCorreos(fresh,procesos, gmailSession ? 181 : 5000, session.email)
    saveProcesos(gen)
    setProcesos(gen)
    if(session.firebase && gmailSession) gen.forEach(p=> saveProcesoFirestore(p))
    setSyncing(false)
    showToast(gmailSession ? `✓ Sincronizado: ${fresh.length} correos reales (${gmailSession.email})` : `✓ Actualizado: ${fresh.length} correos de ejemplo — modo demostración`)
  }
  // Antes "Exportar a Sheets" era un botón que solo mostraba un toast
  // diciendo "Exportado (simulado)" — no exportaba nada de verdad. Como no
  // hay credenciales de Google Sheets API configuradas en este despliegue
  // (requeriría una cuenta de servicio propia del cliente), la exportación
  // honesta y 100% funcional hoy es un CSV real y descargable: se abre
  // directo en Google Sheets ("Archivo → Importar") o en Excel, sin
  // inventar una integración que no existe.
  function exportarCSV(lista=procesos){
    if(!lista.length){ showToast('No hay procesos para exportar todavía'); return }
    const cols = ['id','titulo','area','categoria','prioridad','estado','fechaLimite','retraso','responsable','proximaAccion']
    const escapar = v => `"${String(v??'').replace(/"/g,'""')}"`
    const filas = [cols.join(',')].concat(lista.map(p=> cols.map(c=>escapar(c==='estado'?estadoEfectivo(p):p[c])).join(',')))
    const csv = '﻿'+filas.join('\r\n') // BOM — Excel/Sheets detectan UTF-8 correctamente con tildes/ñ
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `procesos_${fechaLocalISO()}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    audit('exportar_csv', { total: lista.length })
    showToast(`⬇️ ${lista.length} proceso(s) descargados como CSV`)
  }
  const [sheetsSyncing,setSheetsSyncing]=useState(false)
  async function sincronizarSheetsReal(){
    if(!procesos.length){ showToast('No hay procesos para sincronizar'); return }
    setSheetsSyncing(true)
    try{
      const r = await fetch('/api/sheets/sync', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body: JSON.stringify({ procesos }) })
      const j = await r.json().catch(()=>({}))
      if(!r.ok) throw new Error(j.note || j.error || `Error ${r.status}`)
      audit('sheets_sync', { total: procesos.length, via: j.via })
      showToast(`✅ ${j.updated||procesos.length} filas sincronizadas a Google Sheets`)
      if(j.sheetUrl) window.open(j.sheetUrl, '_blank')
    }catch(e){
      showToast(`❌ Sheets: ${e.message} — conecta tu Gmail+Sheets con Google`)
    }finally{ setSheetsSyncing(false) }
  }
  function marcarCerrado(id){ updateProceso(id,{estado:'CERRADO',fechaCierre:new Date().toISOString()}); refresh(); showToast(`${id} cerrado`)}
  // Acción rápida "Listo" directamente desde la tabla de Procesos — antes,
  // para decir "ya terminé esto" había que entrar al detalle, marcar cada
  // tarea del checklist una por una y luego cerrar el proceso. Ahora un solo
  // clic en la fila marca todo el checklist como hecho y pasa el proceso a
  // COMPLETADO (un paso previo a "Cerrado", que sigue siendo una acción
  // deliberada desde el detalle).
  function marcarProcesoListo(id){
    const p = procesos.find(x=>x.id===id)
    const tareasListas = (p?.tareas||[]).map(t=>({...t, done:true}))
    updateProceso(id,{ estado:'COMPLETADO', tareas: tareasListas, ultimaActividad:new Date().toISOString() })
    audit('proceso_listo', { proceso:id })
    refresh()
    if(sel?.id===id) setSel(s=> s?{...s, estado:'COMPLETADO', tareas:tareasListas}:s)
    showToast(`✅ ${id} marcado como listo`)
  }
  function marcarLeido(id){
    setCorreos(c=>c.map(x=> x.id===id? {...x, etiquetas: x.etiquetas.filter(l=>l!=='UNREAD')}:x))
    showToast('Marcado leído')
    // Refleja el cambio en la bandeja real cuando hay Gmail conectado — antes
    // esto solo cambiaba la vista local y el mensaje seguía "no leído" en
    // Gmail de verdad. Si falla (red, permisos) no se revierte la vista: ya
    // se marcó leído aquí, y se avisa para que la persona sepa que no
    // alcanzó a reflejarse afuera.
    if(gmailConectado) marcarLeidoGmailReal(id).catch(e=> showToast('⚠️ No se reflejó en Gmail real: '+e.message))
  }
  function archivarCorreo(id){
    setCorreos(c=>c.filter(x=>x.id!==id))
    showToast('Archivado — inbox más limpio')
    if(gmailConectado) archivarGmailReal(id).catch(e=> showToast('⚠️ No se archivó en Gmail real: '+e.message))
  }
  // Selección múltiple del Inbox Ordenado — antes "Marcar leídos"/"Archivar
  // selección" solo mostraban un toast, sin marcar ni archivar nada de
  // verdad porque no existía ningún estado de selección real.
  function toggleSeleccion(id){
    setSeleccionados(s=>{ const n=new Set(s); n.has(id)? n.delete(id) : n.add(id); return n })
  }
  function marcarLeidosSeleccionados(){
    if(!seleccionados.size) return
    const ids=[...seleccionados]
    setCorreos(c=>c.map(x=> ids.includes(x.id)? {...x, etiquetas: x.etiquetas.filter(l=>l!=='UNREAD')}:x))
    showToast(`✓ ${ids.length} correo(s) marcados leídos`)
    setSeleccionados(new Set())
    if(gmailConectado){
      Promise.allSettled(ids.map(id=>marcarLeidoGmailReal(id))).then(rs=>{
        const fallidos = rs.filter(r=>r.status==='rejected').length
        if(fallidos) showToast(`⚠️ ${fallidos} de ${ids.length} no se reflejaron en Gmail real`)
      })
    }
  }
  function archivarSeleccionados(){
    if(!seleccionados.size) return
    const ids=[...seleccionados]
    setCorreos(c=>c.filter(x=>!ids.includes(x.id)))
    showToast(`🗄️ ${ids.length} correo(s) archivados`)
    setSeleccionados(new Set())
    if(gmailConectado){
      Promise.allSettled(ids.map(id=>archivarGmailReal(id))).then(rs=>{
        const fallidos = rs.filter(r=>r.status==='rejected').length
        if(fallidos) showToast(`⚠️ ${fallidos} de ${ids.length} no se archivaron en Gmail real`)
      })
    }
  }
  function abrirResponder(correo){
    const a = analisis.find(x=> x.correo.id===correo.id)?.a || analizarCorreoCompleto(correo, null, session?.email)
    const proc = procesos.find(p=> p.correos?.includes(correo.id) || p.hiloId===correo.hiloId) || null
    const hilo = correos.filter(c=> c.hiloId===correo.hiloId).sort((x,y)=> new Date(x.fecha)-new Date(y.fecha))
    const sug = sugerirRespuesta(correo, a, proc, hilo, session)
    setConfirmSend(false); setSendError(null)
    setReply({ correo, analisis:a, proceso:proc, sugerencia:sug, asunto: sug.asunto, cuerpo: sug.cuerpo, modo:'responder' })
  }
  // "Preparar reenvío" — antes solo mostraba un toast y no abría nada de
  // verdad. Ahora abre el mismo modal de respuesta, en modo reenvío: asunto
  // con "Fwd:", cuerpo con el mensaje original citado, y el campo "Para"
  // vacío y editable para que la Coordinadora escriba el destinatario.
  function prepararReenvio(proceso){
    const correoBase = correos.find(c=> proceso.correos?.includes(c.id)) || correos.find(c=> c.hiloId===proceso.hiloId)
    if(!correoBase){ showToast('No hay un correo asociado a este proceso para reenviar'); return }
    const a = analisis.find(x=> x.correo.id===correoBase.id)?.a || analizarCorreoCompleto(correoBase, proceso, session?.email)
    const fwdAsunto = correoBase.asunto.startsWith('Fwd:') ? correoBase.asunto : `Fwd: ${correoBase.asunto}`
    const fwdCuerpo = `\n\n---------- Mensaje reenviado ----------\nDe: ${correoBase.remitente}\nAsunto: ${correoBase.asunto}\nFecha: ${correoBase.fecha}\n\n${correoBase.cuerpo}`
    setConfirmSend(false); setSendError(null)
    setReply({ correo: { ...correoBase, remitente:'' }, analisis:a, proceso, sugerencia:{asunto:fwdAsunto, cuerpo:fwdCuerpo, checklist:[], tono:'profesional', confianza:0.9}, asunto:fwdAsunto, cuerpo:fwdCuerpo, modo:'reenviar' })
  }
  function verCorreo(correo){
    const a = analisis.find(x=> x.correo.id===correo.id)?.a || analizarCorreoCompleto(correo, null, session?.email)
    const proc = procesos.find(p=> p.correos?.includes(correo.id) || p.hiloId===correo.hiloId) || null
    setViewCorreo({ correo, a, proc })
  }
  async function enviarRespuesta(){
    if(!reply) return
    // Action Guard de 2 pasos, dentro de la app — antes usaba window.confirm(),
    // un diálogo nativo del navegador que rompe el estilo, no se puede probar
    // ni personalizar, y en algunos navegadores bloquea el hilo de eventos.
    if(!confirmSend){ setConfirmSend(true); return }
    setSending(true)
    setSendError(null)
    let ok=false
    try{
      const res = await responderHilo({ correoOriginal: reply.correo, subject: reply.asunto, body: reply.cuerpo, requiereReal: gmailConectado })
      audit('enviar_respuesta', { to: reply.correo.remitente, subject: reply.asunto, threadId: reply.correo.hiloId, via: res.via, id: res.id })
      showToast(res.via==='gmail-api' || res.via?.startsWith('composio') ? '✉️ Respuesta enviada por Gmail REAL' : '✉️ Respuesta registrada — inbox actualizado')
      // marcar como respondido: actualizar proceso — solo si el envío fue exitoso
      if(reply.proceso){ updateProceso(reply.proceso.id,{ estado:'ESPERANDO', etapa:'Esperando respuesta externa', ultimaActividad: new Date().toISOString() }); setProcesos(getProcesos()) }
      ok=true
    }catch(e){
      // Antes se mostraba siempre el mismo mensaje genérico, sin decir POR
      // QUÉ falló — así nadie podía saber si el problema era, por ejemplo,
      // que la conexión de Gmail solo tiene permiso de lectura y no de
      // envío (un ajuste que se hace en el panel de Composio, no en el
      // código). Ahora se muestra el motivo real que devolvió el backend.
      console.error('[enviarRespuesta]', e)
      audit('enviar_respuesta_error', { to: reply.correo.remitente, subject: reply.asunto, error: e.message })
      setSendError(e.message || 'Error desconocido')
    }finally{
      setSending(false); if(ok){ setConfirmSend(false); setSendError(null); setReply(null) }
    }
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
      // Antes quedaba "Confirmado por Coordinadora" sin importar quién
      // realmente estuviera usando la sesión — el mismo tipo de dato quemado
      // que ya se corrigió en el registro de auditoría (audit()). Ahora usa
      // la identidad real de la sesión activa.
      updateProceso(proceso.id,{ estado:'CERRADO', fechaCierre: nowIso, motivoCierre:`Confirmado por ${session?.nombre || session?.email || 'usuario'} vía Mascota`, ultimaActividad: nowIso,
        historial: [...(proceso.historial||[]), { fecha: nowIso.slice(0,10), icon:'✅', texto:'Proceso cerrado por Mascota (confirmado)' }] })
      setProcesos(getProcesos()); showToast('✅ Proceso cerrado — auditoría registrada')
    } else if(type==='REENVIAR'){
      const targetCorreo = correo || (proceso?.correos?.length ? correos.find(c=>c.id===proceso.correos[0]) : null)
      if(!targetCorreo){ showToast('Seleccione un correo para reenviar'); return }
      // Prepara borrador de reenvío — el destinatario que entendió la Mascota
      // es solo un nombre (lenguaje natural), así que el campo "Para" queda
      // editable para que quien esté usando la sesión confirme la dirección
      // exacta, igual que en "Preparar reenvío" desde la tabla de Procesos.
      const fwdSubject = targetCorreo.asunto.startsWith('Fwd:') ? targetCorreo.asunto : `Fwd: ${targetCorreo.asunto}`
      // Antes firmaba siempre "Quedo atenta... Coordinación" — un texto con
      // género fijo y un cargo genérico, sin importar quién de verdad iba a
      // enviar el correo. Ahora queda neutro y firma con el nombre real de
      // la sesión activa.
      const firmante = session?.nombre || session?.email || ''
      const fwdBody = `Hola ${destinatario},\n\nTe reenvío esta solicitud para tu gestión:\n\n---------- Mensaje original ----------\nDe: ${targetCorreo.remitente}\nAsunto: ${targetCorreo.asunto}\nFecha: ${targetCorreo.fecha}\n\n${targetCorreo.cuerpo}\n\nQuedo pendiente de tu confirmación.\n\nCordial saludo,\n${firmante}`
      setConfirmSend(false); setSendError(null)
      setReply({ correo: { ...targetCorreo, remitente: '' }, analisis: analizarCorreoCompleto(targetCorreo, proceso, session?.email), proceso, sugerencia:{ asunto:fwdSubject, cuerpo:fwdBody, checklist:[], tono:'profesional', confianza:0.92 }, asunto:fwdSubject, cuerpo:fwdBody, modo:'reenviar' })
      showToast(`📨 Borrador de reenvío a ${destinatario} preparado — confirme el correo y el envío`)
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
    return <LoginScreen onDemoLogin={handleDemoLogin} onGoogleLogin={handleGoogleLogin} onRealConnect={handleRealConnect} loginStatus={loginStatus} loginEsperado={loginEsperado} loginConectado={loginConectado} composioConfigured={composioConfigured} />
  }

  return (
    <div className="app">
      <Toast msg={toast} onClose={()=>setToast('')} />
      <header className="topbar">
        <div className="brand">
          <div className="logo">SO</div>
          <div><div className="brand-title">Secretaria Operativa IA</div><div className="brand-sub">Su correo, ya leído, ordenado y priorizado</div></div>
        </div>
        <div className="top-actions">
          <div className="sync">
            <span className="mono" style={{fontSize:11,background:'var(--bg2)',border:'1px solid var(--border)',padding:'5px 10px',borderRadius:999,color:'var(--muted)'}}><span style={{width:7,height:7,background:loading?'#f59e0b':(gmailConectado?'#059669':session.firebase?'#2563eb':'#94a3b8'),borderRadius:'50%',display:'inline-block',marginRight:7}}/>{gmailConectado ? `GMAIL REAL • ${session.email}` : session.firebase ? `SESIÓN GOOGLE • ${session.email} • Gmail no conectado` : '🧪 MODO DEMOSTRACIÓN'} • {loading? 'cargando…':`${correos.length} correos`}</span>
            {(!session.firebase || gmailConectado) ? (
              <button className="btn primary" onClick={handleSync}>{syncing?'Sincronizando…':(gmailConectado?'Sincronizar Gmail':'Actualizar demo')}</button>
            ) : (
              <button className="btn primary" onClick={()=>handleRealConnect({name:session.nombre, email:session.email})}>Conectar Gmail real</button>
            )}
          </div>
          <button className="theme-toggle" onClick={()=>setTheme(theme==='light'?'dark':'light')} title="Tema">{theme==='light'?'🌙':'☀️'}</button>
          {/* El botón "App Escritorio" apuntaba a una página de releases de
              GitHub vacía (el Electron de la mascota está en el roadmap,
              nunca se empaquetó) — un cliente que lo abriera veía "There
              aren't any releases here". Se quita hasta que exista un
              instalador real que enlazar; la Mascota web (el botón flotante)
              ya cubre esa función mientras tanto. */}
          <div className="user-menu">
            <button className="avatar" onClick={()=>setMenuOpen(o=>!o)} title={session.email} aria-label="Cuenta" aria-expanded={menuOpen}>{iniciales(session.nombre)}</button>
            {menuOpen && (
              <div className="user-menu-pop">
                <div style={{fontWeight:800,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{session.nombre}</div>
                <div style={{fontSize:12,color:'var(--muted)',margin:'2px 0 8px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{session.email}</div>
                <Pill color={gmailConectado?'green':session.firebase?'blue':'gray'}>{gmailConectado?'Gmail real conectado':session.firebase?'Google — Gmail sin conectar':'Modo demostración'}</Pill>
                {session.firebase && !gmailConectado && (
                  <button className="btn sm" style={{width:'100%',marginTop:8,justifyContent:'center'}} onClick={()=>handleRealConnect({name:session.nombre, email:session.email})}>Conectar mi Gmail real</button>
                )}
                <button className="btn sm ghost" style={{width:'100%',marginTop:12,justifyContent:'center'}} onClick={handleLogout}>Cerrar sesión</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {gmailError && (
        <div style={{background:'var(--red-bg)',border:'1px solid var(--red)',color:'#991b1b',borderRadius:10,padding:'12px 28px',margin:'0 28px',display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <span style={{fontWeight:700}}>⚠️ No se pudo leer su Gmail real conectado ({session.email}):</span>
          <span className="mono" style={{fontSize:12}}>{gmailError}</span>
          <button className="btn sm" style={{marginLeft:'auto'}} onClick={handleSync}>Reintentar</button>
        </div>
      )}

      <div className="layout">
        <nav className="sidebar">
          {[
            {k:'dashboard',label:'Dashboard',icon:'◧',desc:'Resumen ejecutivo'},
            {k:'inbox',label:'Inbox Ordenado',icon:'✉',desc:`${correos.length} • ${analisis.filter(a=>a.a.accion.requiereAccion).length} requieren acción`},
            {k:'procesos',label:'Mis Procesos',icon:'▦',desc:`${stats.total} proceso${stats.total===1?'':'s'} • ${stats.crit} crítico${stats.crit===1?'':'s'}`},
            {k:'correos',label:'Análisis IA',icon:'🧠',desc:`${analisis.filter(a=>a.a.relevancia.esRelevante).length} relevantes`},
            {k:'sheets',label:'Exportar',icon:'▭',desc:'Descargar CSV de procesos'},
            {k:'auditoria',label:'Auditoría',icon:'≡',desc:'Historial de lo que hizo el sistema'},
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
          <div className="confianza-card"><div style={{fontSize:12,fontWeight:800}}>Confianza IA {confianzaProm==null?'—':`${confianzaProm}%`}</div><div style={{fontSize:11,color:'var(--muted)',margin:'4px 0 8px'}}>95-100 auto • 80-94 revisión • &lt;60 no actuar</div><div className="bar"><div style={{width:`${confianzaProm??0}%`}}/></div></div>
        </nav>

        <main className="main">
          {tab==='dashboard' && (
            <>
              <div className="live-banner">
                {gmailConectado ? (
                  <span className="mono live-label">🔴 DATOS REALES — {session.email} • {correos.length} correos analizados • Inbox ordenado por prioridad</span>
                ) : session.firebase ? (
                  <span className="mono live-label">🔵 SESIÓN GOOGLE — {session.email} • Procesos privados de esta cuenta • Gmail aún no conectado</span>
                ) : (
                  <span className="mono live-label">🧪 MODO DEMOSTRACIÓN — {correos.length} correos de ejemplo • ningún dato real de Proservis</span>
                )}
                <span style={{fontSize:11,color:'var(--muted)'}}>{gmailConectado ? <>Live <b>/api/gmail/live</b> en producción</> : session.firebase ? <button className="btn sm" onClick={()=>handleRealConnect({name:session.nombre, email:session.email})}>Conectar Gmail real →</button> : 'Conecte su Gmail real cuando quiera dejar de probar'}</span>
              </div>

              {/* Antes: 6 tarjetas de KPI + "haz estas 3" + plan del día + vista
                  previa del inbox + gráficos, todo visible a la vez. Ahora: UNA
                  sola pregunta respondida — "¿qué tengo que hacer?" — agrupada
                  en 4 categorías simples, con un solo botón grande por asunto.
                  El resto (números, plan por horas, gráficos) sigue disponible
                  pero oculto detrás de "Ver más detalle" para quien lo quiera. */}
              <div className="accion-buckets">
                <BucketSimple
                  color="red" emoji="🔴" titulo="Debes atender ahora"
                  items={buckets.atenderAhora}
                  vacio="Nada crítico pendiente — buen momento para ponerse al día con lo demás."
                  onResponder={abrirResponder} onVer={verCorreo}
                />
                <BucketSimple
                  color="orange" emoji="🟠" titulo="Requiere tu respuesta"
                  items={buckets.requiereRespuesta}
                  vacio="No hay solicitudes esperando su respuesta en este momento."
                  onResponder={abrirResponder} onVer={verCorreo}
                />
                <BucketSimple
                  color="yellow" emoji="🟡" titulo="Siguiendo — esperando a otra persona"
                  items={buckets.seguimientos}
                  vacio="No hay nada en espera de otra persona ahora mismo."
                  onResponder={null} onVer={verCorreo}
                  accionLabel="Ver"
                />
                <div className="bucket-card bucket-green">
                  <div className="bucket-head"><span className="bucket-emoji">🟢</span><b>Sin acción necesaria</b></div>
                  <div className="bucket-sinaccion">{buckets.sinAccion} correo{buckets.sinAccion===1?'':'s'} — ya analizados y clasificados, no requieren nada de usted.</div>
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
                      {label:'En proceso',value:stats.enProc,color:'#1e40af',sub:'Activos',trend:''},
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
                      <div key={k.label} className="kpi" role="button" tabIndex={0} aria-label={`Ver procesos: ${k.label}`} onClick={irAProcesos} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); irAProcesos() } }} style={{cursor:'pointer'}}>
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
                <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
                  <button className="btn sm" onClick={marcarLeidosSeleccionados} disabled={!seleccionados.size}>Marcar leídos{seleccionados.size?` (${seleccionados.size})`:''}</button>
                  <button className="btn sm" onClick={archivarSeleccionados} disabled={!seleccionados.size}>Archivar selección{seleccionados.size?` (${seleccionados.size})`:''}</button>
                  {seleccionados.size>0 && <button className="btn sm ghost" onClick={()=>setSeleccionados(new Set())}>Deseleccionar</button>}
                  <span className="mono" style={{fontSize:11,color:'var(--muted)',alignSelf:'center',marginLeft:8}}>💡 Marca la casilla para acciones masivas, o haz clic en el correo para leerlo completo.</span>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {inboxFiltrado.map(({correo,a})=>(
                    <div key={correo.id} className="mail-card" role="button" tabIndex={0} aria-label={`Ver correo: ${correo.asunto}`} onClick={()=>verCorreo(correo)} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); verCorreo(correo) } }} style={{display:'flex',gap:14,alignItems:'flex-start', opacity: !a.relevancia.esRelevante?0.6:1, borderLeft: a.prioridad.nivel==='CRITICA'?'3px solid #dc2626': a.prioridad.nivel==='ALTA'?'3px solid #d97706':'1px solid var(--border)', cursor:'pointer'}}>
                      <input type="checkbox" style={{marginTop:6}} checked={seleccionados.has(correo.id)} onChange={()=>toggleSeleccion(correo.id)} onClick={e=>e.stopPropagation()}/>
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
                  {!inboxFiltrado.length && <div className="empty-state">Sin correos en este filtro.</div>}
                </div>
              </div>
            </>
          )}

          {tab==='procesos' && (
            <>
              <p style={{fontSize:12,color:'var(--muted)',margin:'0 0 10px'}}>Estos son <b>sus propios procesos</b> — generados a partir de su correo. Cada persona que use esta app ve únicamente los suyos, nunca los de otra cuenta.</p>
              <div className="filters">
                <input placeholder="Buscar proceso, ID, área…" value={filtro.q} onChange={e=>setFiltro({...filtro,q:e.target.value})}/>
                <select value={filtro.prior} onChange={e=>setFiltro({...filtro,prior:e.target.value})}><option value="TODAS">Todas prioridades</option><option>CRITICA</option><option>ALTA</option><option>MEDIA</option><option>BAJA</option></select>
                <select value={filtro.estado} onChange={e=>setFiltro({...filtro,estado:e.target.value})}><option value="TODOS">Todos estados</option>{['NUEVO','EN_PROCESO','PENDIENTE','ESPERANDO','SEGUIMIENTO','VENCIDO','REPROGRAMADO','CERRADO','COMPLETADO'].map(s=><option key={s}>{s}</option>)}</select>
                <select value={filtro.area} onChange={e=>setFiltro({...filtro,area:e.target.value})}><option value="TODAS">Todas áreas</option><option>Operaciones</option><option>Compras</option><option>Talento Humano</option><option>TI</option><option>Logística</option><option>Reclutamiento</option><option>Bienestar</option></select>
                <button className="btn sm ghost" onClick={()=>setFiltro({q:'',prior:'TODAS',estado:'TODOS',area:'TODAS'})}>Limpiar filtros</button>
                <button className="btn sm" onClick={()=>exportarCSV(filtrados)}>⬇️ Exportar CSV</button>
              </div>
              <div className="table-wrap card" style={{padding:0}}>
                <table className="table">
                  <thead><tr><th>Proceso</th><th>Prioridad</th><th>Estado</th><th>Etapa</th><th>Vence</th><th>Retraso</th><th>Turno</th><th></th></tr></thead>
                  <tbody>
                    {filtrados.map(p=>(
                      <tr key={p.id} className={sel?.id===p.id?'sel':''} onClick={()=>setSel(p)} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); setSel(p) } }} tabIndex={0} aria-selected={sel?.id===p.id} style={{cursor:'pointer'}}>
                        <td><div style={{fontWeight:700,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:320}}>{p.id} — {p.titulo}</div><div style={{fontSize:11,color:'var(--muted)'}}>{p.area} • {p.categoria}</div></td>
                        <td><PrioridadDot n={p.prioridad}/> <small style={{fontWeight:700}}>{p.prioridad}</small></td>
                        <td><Pill color={estadoEfectivo(p)==='VENCIDO'?'red':p.estado==='EN_PROCESO'?'blue':p.estado==='ESPERANDO'?'cyan':'gray'}>{estadoEfectivo(p)}</Pill></td>
                        <td style={{fontSize:12}}>{p.etapa}</td>
                        <td style={{fontSize:12}}>{p.fechaLimite}</td>
                        <td style={{fontSize:12,color:p.retraso>0?undefined:'var(--muted)'}} className={p.retraso>0?'text-danger':''}>{p.retraso?`+${p.retraso}`:'0'}</td>
                        <td style={{fontSize:12}}>{p.turnoActual==='COORDINADORA'?<b className="turno-tu">TÚ</b>:<span className="turno-externo">Externo</span>}</td>
                        <td style={{display:'flex',gap:6}}>
                          {!['COMPLETADO','CERRADO','CANCELADO'].includes(p.estado) && (
                            <button className="btn sm primary" title="Marcar este proceso como listo" onClick={(e)=>{e.stopPropagation(); marcarProcesoListo(p.id)}}>✓ Listo</button>
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
                    <div className="card-head"><h3>{sel.id} — {sel.titulo}</h3><PrioridadDot n={sel.prioridad}/><Pill color={sel.prioridad==='CRITICA'?'red':'orange'}>{sel.prioridad}</Pill></div>
                    <p style={{fontSize:13,color:'var(--text2)',lineHeight:1.65,background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:8,padding:'12px 14px'}}>{sel.descripcion}</p>
                    <div className="kv">
                      <div><b>Responsable</b><span>{sel.responsable}</span></div>
                      <div><b>Estado</b><span>{estadoEfectivo(sel)}</span></div>
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
                        <button className="btn sm" onClick={()=>{
                          const correoVinculado = correos.find(c=> sel.correos?.includes(c.id)) || correos.find(c=> c.hiloId===sel.hiloId)
                          if(correoVinculado) abrirResponder(correoVinculado)
                          else showToast('No hay un correo vinculado a este proceso')
                        }}>Sugerir borrador</button>
                      </div>
                    </div>
                    <div style={{marginTop:12,display:'flex',gap:8,flexWrap:'wrap'}}>
                      <button className="btn primary" onClick={()=>marcarCerrado(sel.id)}>Cerrar proceso</button>
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
              <div className="card-head"><h3>📒 Procesos — Google Sheets 100% real</h3><div style={{display:'flex',gap:8}}><button className="btn" onClick={exportarCSV}>⬇️ CSV</button><button className="btn primary" onClick={sincronizarSheetsReal} disabled={sheetsSyncing}>{sheetsSyncing?'Sincronizando…':'↗ Sincronizar a Google Sheets'}</button></div></div>
              <div style={{fontSize:11,color:'var(--muted)',margin:'-6px 0 10px'}}>CSV local o <b>Sincronizar</b> directo a tu Google Sheet (requiere Gmail+Sheets conectado) — se abre en <b>Drive → Sheets</b> con tildes y ñ correctos.</div>
              <div className="table-wrap"><table className="table"><thead><tr><th>ID</th><th>Título</th><th>Área</th><th>Prioridad</th><th>Estado</th><th>Vence</th><th>Retraso</th></tr></thead><tbody>{procesos.map(p=>(<tr key={p.id} tabIndex={0} style={{cursor:'pointer'}} onClick={()=>{setSel(p); setTab('procesos')}} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); setSel(p); setTab('procesos') } }} aria-label={`Ver proceso ${p.titulo}`}><td className="mono" style={{fontSize:12}}>{p.id}</td><td style={{fontSize:12,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:280}}>{p.titulo}</td><td style={{fontSize:12}}>{p.area}</td><td><PrioridadDot n={p.prioridad}/>{p.prioridad}</td><td><Pill color={estadoEfectivo(p)==='VENCIDO'?'red':'gray'}>{estadoEfectivo(p)}</Pill></td><td style={{fontSize:12}}>{p.fechaLimite}</td><td style={{fontSize:12}} className={p.retraso>0?'text-danger':''}>{p.retraso||0}</td></tr>))}</tbody></table></div>
              <div style={{marginTop:10,fontSize:11,color:'var(--muted)'}}>💡 Haz clic en una fila para ver el detalle completo del proceso.</div>
            </div>
          )}

          {tab==='auditoria' && (
            <div className="card">
              <div className="card-head">
                <h3>🛡️ Auditoría — todo lo que se hizo, registrado</h3>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <span className="mono" style={{fontSize:11,color:'var(--muted)'}}>Nada se envía ni se cierra sin que quede aquí</span>
                  {session.firebase && (
                    <button className="btn sm ghost" title="Borra los 6 procesos de ejemplo (María López, Juan Pérez, Carlos Ruiz…) si quedaron guardados en Firestore por versiones anteriores de la app" onClick={async()=>{
                      const r = await limpiarDatosDeEjemploFirestore()
                      if(r.ok) showToast(`🧹 Datos de ejemplo eliminados de Firestore (${r.borrados})`)
                      else showToast('⚠️ '+(r.razon||'No se pudo limpiar'))
                    }}>🧹 Limpiar datos de ejemplo</button>
                  )}
                </div>
              </div>
              <p style={{fontSize:12,color:'var(--muted)',lineHeight:1.6,margin:'0 0 12px'}}>Cada vez que se sincroniza Gmail, se envía una respuesta o se marca algo urgente, queda una línea aquí — así siempre puede revisar qué pasó y cuándo, para su tranquilidad.</p>
              <div style={{display:'grid',gap:8}}>
                {(()=>{
                  const log = getAuditLog()
                  const etiqueta = {
                    sync_gmail:'🔄 Sincronizó Gmail',
                    enviar_respuesta:'✉️ Envió una respuesta',
                    reenvio:'↪️ Preparó un reenvío',
                    reply_ready:'✅ Marcó un proceso listo para responder',
                    proceso_listo:'✅ Marcó un proceso como listo',
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
        <Mascota procesos={procesos} analisis={analisis} sel={sel} viewCorreo={viewCorreo} onAction={handleMascotaAction} showToast={showToast} session={session} cargando={loading} />

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

      <footer style={{textAlign:'center',padding:'16px 0 24px',fontSize:11,color:'var(--muted)'}} className="mono">Secretaria Operativa IA • {new Date().toLocaleDateString()}</footer>
    </div>
  )
}


