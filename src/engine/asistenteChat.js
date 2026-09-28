import { diasEntre, necesitaSeguimiento, porVencerPronto, fechaVencidaCalendario } from '../utils/dateUtils.js'
import { estadoVisualProceso } from '../utils/estadoUtils.js'

// --- El "asistente te recuerda" del mockup: un solo mensaje dinámico,
// nunca texto fijo — prioriza lo más urgente/atrasado que haya de verdad.
export function mensajeAsistente({urgentes, sinRespuesta, requierenResp, seguimientosProximos}){
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
export function responderChatIA(pregunta, ctx){
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
