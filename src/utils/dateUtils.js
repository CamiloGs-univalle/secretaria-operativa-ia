// Utilidades de fechas puras — sin dependencias de estado de React.

// Fecha LOCAL en formato YYYY-MM-DD — new Date().toISOString() usa UTC, así
// que cerca de medianoche en Colombia (UTC-5) marcaba "hoy vencen" con el día
// equivocado. fechaLimite siempre se guarda como fecha local (YYYY-MM-DD).
export function fechaLocalISO(d=new Date()){
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
export function fechaVencidaCalendario(p){
  return !!p.fechaLimite && p.fechaLimite < fechaLocalISO() && !['CERRADO','COMPLETADO','CANCELADO'].includes(p.estado)
}
export function estadoEfectivo(p){
  return fechaVencidaCalendario(p) ? 'VENCIDO' : p.estado
}

// --- Dos avisos "de asistente personal", inspirados en cómo Boomerang/SaneBox/
// Motion evitan que uno tenga que acordarse solo de todo: ---
// 1) Avisar ANTES de que algo se atrase (no solo cuando ya se atrasó), para
//    poder adelantarse.
// 2) Avisar cuando algo lleva varios días esperando respuesta de la otra
//    persona, para que uno no tenga que ir revisando uno por uno si ya
//    contestaron.
export const DIAS_AVISO_VENCE_PRONTO = 2
export const DIAS_SIN_RESPUESTA_SEGUIMIENTO = 3
export function inicioDelDia(d){ const x=new Date(d); x.setHours(0,0,0,0); return x }

// Días de calendario (no horas) entre `fechaIso` y hoy — positivo si
// `fechaIso` ya pasó, negativo si todavía está por venir.
export function diasEntre(fechaIso){
  if(!fechaIso) return null
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(fechaIso) ? fechaIso+'T00:00:00' : fechaIso)
  if(Number.isNaN(d.getTime())) return null
  return Math.round((inicioDelDia(new Date()) - inicioDelDia(d)) / 86400000)
}

// Está "por vencer": todavía no vencido, pero la fecha límite ya está a la
// vuelta de la esquina (hoy, mañana o pasado mañana) — para poder
// adelantarse en vez de enterarse cuando ya es tarde.
export function porVencerPronto(fechaLimite, yaVencido, completado){
  if(!fechaLimite || yaVencido || completado) return false
  const diasParaVencer = -diasEntre(fechaLimite)
  return diasParaVencer!==null && diasParaVencer>=0 && diasParaVencer<=DIAS_AVISO_VENCE_PRONTO
}

// Lleva "demasiados" días esperando que la otra persona responda — en vez de
// que la persona tenga que ir abriendo tarea por tarea a ver si ya
// contestaron, la propia tarea se lo avisa sola.
export function necesitaSeguimiento(esperandoOtro, ultimaActividad, completado){
  if(!esperandoOtro || completado || !ultimaActividad) return false
  const dias = diasEntre(ultimaActividad)
  return dias!==null && dias>=DIAS_SIN_RESPUESTA_SEGUIMIENTO
}
