import { estadoEfectivo, diasEntre, necesitaSeguimiento, porVencerPronto, fechaLocalISO } from './dateUtils.js'

// Traduce la jerga de la IA a frases simples — para que la Coordinadora entienda
// de un vistazo qué pasa con el correo, sin tener que interpretar códigos ni puntajes.
export function explicarTipo(tipo){
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

export function explicarTurno(a){
  return a.turno.accionEsperadaDe==='COORDINADORA'
    ? 'Le toca responder a usted.'
    : 'Ya quedó en manos de la otra persona — solo debe esperar.'
}

// La tabla de "Mis Tareas" mostraba el código interno crudo del motor en la
// columna Etapa (RESPUESTA_GENERAL, FINALIZACION, CONFIRMACION, RECHAZO,
// "Inicial") — jerga de desarrollador que no dice nada útil a quien solo
// quiere saber en qué va su tarea. Se traduce a una frase corta y humana.
export function explicarEtapa(etapa){
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
export function formatEstado(estado){
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
export function estadoVisual({ prioridad, estadoEf, completado, esperandoOtro, sinRespuestaHace, porVencer }){
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
export function estadoVisualProceso(p){
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
export function estadoVisualCorreo(a){
  const completado = !a.relevancia.esRelevante
  return estadoVisual({
    prioridad: a.prioridad.nivel,
    estadoEf: null,
    completado,
    esperandoOtro: a.turno.accionEsperadaDe!=='COORDINADORA',
    porVencer: porVencerPronto(a.fechas.fechaCalculada, false, completado),
  })
}

// --- Kanban de Tareas (mockup): 3 columnas derivadas del MISMO campo
// `estado` real que ya usan la tabla y las métricas — no se inventa un
// campo paralelo "estadoKanban" que pudiera desincronizarse de él.
export function estadoKanban(estado){
  if(['CERRADO','COMPLETADO','CANCELADO'].includes(estado)) return 'hecho'
  if(['NUEVO','PENDIENTE','BLOQUEADO'].includes(estado)) return 'todo'
  return 'progreso' // EN_PROCESO, ESPERANDO, SEGUIMIENTO, VENCIDO, REPROGRAMADO, CON_INCIDENCIA
}
export const KANBAN_COLUMNAS = [
  {k:'todo', label:'Por hacer', estadoDestino:'PENDIENTE'},
  {k:'progreso', label:'En progreso', estadoDestino:'EN_PROCESO'},
  {k:'hecho', label:'Completadas', estadoDestino:'COMPLETADO'},
]

export function subtareasProgreso(p){
  const t = p.tareas||[]
  return { hechas: t.filter(x=>x.done).length, total: t.length }
}

// --- Seguimientos: antes vivían escondidos dentro de cada proceso
// (p.seguimientos); ahora también se ven todos juntos en una sola lista,
// como pide el documento (título, contacto, vence, prioridad, estado).
export function estadoSeguimiento(s){
  if(s.completado) return 'COMPLETADO'
  if(s.cancelado) return 'CANCELADO'
  if(s.fecha < fechaLocalISO()) return 'VENCIDO'
  if(s.fecha === fechaLocalISO()) return 'PROXIMO'
  return 'PENDIENTE'
}
