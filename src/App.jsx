import { useState, useEffect, useMemo } from 'react'
import { getProcesos, saveProcesos, setModoAlmacenamiento, updateProceso, audit, getAuditLog, setUsuarioActual } from './data/mockFirebase.js'
import { fetchProcesosFirestore, subscribeProcesosFirestore, saveProcesoFirestore, limpiarDatosDeEjemploFirestore } from './data/mockFirebase.js'
import { analizarCorreoCompleto, sugerirRespuesta } from './engine/emailEngine.js'
import { fetchRealGmail, archivarGmailReal, marcarLeidoGmailReal } from './services/gmailService.js'
import { generarCorreosDemo } from './data/demoGmail.js'
import { generarProcesosDesdeCorreos } from './services/processGenerator.js'
import { responderHilo } from './services/gmailSendService.js'
import LoginScreen from './components/LoginScreen.jsx'
import { Donut, HBarList } from './components/Charts.jsx'
import { getDemoUser, setDemoUser, clearDemoUser, fetchRealSession, logoutReal, iniciales, signInWithGoogle, logoutFirebase, onFirebaseAuthChange } from './services/authService.js'
import {
  Sparkles, Search, Bell, ChevronDown, ChevronRight, ChevronLeft, Home, Mail, RefreshCw,
  CheckSquare, Calendar, CalendarPlus, Users, Settings, Bot, Leaf, CornerUpLeft,
  Clock, ListChecks, Reply, Archive, Check, Send,
} from 'lucide-react'
import './App.css'

// Íconos lineales únicos (Lucide, sección 42 de la especificación) para cada
// pestaña del sidebar — reemplazan los emoji sueltos que usaba cada quien a
// su gusto antes de esta especificación formal.
const NAV_ICONS = {
  dashboard: Home,
  inbox: Mail,
  seguimientos: RefreshCw,
  procesos: CheckSquare,
  calendario: Calendar,
  contactos: Users,
  configuracion: Settings,
}

function Pill({children, color}){ return <span className={`pill pill-${color}`}>{children}</span> }
function PrioridadDot({n}){ const m={CRITICA:'crit',ALTA:'alta',MEDIA:'media',BAJA:'baja',INFORMATIVA:'info'}; return <span className={`dot dot-${m[n]||'baja'}`} /> }
function Toast({msg,onClose}){ if(!msg) return null; return <div className="toast"><span>{msg}</span><button onClick={onClose}>✕</button></div> }

// Una de las 4 categorías del Dashboard simplificado. Muestra pocos ítems,
// un solo botón grande y bien visible por ítem, y esconde el resto detrás
// de un contador — el objetivo es que se entienda de un vistazo sin tener
// que leer puntajes ni porcentajes.
const MAX_BUCKET_ITEMS = 6
// mostrarEspera: solo lo usa el bucket "Siguiendo" — cuenta hace cuántos
// días llegó ese correo (proxy de cuánto lleva esperando respuesta) y lo
// resalta si ya pasó el umbral, para no tener que ir abriendo uno por uno a
// ver si ya contestaron (igual que el aviso 🟣 de Mis Tareas).
function BucketSimple({ color, emoji, titulo, items, vacio, onResponder, onVer, accionLabel='Responder', mostrarEspera=false }){
  const visibles = items.slice(0, MAX_BUCKET_ITEMS)
  const restantes = items.length - visibles.length
  return (
    <div className={`bucket-card bucket-${color}`}>
      <div className="bucket-head"><span className="bucket-emoji">{emoji}</span><b>{titulo}</b><span className="bucket-count">{items.length}</span></div>
      {!items.length && <div className="bucket-vacio">{vacio}</div>}
      <div className="bucket-list">
        {visibles.map(({correo,a})=>{
          const dias = mostrarEspera ? diasEntre(correo.fecha) : null
          const necesitaAviso = dias!==null && dias>=DIAS_SIN_RESPUESTA_SEGUIMIENTO
          return (
          <div key={correo.id} className="bucket-item" role="button" tabIndex={0} onClick={()=>onVer(correo)} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); onVer(correo) } }}>
            <div style={{flex:1,minWidth:0}}>
              <div className="bucket-item-titulo">{correo.asunto}</div>
              <div className="bucket-item-motivo">
                {necesitaAviso ? <Pill color="pink">🟣 Sin respuesta hace {dias}d</Pill> : explicarTipo(a.clasificacion.tipo)}
              </div>
              <div className="bucket-item-meta">De: {correo.remitente.split('<')[0].trim()}{a.fechas.fechaCalculada?` • vence ${a.fechas.fechaCalculada}`:''}</div>
            </div>
            {onResponder ? (
              <button className="btn primary" onClick={e=>{e.stopPropagation(); onResponder(correo)}}>{accionLabel} →</button>
            ) : (
              <button className="btn" onClick={e=>{e.stopPropagation(); onVer(correo)}}>{accionLabel} →</button>
            )}
          </div>
        )})}
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
// --- Dos avisos "de asistente personal", inspirados en cómo Boomerang/SaneBox/
// Motion evitan que uno tenga que acordarse solo de todo: ---
// 1) Avisar ANTES de que algo se atrase (no solo cuando ya se atrasó), para
//    poder adelantarse.
// 2) Avisar cuando algo lleva varios días esperando respuesta de la otra
//    persona, para que uno no tenga que ir revisando uno por uno si ya
//    contestaron.
const DIAS_AVISO_VENCE_PRONTO = 2
const DIAS_SIN_RESPUESTA_SEGUIMIENTO = 3
function inicioDelDia(d){ const x=new Date(d); x.setHours(0,0,0,0); return x }
// Días de calendario (no horas) entre `fechaIso` y hoy — positivo si
// `fechaIso` ya pasó, negativo si todavía está por venir.
function diasEntre(fechaIso){
  if(!fechaIso) return null
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(fechaIso) ? fechaIso+'T00:00:00' : fechaIso)
  if(Number.isNaN(d.getTime())) return null
  return Math.round((inicioDelDia(new Date()) - inicioDelDia(d)) / 86400000)
}
// Está "por vencer": todavía no vencido, pero la fecha límite ya está a la
// vuelta de la esquina (hoy, mañana o pasado mañana) — para poder
// adelantarse en vez de enterarse cuando ya es tarde.
function porVencerPronto(fechaLimite, yaVencido, completado){
  if(!fechaLimite || yaVencido || completado) return false
  const diasParaVencer = -diasEntre(fechaLimite)
  return diasParaVencer!==null && diasParaVencer>=0 && diasParaVencer<=DIAS_AVISO_VENCE_PRONTO
}
// Lleva "demasiados" días esperando que la otra persona responda — en vez de
// que la persona tenga que ir abriendo tarea por tarea a ver si ya
// contestaron, la propia tarea se lo avisa sola.
function necesitaSeguimiento(esperandoOtro, ultimaActividad, completado){
  if(!esperandoOtro || completado || !ultimaActividad) return false
  const dias = diasEntre(ultimaActividad)
  return dias!==null && dias>=DIAS_SIN_RESPUESTA_SEGUIMIENTO
}
function explicarTurno(a){
  return a.turno.accionEsperadaDe==='COORDINADORA'
    ? 'Le toca responder a usted.'
    : 'Ya quedó en manos de la otra persona — solo debe esperar.'
}
// La tabla de "Mis Tareas" mostraba el código interno crudo del motor en la
// columna Etapa (RESPUESTA_GENERAL, FINALIZACION, CONFIRMACION, RECHAZO,
// "Inicial") — jerga de desarrollador que no dice nada útil a quien solo
// quiere saber en qué va su tarea. Se traduce a una frase corta y humana.
function explicarEtapa(etapa){
  const m = {
    RESPUESTA_GENERAL:'Necesita una respuesta',
    FINALIZACION:'Cerrando',
    CONFIRMACION:'Falta confirmar',
    RECHAZO:'Rechazado',
    APROBACION:'Aprobado',
    REPROGRAMACION:'Reprogramado',
    INCIDENCIA:'Hay un problema reportado',
    NUEVA_SOLICITUD:'Piden algo adicional',
    ENTREGA:'Entregado — revisar',
    Inicial:'Recién llegó',
  }
  return m[etapa] || etapa
}
// Los estados venían en MAYÚSCULAS_CON_GUION (EN_PROCESO, CON_INCIDENCIA…) —
// se leen, pero se ven a medio camino entre español y código. Una sola
// palabra o dos en formato normal se leen como una app terminada.
function formatEstado(estado){
  const m = {
    NUEVO:'Nuevo', EN_PROCESO:'En proceso', PENDIENTE:'Pendiente', ESPERANDO:'Esperando',
    SEGUIMIENTO:'En seguimiento', VENCIDO:'Vencido', REPROGRAMADO:'Reprogramado',
    CERRADO:'Cerrado', COMPLETADO:'Completado', BLOQUEADO:'Bloqueado', CANCELADO:'Cancelado',
    CON_INCIDENCIA:'Con incidencia',
  }
  return m[estado] || estado
}
// Sistema único de categorías por color + icono, para leer cualquier tarea o
// correo "de un vistazo" sin tener que combinar varias columnas (antes había
// que mirar Prioridad + Estado + Turno por separado para entender lo mismo).
// Camilo pidió justo esto: saber por color/ícono si algo ya está ok, si
// necesita su respuesta, si es urgente, o si ya quedó completado.
function estadoVisual({ prioridad, estadoEf, completado, esperandoOtro, sinRespuestaHace, porVencer }){
  if(completado) return { icon:'🟢', color:'green', label:'Completado' }
  if(estadoEf==='VENCIDO') return { icon:'🔴', color:'red', label:'Vencido' }
  if(prioridad==='CRITICA') return { icon:'🔴', color:'red', label:'Urgente' }
  // "Necesita seguimiento": ya se le pasó la pelota a la otra persona, pero
  // lleva varios días sin contestar — en vez de que Camilo tenga que ir
  // revisando tarea por tarea si ya respondieron, la tarea misma se lo avisa.
  if(sinRespuestaHace) return { icon:'🟣', color:'pink', label:`Sin respuesta hace ${sinRespuestaHace}d — dar seguimiento` }
  if(porVencer) return { icon:'🟡', color:'yellow', label:'Vence pronto' }
  if(esperandoOtro) return { icon:'🔵', color:'cyan', label:'Esperando a la otra persona' }
  if(prioridad==='ALTA'||prioridad==='MEDIA') return { icon:'🟠', color:'orange', label:'Necesita tu respuesta' }
  return { icon:'⚪', color:'gray', label:'Sin acción necesaria' }
}
// Para una tarea (proceso)
function estadoVisualProceso(p){
  const completado = ['COMPLETADO','CERRADO','CANCELADO'].includes(p.estado)
  const estadoEf = estadoEfectivo(p)
  const esperandoOtro = p.turnoActual!=='COORDINADORA'
  const diasSinRespuesta = esperandoOtro && !completado ? diasEntre(p.ultimaActividad) : null
  return estadoVisual({
    prioridad: p.prioridad,
    estadoEf,
    completado,
    esperandoOtro,
    sinRespuestaHace: necesitaSeguimiento(esperandoOtro, p.ultimaActividad, completado) ? diasSinRespuesta : null,
    porVencer: porVencerPronto(p.fechaLimite, estadoEf==='VENCIDO', completado),
  })
}
// Para un correo ya analizado por la IA
function estadoVisualCorreo(a){
  const completado = !a.relevancia.esRelevante
  return estadoVisual({
    prioridad: a.prioridad.nivel,
    estadoEf: null,
    completado,
    esperandoOtro: a.turno.accionEsperadaDe!=='COORDINADORA',
    porVencer: porVencerPronto(a.fechas.fechaCalculada, false, completado),
  })
}
function EstadoBadge({v}){ return <Pill color={v.color}>{v.icon} {v.label}</Pill> }

// ===================================================================
// MI ASISTENTE — capas nuevas del documento de requerimientos:
// contactos derivados, seguimientos como lista propia, recordatorios
// en lenguaje natural y el motor del chat del asistente. Todo calculado
// de los datos reales de la sesión (correos/procesos) — nada inventado,
// ninguna colección nueva en Firestore (para no chocar con lo que ya
// sincroniza OpenCode ahí).
// ===================================================================
// Colores de avatar consistentes por persona (mismo remitente = mismo
// color siempre) — igual que el mockup, sin depender de una foto real.
const AVATAR_COLORES = ['#059669','#2563EB','#7C3AED','#DC2626','#D97706','#0D9488','#DB2777','#4F46E5']
function colorDeAvatar(str){
  let h=0; for(let i=0;i<(str||'').length;i++) h=(h*31+str.charCodeAt(i))>>>0
  return AVATAR_COLORES[h%AVATAR_COLORES.length]
}
function inicialesDe(nombre){
  const partes=(nombre||'').trim().split(/\s+/).filter(Boolean)
  if(!partes.length) return '?'
  return (partes[0][0]+(partes[1]?.[0]||'')).toUpperCase()
}
// Pill de prioridad estilo mockup — Urgente/Alta/Media/Seguimiento/Tarea,
// derivada de lo que ya calcula el motor (analisis.a), no un dato nuevo.
function prioridadMockup(a){
  if(a.prioridad?.nivel==='CRITICA' || a.clasificacion?.tipo==='URGENTE') return {label:'Urgente', color:'red'}
  if(a.prioridad?.nivel==='ALTA') return {label:'Alta', color:'orange'}
  if(a.turno?.accionEsperadaDe!=='COORDINADORA') return {label:'Seguimiento', color:'blue'}
  if(a.accion?.requiereAccion) return {label:'Media', color:'yellow'}
  return {label:'Tarea', color:'gray'}
}
function saludoPorHora(){
  const h = new Date().getHours()
  if(h < 12) return 'Buenos días'
  if(h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}
function nombreDeRemitente(remitente){ return (remitente||'').split('<')[0].trim() || remitente || '—' }
function correoDeRemitente(remitente){ const m=(remitente||'').match(/<([^>]+)>/); return (m? m[1] : remitente || '').toLowerCase().trim() }

// --- Contactos: nadie los crea a mano, se arman solos con quién ha
// escrito, cuántas veces, y qué queda pendiente/esperando con cada uno.
function derivarContactos(correos, procesos){
  const map = new Map()
  correos.forEach(c=>{
    const email = correoDeRemitente(c.remitente)
    if(!email || !RE_EMAIL.test(email)) return
    if(!map.has(email)) map.set(email, { email, nombre: nombreDeRemitente(c.remitente), empresa: (email.split('@')[1]||'').split('.')[0], conversaciones:0, ultima:null, temas:new Set(), pendientes:0, esperando:0 })
    const c2 = map.get(email)
    c2.conversaciones++
    if(!c2.ultima || new Date(c.fecha)>new Date(c2.ultima)) c2.ultima=c.fecha
    if(c.asunto) c2.temas.add(c.asunto.replace(/^(re|fwd):\s*/i,'').slice(0,40))
  })
  procesos.forEach(p=>{
    const correosDelProceso = correos.filter(c=> p.correos?.includes(c.id) || (p.hiloId && c.hiloId===p.hiloId))
    const vistos = new Set()
    correosDelProceso.forEach(c=>{
      const email = correoDeRemitente(c.remitente)
      const c2 = map.get(email)
      if(!c2 || vistos.has(email)) return
      vistos.add(email)
      if(!['COMPLETADO','CERRADO','CANCELADO'].includes(p.estado)){
        if(p.turnoActual==='COORDINADORA') c2.pendientes++
        else c2.esperando++
      }
    })
  })
  return [...map.values()].map(c=>({...c, temas:[...c.temas].slice(0,3)})).sort((a,b)=> new Date(b.ultima)-new Date(a.ultima))
}

// --- Seguimientos: antes vivían escondidos dentro de cada proceso
// (p.seguimientos); ahora también se ven todos juntos en una sola lista,
// como pide el documento (título, contacto, vence, prioridad, estado).
function estadoSeguimiento(s){
  if(s.completado) return 'COMPLETADO'
  if(s.cancelado) return 'CANCELADO'
  if(s.fecha < fechaLocalISO()) return 'VENCIDO'
  if(s.fecha === fechaLocalISO()) return 'PROXIMO'
  return 'PENDIENTE'
}
function flattenSeguimientos(procesos){
  const out=[]
  procesos.forEach(p=>{
    ;(p.seguimientos||[]).forEach((s,i)=>{
      out.push({ segId:`${p.id}::${i}`, procesoId:p.id, idx:i, titulo:p.titulo, contacto:p.responsable, fecha:s.fecha, nota:s.nota, prioridad:p.prioridad, estado: estadoSeguimiento(s) })
    })
  })
  return out.sort((a,b)=> new Date(a.fecha)-new Date(b.fecha))
}

// --- Recordatorios en lenguaje natural: "mañana", "en 3 días", un día de
// la semana, o si no reconoce nada, lo deja para hoy en vez de fallar.
const DIA_INDEX = {domingo:0,lunes:1,martes:2,'miércoles':3,miercoles:3,jueves:4,viernes:5,'sábado':6,sabado:6}
function parsearFechaNatural(texto){
  const t=(texto||'').toLowerCase()
  let d=new Date()
  if(/mañana/.test(t)) d.setDate(d.getDate()+1)
  else {
    const enN = t.match(/en\s+(\d+)\s*d[ií]as?/)
    if(enN) d.setDate(d.getDate()+parseInt(enN[1],10))
    else {
      const diaMatch = Object.keys(DIA_INDEX).find(k=> t.includes(k))
      if(diaMatch){
        const target = DIA_INDEX[diaMatch]
        let delta=(target-d.getDay()+7)%7
        if(delta===0) delta=7
        d.setDate(d.getDate()+delta)
      }
    }
  }
  return fechaLocalISO(d)
}

// --- El "asistente te recuerda" del mockup: un solo mensaje dinámico,
// nunca texto fijo — prioriza lo más urgente/atrasado que haya de verdad.
function mensajeAsistente({urgentes, sinRespuesta, requierenResp, seguimientosProximos}){
  if(urgentes.length){
    const p=urgentes[0]
    return `Tienes ${urgentes.length} correo${urgentes.length===1?'':'s'} urgente${urgentes.length===1?'':'s'}. El más importante: "${p.titulo}".`
  }
  if(sinRespuesta.length){
    const p=sinRespuesta[0]
    return `${p.responsable||'Alguien'} lleva ${diasEntre(p.ultimaActividad)} días sin responderte sobre "${p.titulo}".`
  }
  if(requierenResp.length){
    return `Tienes ${requierenResp.length} correo${requierenResp.length===1?'':'s'} que requiere${requierenResp.length===1?'':'n'} tu respuesta. El más urgente: "${requierenResp[0].titulo}".`
  }
  if(seguimientosProximos.length){
    return `Mañana tienes un seguimiento relacionado con "${seguimientosProximos[0].titulo}".`
  }
  return 'Todo está al día — no encontré nada urgente ni pendiente en este momento. 🎉'
}

// --- Motor del chat del "Asistente personal": responde preguntas reales
// (no jerga, no porcentajes) cruzando los datos de la sesión — sin
// necesidad de escribir exacto: reconoce variaciones comunes de cada
// pregunta del documento (sección 15/43). No es una IA de propósito
// general — es honesto: entiende un set fijo de preguntas y para
// cualquier otra cosa cae en un resumen útil en vez de inventar.
function responderChatIA(pregunta, ctx){
  const { procesos, seguimientosFlat } = ctx
  const q=(pregunta||'').toLowerCase().trim()
  const activos = procesos.filter(p=>!['COMPLETADO','CERRADO','CANCELADO'].includes(p.estado))
  const requierenResp = activos.filter(p=>p.turnoActual==='COORDINADORA')
  const esperando = activos.filter(p=>p.turnoActual!=='COORDINADORA')
  const urgentes = activos.filter(p=>p.prioridad==='CRITICA')
  const sinRespuesta = esperando.filter(p=> necesitaSeguimiento(true, p.ultimaActividad, false))
  const vencenPronto = activos.filter(p=> porVencerPronto(p.fechaLimite, fechaVencidaCalendario(p), false))

  if(/qui[eé]n no me ha respondido|no me han respondido|sin respuesta/.test(q)){
    if(!sinRespuesta.length) return 'Nadie lleva demasiado tiempo sin responderte — lo que está esperando otra persona sigue dentro de lo normal 👍'
    return 'Esto llevas esperando hace rato:\n'+sinRespuesta.slice(0,5).map(p=>`• ${p.titulo} — ${p.responsable}, ${diasEntre(p.ultimaActividad)}d sin responder`).join('\n')
  }
  const conM = q.match(/pendiente con (.+)$/) || q.match(/qu[eé] tengo con (.+)$/)
  if(conM){
    const nombre=conM[1].trim()
    const match = activos.filter(p=> (p.responsable||'').toLowerCase().includes(nombre))
    if(!match.length) return `No encontré nada pendiente con "${nombre}".`
    return `Esto tienes con ${nombre}:\n`+match.map(p=>`• ${p.titulo} — ${estadoVisualProceso(p).label}`).join('\n')
  }
  if(/urgente|es urgente/.test(q)){
    if(!urgentes.length) return 'No tienes nada urgente en este momento 🎉'
    return `Tienes ${urgentes.length} urgente(s):\n`+urgentes.slice(0,5).map(p=>`• ${p.titulo}`).join('\n')
  }
  if(/vence pronto|por vencer|se atras/.test(q)){
    if(!vencenPronto.length) return 'Nada está por vencer en los próximos días.'
    return 'Esto vence pronto:\n'+vencenPronto.slice(0,5).map(p=>`• ${p.titulo} — vence ${p.fechaLimite}`).join('\n')
  }
  if(/qu[eé] (tengo pendiente|debo hacer|deber[ií]a hacer)|resum|plan del d[ií]a/.test(q)){
    return `Hoy tienes:\n🔴 ${urgentes.length} urgente(s)\n🟠 ${requierenResp.length} requieren tu respuesta\n🔵 ${esperando.length} esperando respuesta\n🟣 ${sinRespuesta.length} sin respuesta hace días\n🟡 ${vencenPronto.length} por vencer pronto`
  }
  if(/seguimiento/.test(q)){
    const prox = seguimientosFlat.filter(s=>['PENDIENTE','PROXIMO','VENCIDO'].includes(s.estado))
    if(!prox.length) return 'No tienes seguimientos programados por ahora.'
    return 'Tus seguimientos:\n'+prox.slice(0,5).map(s=>`• ${s.titulo} — ${s.fecha}${s.estado==='VENCIDO'?' (vencido)':''}`).join('\n')
  }
  const recM = q.match(/recu[eé]rdame (.+)/)
  if(recM) return `__RECORDATORIO__${recM[1]}`
  return `No estoy segur@ de haber entendido bien, pero esto es lo más importante ahora mismo:\n🔴 ${urgentes.length} urgentes • 🟠 ${requierenResp.length} requieren tu respuesta • 🔵 ${esperando.length} esperando respuesta.`
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
  const [tareasPage,setTareasPage]=useState(1)
  const [tareasPageSize,setTareasPageSize]=useState(10)
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

  // --- "Mi Asistente": rediseño completo pedido por el Señor (documento de
  // 63 secciones) — mismo proyecto, mismos datos reales, nueva capa de
  // estado para lo que antes no existía: correos archivados (de verdad, no
  // borrados), configuración de la persona, y el panel de chat real del
  // "Asistente personal". Todo se guarda por cuenta (session.email) para
  // que las 4 personas que usan la app no se pisen el localStorage entre sí.
  const [archivados,setArchivados]=useState([]) // correos archivados — visibles en la pestaña Archivados, nunca se pierden
  const [configuracion,setConfiguracion]=useState(()=>{
    try{ return {intervencion:'normal', horarioInicio:'08:00', horarioFin:'18:00', avisoDiasVencePronto:2, avisoDiasSeguimiento:3, ...JSON.parse(localStorage.getItem('mi_asistente_config')||'{}')} }
    catch{ return {intervencion:'normal', horarioInicio:'08:00', horarioFin:'18:00', avisoDiasVencePronto:2, avisoDiasSeguimiento:3} }
  })
  const [chatOpen,setChatOpen]=useState(false)
  const [chatInput,setChatInput]=useState('')
  const [chatMessages,setChatMessages]=useState(()=>[{ de:'asistente', texto:'Hola 👋 Soy tu asistente. Pregúntame cosas como "¿quién no me ha respondido?" o "recuérdame llamar a Juan mañana".' }])
  const [chatEnviando,setChatEnviando]=useState(false)
  const [mailMenuAbierto,setMailMenuAbierto]=useState(null) // id del correo con el menú kebab abierto
  const [ordenBandeja,setOrdenBandeja]=useState('URGENCIA') // URGENCIA | RECIENTE
  const [busquedaTop,setBusquedaTop]=useState('') // buscador del topbar (mockup) — busca en asunto/remitente/cuerpo
  const [recordatoriosGenerales,setRecordatoriosGenerales]=useState([]) // "recuérdame X" que no calzó con ningún contacto/tarea existente
  const [calFecha,setCalFecha]=useState(()=> new Date()) // mes visible en el calendario estilo Google

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

  // Archivados y configuración se guardan por cuenta, no globales — así 4
  // personas usando la misma app en el mismo navegador (demo) no ven lo del
  // otro. Se cargan apenas se conoce el email de la sesión.
  useEffect(()=>{
    if(!session?.email) return
    try{ setArchivados(JSON.parse(localStorage.getItem(`mi_asistente_archivados_${session.email}`)||'[]')) }catch{ setArchivados([]) }
    try{ setConfiguracion(c=>({...c, ...JSON.parse(localStorage.getItem(`mi_asistente_config_${session.email}`)||'{}')})) }catch{}
    try{ setRecordatoriosGenerales(JSON.parse(localStorage.getItem(`mi_asistente_recordatorios_${session.email}`)||'[]')) }catch{ setRecordatoriosGenerales([]) }
  },[session?.email])
  useEffect(()=>{
    if(!session?.email) return
    try{ localStorage.setItem(`mi_asistente_archivados_${session.email}`, JSON.stringify(archivados.slice(0,300))) }catch{}
  },[archivados,session?.email])
  useEffect(()=>{
    if(!session?.email) return
    try{ localStorage.setItem(`mi_asistente_config_${session.email}`, JSON.stringify(configuracion)) }catch{}
  },[configuracion,session?.email])
  useEffect(()=>{
    if(!session?.email) return
    try{ localStorage.setItem(`mi_asistente_recordatorios_${session.email}`, JSON.stringify(recordatoriosGenerales.slice(0,200))) }catch{}
  },[recordatoriosGenerales,session?.email])

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
  // paginación tareas — evita lista infinita tosca
  // al cambiar filtros vuelve a pág 1 automáticamente
  useEffect(()=>{ setTareasPage(1) },[filtro])
  const tareasTotalPages = Math.max(1, Math.ceil(filtrados.length / tareasPageSize))
  const tareasPaginados = useMemo(()=> filtrados.slice((tareasPage-1)*tareasPageSize, tareasPage*tareasPageSize),[filtrados, tareasPage, tareasPageSize])
  useEffect(()=>{ if(tareasPage>tareasTotalPages) setTareasPage(tareasTotalPages) },[tareasTotalPages, tareasPage])

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
  // --- Chat real del "Asistente personal" (sección 15/43): pregunta en
  // lenguaje natural → responderChatIA cruza los datos reales de la sesión.
  // Si detecta "recuérdame X", intenta engancharlo a la tarea/contacto que
  // mejor calce por nombre; si no encuentra nada, igual lo guarda como
  // recordatorio general — nunca se pierde lo que la persona pidió recordar.
  function enviarPreguntaChat(textoForzado){
    const pregunta = (textoForzado ?? chatInput).trim()
    if(!pregunta || chatEnviando) return
    setChatMessages(m=>[...m, {de:'usuario', texto:pregunta}])
    setChatInput('')
    setChatEnviando(true)
    setTimeout(()=>{
      const activos = procesos.filter(p=>!['COMPLETADO','CERRADO','CANCELADO'].includes(p.estado))
      const respuesta = responderChatIA(pregunta, { procesos: activos, seguimientosFlat })
      if(respuesta.startsWith('__RECORDATORIO__')){
        const texto = respuesta.replace('__RECORDATORIO__','')
        const fecha = parsearFechaNatural(texto)
        const match = activos.find(p=> texto.toLowerCase().includes((p.responsable||'###').toLowerCase()) && p.responsable)
        if(match){
          const seguimientos = [...(match.seguimientos||[]), {fecha, nota:texto}]
          updateProceso(match.id,{seguimientos})
          if(sel?.id===match.id) setSel(s=>s?{...s,seguimientos}:s)
          setChatMessages(m=>[...m, {de:'asistente', texto:`Anotado ✅ — te lo recuerdo el ${fecha} sobre "${match.titulo}".`}])
        } else {
          setRecordatoriosGenerales(r=>[{id:`rec-${Date.now()}`, texto, fecha, creado:new Date().toISOString()}, ...r])
          setChatMessages(m=>[...m, {de:'asistente', texto:`Anotado ✅ — te lo recuerdo el ${fecha}: "${texto}".`}])
        }
        showToast('🔔 Recordatorio guardado')
      } else {
        setChatMessages(m=>[...m, {de:'asistente', texto:respuesta}])
      }
      setChatEnviando(false)
    }, 350) // pequeña pausa: se siente "pensando" en vez de una respuesta instantánea y fría
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
          <div className="mailrow-preview">{correo.cuerpo.slice(0,110)}</div>
        </div>
        <div className="mailrow-right" onClick={e=>e.stopPropagation()}>
          <Pill color={pr.color}>{pr.label}</Pill>
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
            </div>
          )}
        </div>
      </div>
    )
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
      <Toast msg={toast} onClose={()=>setToast('')} />
      <header className="topbar">
        <div className="brand">
          <div className="logo"><Sparkles size={20} strokeWidth={2.2}/></div>
          <div><div className="brand-title">Mi Asistente</div><div className="brand-sub">Tu correo, en buenas manos</div></div>
        </div>
        <form className="topbar-search" onSubmit={e=>{e.preventDefault(); if(!busquedaTop.trim())return; setInboxFiltro(f=>({...f,q:busquedaTop,tab:'TODOS'})); setTab('inbox')}}>
          <Search size={15}/>
          <input value={busquedaTop} onChange={e=>setBusquedaTop(e.target.value)} placeholder="Buscar correos, personas, temas…"/>
        </form>
        <div className="top-actions">
          <button
            className="gmail-pill"
            onClick={()=> gmailConectado ? handleSync() : session.firebase ? handleRealConnect({name:session.nombre, email:session.email}) : handleSync()}
            title={gmailConectado ? 'Sincronizar Gmail' : 'Conectar Gmail real'}
          >
            <Mail size={14}/>
            <span className="dot" style={{background:loading?'#f59e0b':(gmailConectado?'#18875F':session.firebase?'#2563eb':'#94a3b8')}}/>
            <span>{syncing?'Sincronizando…':gmailConectado?'Conectado':session.firebase?'Conectar Gmail':'Modo demo'}</span>
          </button>
          <button className="bell-btn" onClick={()=>{setTab('inbox'); setInboxFiltro(f=>({...f,tab:'URGENTES'}))}} title="Correos urgentes" aria-label="Notificaciones">
            <Bell size={17}/>
            {(stats.crit+stats.venc)>0 && <span className="bell-badge">{stats.crit+stats.venc}</span>}
          </button>
          <div className="user-menu">
            <button className="user-chip" onClick={()=>setMenuOpen(o=>!o)} aria-label="Cuenta" aria-expanded={menuOpen}>
              <span className="avatar">{iniciales(session.nombre)}</span>
              <span style={{textAlign:'left'}}>
                <span className="user-chip-name" style={{display:'block'}}>{session.nombre}</span>
                <span className="user-chip-role">{gmailConectado?'Gmail conectado':session.firebase?'Google':'Demostración'}</span>
              </span>
              <span style={{color:'var(--muted)',display:'flex'}}><ChevronDown size={14}/></span>
            </button>
            {menuOpen && (
              <div className="user-menu-pop">
                <div style={{fontWeight:800,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{session.nombre}</div>
                <div style={{fontSize:12,color:'var(--muted)',margin:'2px 0 8px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{session.email}</div>
                <Pill color={gmailConectado?'green':session.firebase?'blue':'gray'}>{gmailConectado?'Gmail real conectado':session.firebase?'Google — Gmail sin conectar':'Modo demostración'}</Pill>
                {session.firebase && !gmailConectado && (
                  <button className="btn sm" style={{width:'100%',marginTop:8,justifyContent:'center'}} onClick={()=>handleRealConnect({name:session.nombre, email:session.email})}>Conectar mi Gmail real</button>
                )}
                <button className="btn sm ghost" style={{width:'100%',marginTop:8,justifyContent:'center'}} onClick={handleSync}>{syncing?'Sincronizando…':'🔄 Sincronizar ahora'}</button>
                <button className="btn sm ghost" style={{width:'100%',marginTop:8,justifyContent:'center'}} onClick={()=>setTheme(theme==='light'?'dark':'light')}>{theme==='light'?'🌙 Modo oscuro':'☀️ Modo claro'}</button>
                <button className="btn sm ghost" style={{width:'100%',marginTop:8,justifyContent:'center'}} onClick={handleLogout}>Cerrar sesión</button>
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

      <div className={`layout ${tab==='dashboard'?'con-asistente':''}`}>
        <nav className="sidebar">
          {[
            {k:'dashboard',label:'Inicio'},
            {k:'inbox',label:'Bandeja inteligente',badge:correos.length},
            {k:'seguimientos',label:'Seguimientos',badge:seguimientosFlat.filter(s=>['PENDIENTE','PROXIMO','VENCIDO'].includes(s.estado)).length},
            {k:'procesos',label:'Tareas',badge:stats.total},
            {k:'calendario',label:'Calendario'},
            {k:'contactos',label:'Contactos'},
            {k:'configuracion',label:'Configuración'},
          ].map(it=>{
            const Icon = NAV_ICONS[it.k]
            return (
              <button key={it.k} className={`nav-item ${tab===it.k?'active':''}`} onClick={()=>setTab(it.k)}>
                <span className="nav-icon"><Icon size={17} strokeWidth={2.1}/></span><b style={{flex:1}}>{it.label}</b>{it.badge>0 && <span className="nav-badge">{it.badge}</span>}
              </button>
            )
          })}
          <div className="sidebar-card" style={{marginTop:8}}>
            <div className="sc-title"><Bot size={15}/> Tu asistente personal de correo</div>
            <div className="sc-desc">Analizo, organizo y te recuerdo lo importante. Tú solo actúa.</div>
            <button className="btn sm" style={{width:'100%',marginTop:10,justifyContent:'center',background:'rgba(255,255,255,0.12)',border:'1px solid rgba(255,255,255,0.18)',color:'#fff',boxShadow:'none'}} onClick={()=>setTab('configuracion')}><Settings size={13}/> Configurar asistente</button>
          </div>
          <div className="sidebar-tagline"><Leaf size={13} style={{marginBottom:-2}}/> Más enfoque,<br/>menos correos.</div>
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

              {/* Saludo, con fecha y una frase corta — como el mockup */}
              <div className="asistente-saludo" style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12}}>
                <div>
                  <div className="asistente-saludo-hola">{saludoPorHora()}, {session.nombre?.split(' ')[0]||'👋'}</div>
                  <div style={{fontSize:12.5,color:'var(--muted)',marginTop:2}}>Aquí tienes un resumen de lo más importante en tu correo hoy.</div>
                </div>
                <div style={{textAlign:'right',fontSize:12,color:'var(--muted)'}}>
                  <div style={{fontWeight:700}}>{new Date().toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div>
                  <div style={{fontStyle:'italic',marginTop:2}}>"Más enfoque, menos correos."</div>
                </div>
              </div>

              {/* 4 tarjetas KPI del mockup, con delta real "desde ayer" —
                  nunca inventado: se compara contra la foto guardada el día
                  anterior en localStorage (ver kpiAyer/kpiHoy más arriba). */}
              <div className="kpi-mockup-grid">
                {[
                  {campo:'requierenRespuesta', label:'Requieren tu respuesta', valor:kpiHoy.requierenRespuesta, color:'red', icon:Mail, irA:()=>{setTab('inbox'); setInboxFiltro(f=>({...f,tab:'ACCION'}))}},
                  {campo:'esperandoRespuesta', label:'Esperando respuesta', valor:kpiHoy.esperandoRespuesta, color:'blue', icon:CornerUpLeft, irA:()=>setTab('seguimientos')},
                  {campo:'seguimientos', label:'Seguimientos', valor:kpiHoy.seguimientos, color:'green', icon:Clock, irA:()=>setTab('seguimientos')},
                  {campo:'tareas', label:'Tareas', valor:kpiHoy.tareas, color:'purple', icon:CheckSquare, irA:()=>setTab('procesos')},
                ].map(k=>{
                  const d = kpiDelta(k.campo)
                  const KpiIcon = k.icon
                  return (
                    <button key={k.campo} className={`kpi-mockup-card kpi-${k.color}`} onClick={k.irA}>
                      <div className="kpi-mockup-top">
                        <span className="kpi-mockup-icon"><KpiIcon size={17} strokeWidth={2.2}/></span>
                        <span className="kpi-mockup-chevron"><ChevronRight size={16}/></span>
                      </div>
                      <div className="kpi-mockup-label">{k.label}</div>
                      <div className="kpi-mockup-valor">{k.valor}</div>
                      <div className={`kpi-mockup-delta ${d==null?'':d>0?'up':d<0?'down':'flat'}`}>{d==null?'Sin datos de ayer aún':d===0?'Igual que ayer':`${d>0?'↑':'↓'} ${Math.abs(d)} desde ayer`}</div>
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
              </div>
              <div className="tareas-card">
                <div className="tareas-card-head">
                  <div className="tareas-count">
                    <b>{filtrados.length}</b> tarea{filtrados.length===1?'':'s'} {filtro.q || filtro.prior!=='TODAS' || filtro.estado!=='TODOS' || filtro.area!=='TODAS' ? 'filtradas' : 'en total'}
                    <span className="mono" style={{fontWeight:400,color:'var(--muted)'}}> • mostrando {(tareasPage-1)*tareasPageSize+1}-{Math.min(tareasPage*tareasPageSize, filtrados.length)} • pág {tareasPage}/{tareasTotalPages}</span>
                  </div>
                  <div className="tareas-head-actions">
                    <label className="tareas-perpage">Filas:
                      <select value={tareasPageSize} onChange={e=>{setTareasPageSize(Number(e.target.value)); setTareasPage(1)}}>
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div className="table-wrap" style={{padding:0, borderBottom:0, borderRadius:'12px 12px 0 0'}}>
                <table className="table tareas-table">
                  <thead><tr><th>Tarea</th><th>Estado</th><th>Etapa</th><th>Vence</th><th>Retraso</th><th></th></tr></thead>
                  <tbody>
                    {tareasPaginados.map(p=>(
                      <tr key={p.id} className={sel?.id===p.id?'sel':''} onClick={()=>setSel(p)} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); setSel(p) } }} tabIndex={0} aria-selected={sel?.id===p.id} style={{cursor:'pointer'}}>
                        <td><div style={{display:'flex',alignItems:'center',gap:6}}><PrioridadDot n={p.prioridad}/><div style={{fontWeight:700,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:300}}>{p.titulo}</div></div><div className="mono" style={{fontSize:11,color:'var(--muted)'}}>{p.id} • {p.area} • {p.categoria}</div>
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
                {!tareasPaginados.length && !!filtrados.length && <div className="empty-state">Sin resultados en esta página — vuelva a la primera.</div>}
                </div>
                <div className="tareas-pagination">
                  <button className="tareas-page-btn" disabled={tareasPage<=1} onClick={()=> setTareasPage(p=> Math.max(1,p-1))}><ChevronLeft size={16}/> Anterior</button>
                  <div className="tareas-pages">
                    {Array.from({length: tareasTotalPages},(_,i)=> i+1).slice(Math.max(0, tareasPage-3), Math.max(0, tareasPage-3)+5).map(n=>(
                      <button key={n} className={`tareas-page-num ${n===tareasPage?'active':''}`} onClick={()=> setTareasPage(n)}>{n}</button>
                    ))}
                    {tareasTotalPages>5 && tareasPage < tareasTotalPages-2 && <span className="tareas-ellipsis">… {tareasTotalPages}</span>}
                  </div>
                  <button className="tareas-page-btn" disabled={tareasPage>=tareasTotalPages} onClick={()=> setTareasPage(p=> Math.min(tareasTotalPages,p+1))}>Siguiente <ChevronRight size={16}/></button>
                </div>
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

          {tab==='contactos' && (
            <div className="card">
              <div className="card-head"><h3>👤 Contactos</h3><span className="mono" style={{fontSize:11,color:'var(--muted)'}}>{contactosDerivados.length} persona(s)</span></div>
              <div style={{fontSize:11,color:'var(--muted)',margin:'-6px 0 10px'}}>Se arman solos con quién te ha escrito de verdad — nadie se agrega a mano.</div>
              {!contactosDerivados.length ? (
                <div style={{padding:'24px 8px',color:'var(--muted)',fontSize:13}}>Todavía no hay correos suficientes para armar contactos.</div>
              ) : (
                <div className="table-wrap"><table className="table"><thead><tr><th>Contacto</th><th>Empresa</th><th>Conversaciones</th><th>Pendiente</th><th>Última actividad</th><th>Temas</th></tr></thead><tbody>
                  {contactosDerivados.map(c=>(
                    <tr key={c.email}>
                      <td style={{fontSize:12}}><b>{c.nombre}</b><div className="mono" style={{fontSize:10.5,color:'var(--muted)'}}>{c.email}</div></td>
                      <td style={{fontSize:12}}>{c.empresa}</td>
                      <td style={{fontSize:12}}>{c.conversaciones}</td>
                      <td style={{fontSize:12}}>{c.pendientes>0 && <Pill color="orange">{c.pendientes} tuyo</Pill>}{' '}{c.esperando>0 && <Pill color="blue">{c.esperando} de él/ella</Pill>}{!c.pendientes && !c.esperando && '—'}</td>
                      <td style={{fontSize:12}}>{c.ultima?.slice(0,10)||'—'}</td>
                      <td style={{fontSize:11,color:'var(--muted)'}}>{c.temas.join(' • ')}</td>
                    </tr>
                  ))}
                </tbody></table></div>
              )}
            </div>
          )}

          {tab==='calendario' && (
            <div className="gcal-wrapper">
              {/* Toolbar estilo Google Calendar */}
              <div className="gcal-toolbar">
                <div className="gcal-toolbar-left">
                  <button className="gcal-today-btn" onClick={()=> setCalFecha(new Date())}>Hoy</button>
                  <div className="gcal-nav-arrows">
                    <button className="gcal-arrow" aria-label="Mes anterior" onClick={()=> setCalFecha(d=> new Date(d.getFullYear(), d.getMonth()-1, 1))}><ChevronLeft size={18}/></button>
                    <button className="gcal-arrow" aria-label="Mes siguiente" onClick={()=> setCalFecha(d=> new Date(d.getFullYear(), d.getMonth()+1, 1))}><ChevronRight size={18}/></button>
                  </div>
                  <div className="gcal-month-title">{calFecha.toLocaleDateString('es-CO',{month:'long', year:'numeric'})}</div>
                </div>
                <div className="gcal-toolbar-right">
                  <div className="gcal-legend">
                    <span className="gcal-legend-item"><span className="gcal-legend-dot" style={{background:'#DC2626'}}/> Vence</span>
                    <span className="gcal-legend-item"><span className="gcal-legend-dot" style={{background:'#2563EB'}}/> Seguimiento</span>
                    <span className="gcal-legend-item"><span className="gcal-legend-dot" style={{background:'#7C3AED'}}/> Recordatorio</span>
                  </div>
                  <span className="gcal-view-pill">Mes</span>
                </div>
              </div>

              {(()=>{
                const y = calFecha.getFullYear(), m = calFecha.getMonth()
                const hoyISO = fechaLocalISO()
                const firstDayRaw = new Date(y, m, 1).getDay() // 0 dom
                const firstDay = (firstDayRaw + 6) % 7 // 0 lun
                const daysInMonth = new Date(y, m+1, 0).getDate()
                const daysPrev = new Date(y, m, 0).getDate()
                const cells = []
                for(let i=0;i<42;i++){
                  let day, isOther
                  if(i < firstDay){ day = daysPrev - firstDay + 1 + i; isOther = true; cells.push({y: m===0? y-1:y, m: m===0?11:m-1, d:day, isOther}) }
                  else if(i >= firstDay + daysInMonth){ day = i - firstDay - daysInMonth + 1; isOther = true; cells.push({y: m===11? y+1:y, m: m===11?0:m+1, d:day, isOther}) }
                  else { day = i - firstDay + 1; cells.push({y, m, d:day, isOther:false}) }
                }
                const eventosPorFecha = {}
                procesos.filter(p=>!['COMPLETADO','CERRADO','CANCELADO'].includes(p.estado) && p.fechaLimite).forEach(p=>{
                  const k = p.fechaLimite
                  if(!eventosPorFecha[k]) eventosPorFecha[k]=[]
                  const vencido = k < hoyISO
                  eventosPorFecha[k].push({ tipo:'VENCE', titulo:p.titulo, id:p.id, color: vencido? '#DC2626' : (p.prioridad==='CRITICA'?'#DC2626': p.prioridad==='ALTA'?'#D97706':'#18875F') })
                })
                seguimientosFlat.filter(s=>!['COMPLETADO','CANCELADO'].includes(s.estado) && s.fecha).forEach(s=>{
                  const k = s.fecha
                  if(!eventosPorFecha[k]) eventosPorFecha[k]=[]
                  eventosPorFecha[k].push({ tipo:'SEGUIMIENTO', titulo:s.titulo, id:s.procesoId, color:'#2563EB' })
                })
                // recordatorios generales también aparecen
                recordatoriosGenerales.forEach(r=>{
                  const k = r.fecha
                  if(!eventosPorFecha[k]) eventosPorFecha[k]=[]
                  eventosPorFecha[k].push({ tipo:'RECORDATORIO', titulo:r.texto, id:r.id, color:'#7C3AED' })
                })
                const weekDays = ['LUN','MAR','MIÉ','JUE','VIE','SÁB','DOM']
                const sortedDates = Object.keys(eventosPorFecha).filter(d=>{ const dt=new Date(d+'T00:00:00'); return dt.getFullYear()===y && dt.getMonth()===m }).sort()
                const totalMes = sortedDates.reduce((s,d)=> s + eventosPorFecha[d].length, 0)
                return (
                  <div className="gcal-layout">
                    <div className="gcal-card">
                      <div className="gcal-week-head">
                        {weekDays.map(w=> <div key={w} className={`gcal-week-day ${w==='SÁB'||w==='DOM'?'weekend':''}`}>{w}</div>)}
                      </div>
                      <div className="gcal-grid">
                        {cells.map((c,i)=>{
                          const iso = `${c.y}-${String(c.m+1).padStart(2,'0')}-${String(c.d).padStart(2,'0')}`
                          const isToday = iso===hoyISO
                          const evts = eventosPorFecha[iso] || []
                          const isWeekend = (i%7===5 || i%7===6)
                          const hasEvents = evts.length>0
                          return (
                            <div key={i} className={`gcal-cell ${c.isOther?'other':''} ${isWeekend?'weekend':''} ${isToday?'today':''} ${hasEvents?'has-events':''}`}>
                              <div className="gcal-date-row">
                                {isToday ? <span className="gcal-today-circle">{c.d}</span> : <span className="gcal-date-num">{c.d}</span>}
                              </div>
                              <div className="gcal-events">
                                {evts.slice(0,3).map((e,idx)=>{
                                  const cls = e.tipo==='VENCE' && e.color==='#DC2626' ? ' vencido' : e.tipo==='SEGUIMIENTO' ? ' seguimiento' : ''
                                  return (
                                    <div key={idx} className={`gcal-event${cls}`} style={{background: e.color}} title={`${e.tipo}: ${e.titulo}`} onClick={()=>{ const p=procesos.find(x=>x.id===e.id); if(p){ setSel(p); setTab('procesos') } else if(e.tipo==='SEGUIMIENTO'){ setTab('seguimientos') } }}>
                                      <span className="gcal-event-dot"/>
                                      {e.titulo.slice(0,24)}
                                    </div>
                                  )
                                })}
                                {evts.length>3 && <div className="gcal-more" onClick={()=>{ /* mostrar todos */ }}>+{evts.length-3} más</div>}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    <div className="gcal-side">
                      <div className="gcal-mini-card">
                        <div className="gcal-mini-head">
                          <span className="gcal-mini-title"><Calendar size={14}/> Agenda de {calFecha.toLocaleDateString('es-CO',{month:'long'})}</span>
                          <span className="gcal-mini-count">{totalMes? `${totalMes} eventos` : '0 eventos'}</span>
                        </div>
                        <div className="gcal-agenda">
                          {!sortedDates.length ? (
                            <div className="gcal-agenda-empty">
                              <b>Mes tranquilo ✨</b>
                              No hay vencimientos ni seguimientos este mes.
                              <div style={{marginTop:8,fontSize:11}}>Los eventos aparecerán aquí y en el grid automáticamente.</div>
                            </div>
                          ) : (
                            sortedDates.slice(0,12).map(d=> {
                              const isTodayRow = d===hoyISO
                              return (
                                <div key={d} className="gcal-agenda-row">
                                  <div className="gcal-agenda-date">
                                    <span className="gcal-agenda-dow">{new Date(d+'T00:00:00').toLocaleDateString('es-CO',{weekday:'short'})}</span>
                                    <span className={`gcal-agenda-day ${isTodayRow?'today':''}`}>{d.slice(8,10)}</span>
                                  </div>
                                  <div className="gcal-agenda-events">
                                    {eventosPorFecha[d].map((e,ii)=>(
                                      <div key={ii} className="gcal-agenda-chip" style={{borderLeftColor:e.color}} onClick={()=>{ const p=procesos.find(x=>x.id===e.id); if(p){ setSel(p); setTab('procesos') } }}>
                                        <span className="gcal-agenda-dot" style={{background:e.color}}/>
                                        <span className="gcal-agenda-title">{e.titulo}</span>
                                        <span className="gcal-agenda-type">{e.tipo==='VENCE'?'Vence': e.tipo==='SEGUIMIENTO'?'Seguimiento':'Recordatorio'}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )
                            })
                          )}
                        </div>
                        {sortedDates.length>0 && (
                          <div className="gcal-mini-footer">
                            <button className="btn sm ghost" style={{flex:1, justifyContent:'center', fontSize:12}} onClick={()=> setTab('procesos')}><Clock size={13}/> Ver todas las tareas</button>
                          </div>
                        )}
                      </div>

                      <div className="gcal-mini-card" style={{padding:'14px 16px'}}>
                        <div style={{fontSize:12,fontWeight:700,marginBottom:8,display:'flex',alignItems:'center',gap:6}}><Clock size={13}/> Cómo funciona</div>
                        <div style={{fontSize:11.5,color:'var(--muted)',lineHeight:1.6}}>
                          Este calendario se alimenta solo de tus <b style={{color:'var(--text)'}}>tareas</b> (fecha límite) y <b style={{color:'var(--text)'}}>seguimientos</b>. Cambia de mes con las flechas — todo es clickeable para ir al detalle.
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          )}


          {tab==='configuracion' && (
            <div className="card">
              <div className="card-head"><h3>⚙️ Configuración</h3></div>
              <div style={{fontSize:11,color:'var(--muted)',margin:'-6px 0 16px'}}>Tu asistente, a tu manera — estos ajustes se guardan en este navegador para tu cuenta ({session.email}).</div>
              <div style={{display:'grid',gap:16,maxWidth:480}}>
                <label style={{display:'grid',gap:6}}>
                  <span style={{fontWeight:700,fontSize:12}}>Nivel de intervención</span>
                  <select className="input" value={configuracion.intervencion} onChange={e=>setConfiguracion(c=>({...c,intervencion:e.target.value}))}>
                    <option value="minimo">Mínimo — solo avisar lo urgente</option>
                    <option value="normal">Normal — avisar y sugerir</option>
                    <option value="proactivo">Proactivo — recordar seguido y sugerir respuestas</option>
                  </select>
                </label>
                <div style={{display:'flex',gap:12}}>
                  <label style={{display:'grid',gap:6,flex:1}}>
                    <span style={{fontWeight:700,fontSize:12}}>Horario — desde</span>
                    <input className="input" type="time" value={configuracion.horarioInicio} onChange={e=>setConfiguracion(c=>({...c,horarioInicio:e.target.value}))}/>
                  </label>
                  <label style={{display:'grid',gap:6,flex:1}}>
                    <span style={{fontWeight:700,fontSize:12}}>Horario — hasta</span>
                    <input className="input" type="time" value={configuracion.horarioFin} onChange={e=>setConfiguracion(c=>({...c,horarioFin:e.target.value}))}/>
                  </label>
                </div>
                <label style={{display:'grid',gap:6}}>
                  <span style={{fontWeight:700,fontSize:12}}>Avisar "vence pronto" con cuántos días de anticipación</span>
                  <input className="input" type="number" min={1} max={7} value={configuracion.avisoDiasVencePronto} onChange={e=>setConfiguracion(c=>({...c,avisoDiasVencePronto:Number(e.target.value)||1}))}/>
                </label>
                <label style={{display:'grid',gap:6}}>
                  <span style={{fontWeight:700,fontSize:12}}>Avisar "sin respuesta" tras cuántos días esperando</span>
                  <input className="input" type="number" min={1} max={14} value={configuracion.avisoDiasSeguimiento} onChange={e=>setConfiguracion(c=>({...c,avisoDiasSeguimiento:Number(e.target.value)||1}))}/>
                </label>
                <div style={{fontSize:11,color:'var(--muted)'}}>💡 Estos dos últimos ajustes se guardan aquí; próximamente alimentan directamente los umbrales de "vence pronto"/"necesita seguimiento" del panel Hoy.</div>
                <div style={{fontSize:12,color:'var(--muted)',display:'flex',alignItems:'center',gap:10,background:'var(--bg2)',padding:'10px 12px',borderRadius:10}}>
                  <b style={{color:'var(--text)'}}>Confianza de la IA: {confianzaProm==null?'—':`${confianzaProm}%`}</b>
                  <span>95-100 automático • 80-94 revisión • &lt;60 no actuar sin revisar</span>
                </div>
                <button className="btn sm ghost" style={{width:'fit-content'}} onClick={()=>exportarCSV(procesos)}>⬇️ Descargar todas tus tareas en Excel</button>
                {session.firebase && (
                  <button className="btn sm ghost" style={{width:'fit-content'}} title="Borra los 6 procesos de ejemplo (María López, Juan Pérez, Carlos Ruiz…) si quedaron guardados en Firestore por versiones anteriores de la app" onClick={async()=>{
                    const r = await limpiarDatosDeEjemploFirestore()
                    if(r.ok) showToast(`🧹 Datos de ejemplo eliminados de Firestore (${r.borrados})`)
                    else showToast('⚠️ '+(r.razon||'No se pudo limpiar'))
                  }}>🧹 Limpiar datos de ejemplo (Firestore)</button>
                )}
              </div>
              <div style={{marginTop:22,paddingTop:18,borderTop:'1px solid var(--border)'}}>
                <div className="card-head" style={{border:0,paddingBottom:8}}>
                  <h3 style={{fontSize:14}}>🛡️ Historial — todo lo que se ha hecho</h3>
                  <span className="mono" style={{fontSize:11,color:'var(--muted)'}}>Nada se envía ni se cierra sin que quede aquí</span>
                </div>
                <div style={{display:'grid',gap:8}}>
                  {(()=>{
                    const log = getAuditLog()
                    const etiqueta = {
                      sync_gmail:'🔄 Sincronizó Gmail',
                      enviar_respuesta:'✉️ Envió una respuesta',
                      reenvio:'↪️ Preparó un reenvío',
                      reply_ready:'✅ Marcó un proceso listo para responder',
                      proceso_listo:'✅ Marcó un proceso como listo',
                      exportar_csv:'⬇️ Descargó tareas en Excel',
                      sheets_sync:'↗️ Sincronizó a Google Sheets',
                    }
                    if(!log.length) return <div className="empty-state">Aún no hay acciones registradas. Aparecerán aquí en cuanto sincronice Gmail o responda un correo.</div>
                    return log.slice(0,15).map((r,i)=>(
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
            </div>
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
                <div><b>Asistente personal</b><small>Siempre pendiente de lo importante</small></div>
              </div>
              <div style={{maxHeight:220,overflowY:'auto',marginBottom:4}}>
                {chatMessages.map((m,i)=>(
                  <div key={i} className={`chat-msg chat-${m.de}`}>{m.texto.split('\n').map((l,j)=><div key={j}>{l}</div>)}</div>
                ))}
                {chatEnviando && <div className="chat-msg chat-asistente">…</div>}
              </div>
              <div className="asis-quick-grid">
                <button className="asis-quick-btn" onClick={()=>enviarPreguntaChat('¿qué tengo pendiente?')}><ListChecks size={14}/> Ver resumen</button>
                <button className="asis-quick-btn" onClick={()=>{setTab('inbox'); setInboxFiltro(f=>({...f,tab:'ACCION'}))}}><CheckSquare size={14}/> Revisar pendientes</button>
                <button className="asis-quick-btn" onClick={()=>setTab('seguimientos')}><RefreshCw size={14}/> Crear seguimiento</button>
                <button className="asis-quick-btn" onClick={()=>setTab('calendario')}><CalendarPlus size={14}/> Programar en calendario</button>
              </div>
              <form className="asis-input-row" onSubmit={e=>{e.preventDefault(); enviarPreguntaChat()}}>
                <input className="input" value={chatInput} onChange={e=>setChatInput(e.target.value)} placeholder="Pregúntame algo…"/>
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


