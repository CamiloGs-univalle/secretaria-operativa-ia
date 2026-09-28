import { fechaLocalISO } from './dateUtils.js'

// Pill de prioridad estilo mockup — Urgente/Alta/Media/Seguimiento/Tarea,
// derivada de lo que ya calcula el motor (analisis.a), no un dato nuevo.
export function prioridadMockup(a){
  if(a.prioridad?.nivel==='CRITICA' || a.clasificacion?.tipo==='URGENTE') return {label:'Urgente', color:'red'}
  if(a.prioridad?.nivel==='ALTA') return {label:'Alta', color:'orange'}
  if(a.turno?.accionEsperadaDe!=='COORDINADORA') return {label:'Seguimiento', color:'blue'}
  if(a.accion?.requiereAccion) return {label:'Media', color:'yellow'}
  return {label:'Tarea', color:'gray'}
}

export function saludoPorHora(){
  const h = new Date().getHours()
  if(h < 12) return 'Buenos días'
  if(h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

// --- Recordatorios en lenguaje natural: "mañana", "en 3 días", un día de
// la semana, o si no reconoce nada, lo deja para hoy en vez de fallar.
export const DIA_INDEX = {domingo:0,lunes:1,martes:2,'miércoles':3,miercoles:3,jueves:4,viernes:5,'sábado':6,sabado:6}
export function parsearFechaNatural(texto){
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
