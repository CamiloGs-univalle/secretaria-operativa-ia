// mascotaEngine.js — Cerebro de la Mascota Secretaria (sec 19-23, RF-021 a RF-026)
// Implementa: estados 🟢🟡🟠🔴, recordatorio 3h, instrucciones naturales + Action Guard

export const MASCOTA_ESTADOS = {
  NORMAL: { id:'NORMAL', color:'verde', dot:'ok', emoji:'🟢', mensaje:'Sin problemas.', nivel:'INFORMATIVA' },
  INFO: { id:'INFO', color:'amarillo', dot:'info', emoji:'🟡', mensaje:'Tengo una actualización.', nivel:'ATENCION' },
  IMPORTANTE: { id:'IMPORTANTE', color:'naranja', dot:'warn', emoji:'🟠', mensaje:'Hay una tarea que deberías revisar.', nivel:'IMPORTANTE' },
  EMERGENCIA: { id:'EMERGENCIA', color:'rojo', dot:'crit', emoji:'🔴', mensaje:'Tienes un proceso vencido.', nivel:'CRITICA' },
}

// Determina estado actual basado en KPIs reales (spec 20)
export function getEstadoMascota({ procesos=[], analisis=[], stats=null }){
  const s = stats || computeStats(procesos)
  const vencidos = s.venc
  const criticas = s.crit
  const altas = s.alta
  // Emergencia: vencidos o críticas vencidas
  if(vencidos>0) return { ...MASCOTA_ESTADOS.EMERGENCIA, detalle:`${vencidos} vencido(s) • ${criticas} crítica(s)`, stats:s }
  if(criticas>0) return { ...MASCOTA_ESTADOS.EMERGENCIA, detalle:`${criticas} crítica(s) — atender ahora`, stats:s }
  if(altas>0) return { ...MASCOTA_ESTADOS.IMPORTANTE, detalle:`${altas} prioridad alta • ${s.enProc} en proceso`, stats:s }
  // Info: hay pendientes o nuevos
  const pendientes = s.enProc + s.esperando
  const noLeidos = analisis.filter(a=> a.correo?.etiquetas?.includes('UNREAD')).length
  if(pendientes>0 || noLeidos>0) return { ...MASCOTA_ESTADOS.INFO, detalle:`${pendientes} pendientes • ${noLeidos} sin leer`, stats:s }
  return { ...MASCOTA_ESTADOS.NORMAL, detalle:`${s.total} procesos al día`, stats:s }
}

function computeStats(procesos){
  return {
    crit: procesos.filter(p=>p.prioridad==='CRITICA').length,
    alta: procesos.filter(p=>p.prioridad==='ALTA').length,
    enProc: procesos.filter(p=>['EN_PROCESO','PENDIENTE','SEGUIMIENTO'].includes(p.estado)).length,
    esperando: procesos.filter(p=>p.estado==='ESPERANDO').length,
    venc: procesos.filter(p=>p.estado==='VENCIDO'||p.retraso>0).length,
    total: procesos.length,
  }
}

// Genera mensaje de recordatorio según hora (sec 21: 8:00,11:00,14:00,17:00)
export function generarRecordatorio(hora, { procesos=[], stats=null }={}){
  const s = stats || computeStats(procesos)
  const crit = s.crit, alta=s.alta, venc=s.venc, total=s.total
  const vencTxt = venc? ` ⚠️ ${venc} vencida(s)` : ''
  const map={
    8:  `¡Buenos días Coordinadora! ☀️ Resumen inicial: ${crit} críticas, ${alta} altas, ${total} procesos activos.${vencTxt} Te recomiendo empezar por las críticas.`,
    11: `Actualización 11:00 🟡 Tienes ${crit} críticas y ${s.enProc} en proceso. ${venc?`Atención: ${venc} vencida(s).`:''} ¿Avanzamos con la siguiente?`,
    14: `Revisión de la tarde 14:00 🟠 Quedan ${s.esperando} esperando respuesta externa. Recuerda dejar 30% libre para imprevistos.`,
    17: `Cierre del día 17:00 📋 Resumen: ${total} procesos, ${venc} vencidos, ${crit} críticos. ¿Marcamos algún proceso como listo?`,
  }
  return map[hora] || `Recordatorio — ${crit} críticas, ${alta} altas, ${venc} vencidas.`
}

// ============ INSTRUCCIONES NATURALES (sec 22) ============
const RE_COMPLETAR = /(ya quedó listo|ya quedo listo|ya está listo|ya esta listo|completado|terminado|ya fue realizado|ya quedó corregido|quedó solucionado|cerrar proceso|marcar.*complet)/i
const RE_REENVIAR = /(mandar a|enviar a|reenviar a|reenviarle a|mandárselo a|se lo puedes mandar|prep.*reenvío|prepar.*reenvi)/i
const RE_MANANA = /(d[eé]jalo para mañana|deja.*para mañana|para mañana|próxima acción.*mañana|mover.*mañana)/i
const RE_SEGUIMIENTO = /(hazle seguimiento|hacer seguimiento|seguimiento el|recordatorio el|avísame el|agendar seguimiento)/i
const RE_URGENTE = /(es urgente|urgente|prioridad.*crítica|prioridad.*critica|marcar.*urgente|pon.*urgente)/i

// Extrae nombre destinatario tras "a "
function extraerDestinatario(txt){
  const m = txt.match(/(?:mandar a|enviar a|reenviar a|reenviarle a|mandárselo a)\s+([A-ZÁÉÍÓÚa-záéíóú\s]+?)(?:\.|,|$)/i)
  if(m) return m[1].trim().replace(/\s+/g,' ').split(/\s+/).map(w=> w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(' ')
  // fallback: busca "a Carlos" simple
  const m2 = txt.match(/\ba\s+([A-Z][a-záéíóú]+(?:\s+[A-Z][a-záéíóú]+)?)/)
  if(m2) return m2[1].trim()
  return null
}

function parsearFechaTexto(txt){
  const lower = txt.toLowerCase()
  const hoy = new Date()
  if(/mañana/.test(lower) && !/pasado/.test(lower)){
    const d=new Date(hoy); d.setDate(d.getDate()+1); return { texto:'mañana', iso:d.toISOString().slice(0,10), label:'mañana' }
  }
  if(/pasado mañana/.test(lower)){
    const d=new Date(hoy); d.setDate(d.getDate()+2); return { texto:'pasado mañana', iso:d.toISOString().slice(0,10), label:'pasado mañana' }
  }
  // días semana
  const dias={lunes:1,martes:2,'miércoles':3,miercoles:3,jueves:4,viernes:5,sabado:6,sábado:6,domingo:0}
  for(const [nombre,num] of Object.entries(dias)){
    if(lower.includes(nombre)){
      const d=new Date(hoy); const cur=d.getDay(); let diff=(num - cur + 7)%7; if(diff===0) diff=7; d.setDate(d.getDate()+diff);
      return { texto:nombre, iso:d.toISOString().slice(0,10), label:`el ${nombre}` }
    }
  }
  if(/hoy/.test(lower)) return { texto:'hoy', iso:hoy.toISOString().slice(0,10), label:'hoy' }
  return null
}

// Motor principal: interpreta texto natural y decide acción (sec 22 + 23 Action Guard)
export function interpretarInstruccion(texto, contexto={}){
  const txt = (texto||'').trim()
  const lower = txt.toLowerCase()
  // Prioridad: urgente reenviar suele incluir "urgente", pero reenviar tiene precedencia si menciona destinatario
  const tieneDestinatario = RE_REENVIAR.test(txt)
  const fechaMencionada = parsearFechaTexto(txt)

  // 1. REENVIAR a alguien
  if(tieneDestinatario){
    const dest = extraerDestinatario(txt) || 'destinatario'
    return {
      intent:'REENVIAR',
      accion:'REENVIAR',
      destinatario: dest,
      fecha: fechaMencionada,
      descripcion:`Preparar reenvío a ${dest}`,
      requiereConfirmacion:true, // Sec 23: reenviar requiere confirmación
      nivel:'SENSIBLE',
      confianza: 0.92,
      explicacion:`Detecté que quieres reenviar "${contexto.correo?.asunto||contexto.proceso?.titulo||'este correo'}" a ${dest}. Prepararé el borrador y pediré tu confirmación (Action Guard).`,
      original: txt,
    }
  }
  // 2. COMPLETAR / ya quedó listo
  if(RE_COMPLETAR.test(txt)){
    return {
      intent:'COMPLETAR',
      accion:'COMPLETAR',
      descripcion:'Marcar proceso como posible finalización',
      requiereConfirmacion:true, // Sec 23: cerrar proceso requiere confirmación
      nivel:'SENSIBLE',
      confianza: 0.89,
      explicacion:`Entendido: "${contexto.proceso?.titulo||'este proceso'}" parece terminado. Lo marcaré como POSIBLE FINALIZACIÓN y te pediré confirmación para cerrarlo (no cierra automático, sec 18).`,
      original: txt,
    }
  }
  // 3. Déjalo para mañana (reprogramar)
  if(RE_MANANA.test(txt)){
    const fecha = fechaMencionada || parsearFechaTexto('mañana')
    return {
      intent:'REPROGRAMAR',
      accion:'REPROGRAMAR',
      fecha,
      descripcion:`Mover próxima acción a ${fecha.label}`,
      requiereConfirmacion:false, // automático per sec 23
      nivel:'AUTOMATICO',
      confianza: 0.91,
      explicacion:`Perfecto, moveré la próxima acción de "${contexto.proceso?.titulo||'este proceso'}" a ${fecha.label} (${fecha.iso}).`,
      original: txt,
    }
  }
  // 4. Hazle seguimiento el lunes
  if(RE_SEGUIMIENTO.test(txt)){
    const fecha = fechaMencionada || { texto:'próximo seguimiento', iso: null, label:'la fecha indicada' }
    return {
      intent:'SEGUIMIENTO',
      accion:'SEGUIMIENTO',
      fecha,
      descripcion:`Crear seguimiento para ${fecha.label}`,
      requiereConfirmacion:false, // registrar seguimiento es automático
      nivel:'AUTOMATICO',
      confianza: 0.88,
      explicacion:`Listo, crearé un seguimiento para ${fecha.label}${fecha.iso?` (${fecha.iso})`:''} en "${contexto.proceso?.titulo||'este proceso'}".`,
      original: txt,
    }
  }
  // 5. Es urgente
  if(RE_URGENTE.test(txt)){
    return {
      intent:'URGENTE',
      accion:'URGENTE',
      prioridad:'CRITICA',
      descripcion:'Cambiar prioridad a CRÍTICA',
      requiereConfirmacion:false, // cambiar prioridad es automático
      nivel:'AUTOMATICO',
      confianza: 0.96,
      explicacion:`Hecho, marcaré "${contexto.proceso?.titulo||'este proceso'}" como 🔴 CRÍTICA. Aparecerá arriba en “Haz estas 3 primero”.`,
      original: txt,
    }
  }
  return {
    intent:'UNKNOWN',
    accion:'UNKNOWN',
    descripcion:'No entendí la instrucción',
    requiereConfirmacion:false,
    nivel:'INFO',
    confianza: 0.0,
    explicacion:`No pude interpretar "${txt}". Prueba con: “ya quedó listo”, “mándalo a Carlos”, “déjalo para mañana”, “hazle seguimiento el lunes” o “es urgente”.`,
    original: txt,
    sugerencias: ['Este ya quedó listo','Este se lo puedes mandar a Carlos','Este déjalo para mañana','A este hazle seguimiento el lunes','Este es urgente']
  }
}

// Ejecuta la acción interpretada (llamado desde Mascota.jsx)
// Retorna { ok, auditAction, message, requiresConfirm }
export function construirAccionMascota(interpretacion, contexto){
  return interpretacion
}
