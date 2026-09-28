import { useState, useEffect, useMemo } from 'react'
import { getProcesos, saveProcesos, setModoAlmacenamiento, updateProceso, addProceso, audit, setUsuarioActual, saveProcesoFirestore } from '../data/mockFirebase.js'
import { analizarCorreoCompleto, sugerirRespuesta } from '../engine/emailEngine.js'
import { fetchRealGmail, archivarGmailReal, marcarLeidoGmailReal } from '../services/gmailService.js'
import { generarCorreosDemo } from '../data/demoGmail.js'
import { generarProcesosDesdeCorreos } from '../services/processGenerator.js'
import { responderHilo } from '../services/gmailSendService.js'
import { fetchRealSession, logoutReal } from '../services/authService.js'
import { fechaLocalISO, fechaVencidaCalendario, estadoEfectivo } from '../utils/dateUtils.js'
import { estadoKanban, KANBAN_COLUMNAS } from '../utils/estadoUtils.js'
import { derivarContactos, flattenSeguimientos } from '../utils/contactoUtils.js'

// El "controlador" central de datos de la app: procesos, correos, análisis
// de la IA, todas las métricas/derivados del Dashboard y Estadísticas, y
// todas las acciones que leen o escriben esos datos (sincronizar Gmail,
// archivar, cerrar tareas, mover el Kanban, responder un correo…). Antes
// vivía mezclado con el JSX y el estado de sesión dentro de App(); ahora es
// un solo hook que App() consume y cuyo resultado se pasa tal cual a las
// vistas — así la lógica de negocio se puede leer y probar sin la interfaz.
//
// `procesos`/`setProcesos` entran por parámetro (en vez de vivir aquí)
// porque useAuthSession también los necesita para la suscripción en vivo de
// Firestore; todo lo demás (correos, análisis, buckets, KPIs, el modal de
// respuesta, la selección del Inbox…) es interno de este hook.
export function useCorreosYProcesos({ session, showToast, gmailConectado, setGmailConectado, archivados, setArchivados, sel, setSel, tab, setTab, setInboxFiltro, filtro, inboxFiltro, procesos, setProcesos }){
  const [correos,setCorreos]=useState([])
  const [loading,setLoading]=useState(true)
  const [analisis,setAnalisis]=useState([])
  const [syncing,setSyncing]=useState(false)
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

  // Archivados, configuración y recordatorios generales viven en
  // useConfiguracionPersistida (carga/guarda por cuenta automáticamente).

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

  // "Resumen de la semana" del panel derecho (mockup) — nunca cifras
  // inventadas: se cuentan los correos y procesos reales de esta cuenta en
  // los últimos 7 días, comparados con los 7 días anteriores.
  const resumenSemana = useMemo(()=>{
    const hoy = new Date()
    const haceNDias = n=>{ const d=new Date(hoy); d.setDate(d.getDate()-n); return d }
    const enRango=(fechaStr, desde, hasta)=>{ const f=new Date(fechaStr); return f>=desde && f<hasta }
    const semanaActualInicio = haceNDias(7), semanaAnteriorInicio = haceNDias(14)
    const correosSemana = correos.filter(c=>enRango(c.fecha, semanaActualInicio, hoy)).length
    const correosSemanaAnt = correos.filter(c=>enRango(c.fecha, semanaAnteriorInicio, semanaActualInicio)).length
    const cerradosSemana = procesos.filter(p=>p.fechaCierre && enRango(p.fechaCierre, semanaActualInicio, hoy)).length
    const cerradosSemanaAnt = procesos.filter(p=>p.fechaCierre && enRango(p.fechaCierre, semanaAnteriorInicio, semanaActualInicio)).length
    const pct = correosSemanaAnt>0 ? Math.round(((correosSemana-correosSemanaAnt)/correosSemanaAnt)*100) : null
    return { correosSemana, correosSemanaAnt, cerradosSemana, cerradosSemanaAnt, pct }
  },[correos, procesos])

  // Estadísticas — correos reales de los últimos 7 días, día por día (para
  // TrendBars). Nunca una serie inventada.
  const correosPorDia = useMemo(()=>{
    const dias=[]
    for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); dias.push(d) }
    const etiquetas=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
    return dias.map(d=>{
      const iso = fechaLocalISO(d)
      return { label: etiquetas[d.getDay()], value: correos.filter(c=>(c.fecha||'').slice(0,10)===iso).length }
    })
  },[correos])
  const prioridadesData = useMemo(()=>[
    {label:'Crítica', value: procesos.filter(p=>p.prioridad==='CRITICA').length},
    {label:'Alta', value: procesos.filter(p=>p.prioridad==='ALTA').length},
    {label:'Media', value: procesos.filter(p=>p.prioridad==='MEDIA').length},
    {label:'Baja', value: procesos.filter(p=>p.prioridad==='BAJA').length},
  ],[procesos])

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
    atenderAhora.sort(porScore); requiereRespuesta.sort(porScore)
    // Los que más días llevan esperando van primero — así los que necesitan
    // seguimiento (🟣) siempre quedan arriba en vez de perderse entre los
    // recién enviados.
    seguimientos.sort((x,y)=> new Date(x.correo.fecha) - new Date(y.correo.fecha))
    return { atenderAhora, requiereRespuesta, seguimientos, sinAccion }
  },[analisis])
  const [verMas,setVerMas]=useState(false) // "Ver más" — plan del día, indicadores, detalle técnico (oculto por defecto)

  // --- Contactos y Seguimientos como pestañas de primera clase (sección
  // 20/23 del documento) — se derivan de los mismos procesos/correos reales,
  // no son una colección nueva, así nunca chocan con lo que registre el
  // otro asistente (OpenCode) en Firestore.
  const contactosDerivados = useMemo(()=> derivarContactos(correos, procesos), [correos, procesos])
  const seguimientosFlat = useMemo(()=> flattenSeguimientos(procesos), [procesos])

  // "Sugerencia de tu IA" del panel derecho — un único consejo derivado del
  // motor real de reglas (emailEngine/buckets), nunca un texto fijo.
  const sugerenciaIA = useMemo(()=>{
    if(buckets.atenderAhora.length) return { texto:`Tienes ${buckets.atenderAhora.length} correo${buckets.atenderAhora.length>1?'s':''} crítico${buckets.atenderAhora.length>1?'s':''} sin atender. Empieza por "${buckets.atenderAhora[0].correo.asunto.slice(0,50)}".`, irA:()=>{setTab('inbox'); setInboxFiltro(f=>({...f,tab:'URGENTES'}))} }
    if(buckets.requiereRespuesta.length) return { texto:`${buckets.requiereRespuesta.length} correo${buckets.requiereRespuesta.length>1?'s':''} está${buckets.requiereRespuesta.length>1?'n':''} esperando tu respuesta. Ninguno es crítico todavía, pero conviene no dejarlos acumular.`, irA:()=>{setTab('inbox'); setInboxFiltro(f=>({...f,tab:'ACCION'}))} }
    const segVencido = seguimientosFlat.find(s=>s.estado==='VENCIDO')
    if(segVencido) return { texto:`El seguimiento "${segVencido.titulo.slice(0,50)}" ya venció. Puede que ya te hayan respondido — revísalo.`, irA:()=>setTab('seguimientos') }
    return { texto:'Tu bandeja está al día — no hay correos críticos ni pendientes de respuesta en este momento.', irA:()=>setTab('inbox') }
  },[buckets, seguimientosFlat])

  // --- KPIs con "+/-N desde ayer" (sección 41 del documento) — se guarda
  // una foto de los 4 números de hoy en localStorage; al día siguiente, al
  // compararla con la de hoy, se calcula el delta real (nunca inventado).
  const kpiHoy = useMemo(()=>{
    const activos = procesos.filter(p=>!['COMPLETADO','CERRADO','CANCELADO'].includes(p.estado))
    return {
      requierenRespuesta: activos.filter(p=>p.turnoActual==='COORDINADORA').length,
      esperandoRespuesta: activos.filter(p=>p.turnoActual!=='COORDINADORA').length,
      seguimientos: seguimientosFlat.filter(s=>['PENDIENTE','PROXIMO','VENCIDO'].includes(s.estado)).length,
      tareas: stats.total,
    }
  },[procesos, seguimientosFlat, stats.total])
  const [kpiAyer,setKpiAyer]=useState(null)
  useEffect(()=>{
    // Espera a que los procesos reales ya hayan cargado antes de tomar la
    // "foto" del día — si se tomara con loading=true, la foto quedaría en
    // ceros y el delta de "+N desde ayer" mentiría el resto del día.
    if(!session?.email || loading) return
    const key = `mi_asistente_kpi_${session.email}`
    const hoyIso = fechaLocalISO()
    let guardado=null
    try{ guardado = JSON.parse(localStorage.getItem(key)||'null') }catch{}
    if(guardado && guardado.fecha!==hoyIso){
      // Cambió el día real: lo guardado ayer pasa a ser el punto de comparación.
      setKpiAyer(guardado.valores)
      try{ localStorage.setItem(key, JSON.stringify({fecha:hoyIso, valores:kpiHoy})) }catch{}
    } else if(guardado){
      setKpiAyer(guardado.valores)
    } else {
      // Primera vez que se abre la app en esta cuenta — todavía no hay "ayer" real.
      try{ localStorage.setItem(key, JSON.stringify({fecha:hoyIso, valores:kpiHoy})) }catch{}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[session?.email, loading])
  const kpiDelta = (campo)=>{
    if(!kpiAyer) return null
    return kpiHoy[campo]-kpiAyer[campo]
  }

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
    if(!lista.length){ showToast('No hay tareas para descargar todavía'); return }
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
    showToast(`⬇️ ${lista.length} tarea(s) descargadas`)
  }
  const [sheetsSyncing,setSheetsSyncing]=useState(false)
  async function sincronizarSheetsReal(){
    if(!procesos.length){ showToast('No hay tareas para enviar'); return }
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
  // Busca el/los correos que pertenecen a una tarea (por id vinculado o por
  // mismo hilo) — se usa para que marcar/cerrar una tarea aquí también
  // archive su correo real en Gmail, y para anotar en el historial de la
  // tarea qué pasó con ese correo.
  function correosDeTarea(p){
    if(!p) return []
    return correos.filter(c=> p.correos?.includes(c.id) || (p.hiloId && c.hiloId===p.hiloId))
  }
  // --- Archivados de verdad (sección 20 del documento): antes "Archivar"
  // solo sacaba el correo de la Bandeja para siempre — no quedaba registro,
  // no se podía deshacer. Ahora se guarda en `archivados` (persistido por
  // cuenta) antes de sacarlo de la vista activa, con motivo y fecha, y desde
  // la pestaña Archivados se puede "Restaurar" en cualquier momento.
  function moverAArchivados(ids, motivo){
    if(!ids || !ids.length) return
    const objs = correos.filter(c=>ids.includes(c.id)).map(c=>({...c, archivadoFecha:new Date().toISOString(), archivadoMotivo:motivo||'Archivado'}))
    if(objs.length) setArchivados(a=>[...objs, ...a.filter(x=>!ids.includes(x.id))])
  }
  function restaurarArchivado(id){
    const a = archivados.find(x=>x.id===id)
    if(!a) return
    setArchivados(arr=>arr.filter(x=>x.id!==id))
    const {archivadoFecha,archivadoMotivo,...correo} = a
    setCorreos(c=> c.some(x=>x.id===id)? c : [correo, ...c])
    showToast('↩️ Correo restaurado a la Bandeja')
  }
  // --- Acciones de la pestaña Seguimientos (sección 20 del documento):
  // completar / posponer / cancelar un seguimiento puntual dentro de
  // p.seguimientos, sin tocar los demás.
  function actualizarSeguimiento(procesoId, idx, cambios){
    const p = procesos.find(x=>x.id===procesoId)
    if(!p) return
    const seguimientos = (p.seguimientos||[]).map((s,i)=> i===idx? {...s, ...cambios} : s)
    updateProceso(procesoId, {seguimientos})
    if(sel?.id===procesoId) setSel(s=>s?{...s,seguimientos}:s)
  }
  function posponerSeguimiento(procesoId, idx, dias=1){
    const p = procesos.find(x=>x.id===procesoId)
    const s = p?.seguimientos?.[idx]
    if(!s) return
    const d = new Date(s.fecha); d.setDate(d.getDate()+dias)
    actualizarSeguimiento(procesoId, idx, {fecha: fechaLocalISO(d)})
    showToast('📅 Seguimiento pospuesto')
  }
  // Todo lo que se marca aquí debe reflejarse también en el correo real:
  // si la tarea se da por lista/cerrada, su(s) correo(s) vinculado(s) se
  // archivan en Gmail de verdad (no solo en la vista local) — así la
  // bandeja de Gmail queda igual de "al día" que esta app. Si el archivado
  // remoto falla (red, permisos) no se revierte el cambio local: ya quedó
  // marcado aquí, y se avisa para que la persona sepa que no alcanzó a
  // reflejarse afuera.
  function sincronizarCorreosDeTareaConGmail(ids){
    if(!ids.length) return
    // Vista local: el correo sale de la Bandeja porque su tarea ya se dio
    // por terminada aquí — esto pasa siempre, haya o no Gmail conectado.
    moverAArchivados(ids, 'Tarea completada')
    setCorreos(c=>c.filter(x=>!ids.includes(x.id)))
    if(!gmailConectado) return
    Promise.allSettled(ids.map(id=>archivarGmailReal(id))).then(rs=>{
      const fallidos = rs.filter(r=>r.status==='rejected').length
      if(fallidos) showToast(`⚠️ ${fallidos} de ${ids.length} correo(s) no se archivaron en Gmail real`)
    })
  }
  function agregarHistorial(id, entrada){
    const p = procesos.find(x=>x.id===id)
    const historial = [...(p?.historial||[]), { fecha:new Date().toISOString().slice(0,10), ...entrada }]
    updateProceso(id,{ historial })
    if(sel?.id===id) setSel(s=> s?{...s, historial}:s)
    return historial
  }
  function marcarCerrado(id){
    const p = procesos.find(x=>x.id===id)
    const idsCorreo = correosDeTarea(p).map(c=>c.id)
    updateProceso(id,{estado:'CERRADO',fechaCierre:new Date().toISOString()})
    agregarHistorial(id, { icon:'🔒', texto: idsCorreo.length ? (gmailConectado?'Tarea cerrada — correo(s) archivados en Gmail':'Tarea cerrada — correo(s) archivados aquí') : 'Tarea cerrada' })
    sincronizarCorreosDeTareaConGmail(idsCorreo)
    refresh()
    showToast(`${id} cerrado`)
  }
  // Acción rápida "Listo" directamente desde la tabla de Procesos — antes,
  // para decir "ya terminé esto" había que entrar al detalle, marcar cada
  // tarea del checklist una por una y luego cerrar el proceso. Ahora un solo
  // clic en la fila marca todo el checklist como hecho y pasa el proceso a
  // COMPLETADO (un paso previo a "Cerrado", que sigue siendo una acción
  // deliberada desde el detalle). También archiva en Gmail real el/los
  // correos de esta tarea, porque "ya está listo" debe influir en el correo
  // de verdad, no solo en la vista de aquí.
  function marcarProcesoListo(id){
    const p = procesos.find(x=>x.id===id)
    const tareasListas = (p?.tareas||[]).map(t=>({...t, done:true}))
    const idsCorreo = correosDeTarea(p).map(c=>c.id)
    updateProceso(id,{ estado:'COMPLETADO', tareas: tareasListas, ultimaActividad:new Date().toISOString() })
    agregarHistorial(id, { icon:'✅', texto: idsCorreo.length ? (gmailConectado?'Marcado como listo — correo(s) archivados en Gmail':'Marcado como listo — correo(s) archivados aquí') : 'Marcado como listo' })
    sincronizarCorreosDeTareaConGmail(idsCorreo)
    audit('proceso_listo', { proceso:id })
    refresh()
    if(sel?.id===id) setSel(s=> s?{...s, estado:'COMPLETADO', tareas:tareasListas}:s)
    showToast(`✅ ${id} marcado como listo`)
  }
  // Mover una tarjeta del Kanban a otra columna — cambia el MISMO `estado`
  // real que ya usa toda la app (no hay campo paralelo). Soltar en
  // "Completadas" reutiliza marcarProcesoListo para no perder su lógica
  // (archiva en Gmail real, cierra el checklist, deja historial).
  function moverKanban(id, columna){
    const p = procesos.find(x=>x.id===id)
    if(!p) return
    if(estadoKanban(p.estado)===columna) return
    if(columna==='hecho'){ marcarProcesoListo(id); return }
    const destino = KANBAN_COLUMNAS.find(c=>c.k===columna)?.estadoDestino
    updateProceso(id,{estado:destino})
    agregarHistorial(id, { icon:'↔️', texto:`Movida a "${KANBAN_COLUMNAS.find(c=>c.k===columna)?.label}"` })
    refresh()
  }
  // Nueva tarea manual (botón "+ Nueva tarea" del Kanban, sección 30/32) —
  // se guarda con el mismo `addProceso`/Firestore que usan las tareas que sí
  // vienen de un correo, así que aparece en tabla, KPIs, calendario y
  // estadísticas exactamente igual que cualquier otra. `origen:'manual'`
  // permite luego distinguirla (p.ej. para permitir borrarla, cosa que no
  // se hace con tareas que vienen de un correo real).
  function crearTareaManual({titulo, descripcion, prioridad, area, fechaLimite, subtareas}){
    const id = `MAN-${Date.now().toString(36).toUpperCase()}`
    const hoy = new Date().toISOString()
    const proc = {
      id, propietario: session?.email || null, titulo: titulo.trim(), descripcion: (descripcion||'').trim(),
      prioridad: prioridad||'MEDIA', estado:'PENDIENTE', categoria:'Manual', area: area||'Operaciones',
      responsable: session?.nombre || session?.email || 'Yo', etapa:'Inicial',
      fechaLimite: fechaLimite || fechaLocalISO(new Date(Date.now()+3*86400000)),
      creada: hoy, ultimaActividad: hoy,
      tiempoObjetivo:3, tiempoTranscurrido:0, tiempoRestante:3, retraso:0,
      proximaAccion:'Completar tarea', tareas: (subtareas||[]).filter(t=>t.trim()).map((t,i)=>({id:`t-${id}-${i}`, titulo:t.trim(), done:false})),
      turnoActual:'COORDINADORA', esperanRespuesta:false, origen:'manual',
      historial:[{fecha:fechaLocalISO(), icon:'📝', texto:`Creada manualmente por ${session?.nombre||session?.email||'usuario'}`}],
      incidencias:[], correos:[], seguimientos:[],
    }
    addProceso(proc)
    refresh()
    audit('tarea_manual_creada',{proceso:id})
    showToast('✅ Tarea creada')
    return proc
  }
  function eliminarTareaManual(id){
    const list = getProcesos().filter(p=>p.id!==id)
    saveProcesos(list)
    refresh()
    showToast('🗑️ Tarea eliminada')
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
    moverAArchivados([id], 'Archivado manualmente')
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
    moverAArchivados(ids, 'Archivado manualmente')
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
    if(!correoBase){ showToast('No hay un correo asociado a esta tarea para reenviar'); return }
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

  return {
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
  }
}
