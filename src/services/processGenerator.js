// Genera procesos REALES a partir de correos REALES usando el motor inteligente
// Cada correo se analiza con las 15 preguntas, se agrupa por hilo y se crea/actualiza proceso
import { analizarCorreoCompleto } from '../engine/emailEngine.js'

export function generarProcesosDesdeCorreos(correos, procesosExistentes=[]){
  const porHilo = {}
  correos.forEach(c=>{
    if(!porHilo[c.hiloId]) porHilo[c.hiloId]=[]
    porHilo[c.hiloId].push(c)
  })
  const procesos = [...procesosExistentes]
  const emailToProceso = {}

  Object.entries(porHilo).forEach(([hiloId, msgs])=>{
    // ordenar por fecha
    msgs.sort((a,b)=> new Date(a.fecha) - new Date(b.fecha))
    const principal = msgs[0]
    const analisis = analizarCorreoCompleto(principal, null)
    // si no es relevante, no crea proceso
    if(!analisis.relevancia.esRelevante) return

    // buscar proceso existente por hilo
    let proc = procesos.find(p=> p.hiloId===hiloId || p.correos?.includes(principal.id))
    if(proc){
      // actualizar con nuevo correo
      proc.correos = [...new Set([...(proc.correos||[]), ...msgs.map(m=>m.id)])]
      proc.ultimaActividad = msgs[msgs.length-1].fecha
      // re-calcular prioridad si hay incidencia o urgencia
      if(analisis.clasificacion.tipo==='INCIDENCIA') proc.prioridad='ALTA'
      if(analisis.clasificacion.tipo==='URGENTE') proc.prioridad='CRITICA'
      if(analisis.turno.accionEsperadaDe==='COORDINADORA') proc.turnoActual='COORDINADORA'
      emailToProceso[principal.id]=proc.id
      return
    }

    // crear nuevo proceso desde correo real
    const id = `PROC-${String(procesos.length+182).padStart(5,'0')}`
    const titulo = principal.asunto.slice(0,65) || `Proceso ${hiloId.slice(0,6)}`
    const nuevo = {
      id, hiloId,
      titulo,
      descripcion: principal.cuerpo.slice(0,220),
      origen: 'Gmail',
      categoria: analisis.clasificacion.tipo==='SOLICITUD'?'Solicitud': analisis.clasificacion.tipo==='INCIDENCIA'?'Incidencia':'General',
      responsable: analisis.destinatarios.responsablePrincipal==='COORDINADORA'?'Coordinadora':'Otro',
      area: detectarArea(principal),
      prioridad: analisis.prioridad.nivel,
      estado: analisis.clasificacion.tipo==='FINALIZACION'?'COMPLETADO': analisis.turno.accionEsperadaDe==='COORDINADORA'?'PENDIENTE':'ESPERANDO',
      etapa: analisis.turno.tipoRespuesta || 'Inicial',
      creado: principal.fecha,
      fechaLimite: analisis.fechas.fechaCalculada || new Date(Date.now()+ 3*24*3600000).toISOString().slice(0,10),
      tiempoObjetivo: 3,
      tiempoTranscurrido: Math.max(0, Math.floor((Date.now()- new Date(principal.fecha))/86400000)),
      get tiempoRestante(){ return this.tiempoObjetivo - this.tiempoTranscurrido },
      get retraso(){ return Math.max(0, -this.tiempoRestante) },
      ultimaActividad: msgs[msgs.length-1].fecha,
      proximaAccion: analisis.accion.accionEsperada.slice(0,80),
      correos: msgs.map(m=>m.id),
      tareas: analisis.respuesta.informacionNecesaria.map((q,i)=>({ id:`t-${id}-${i}`, titulo:q, done:false })),
      incidencias: analisis.incidencia.existe ? [{ fecha: principal.fecha.slice(0,10), descripcion: analisis.incidencia.descripcion?.slice(0,120), impacto:'medio' }] : [],
      seguimientos: [],
      historial: msgs.map(m=>({ fecha: m.fecha.slice(0,10), icon:'📧', texto: `${m.remitente.split('<')[0].trim()} — ${m.asunto.slice(0,40)}` })),
      fechaCierre: null, motivoCierre: null,
      turnoActual: analisis.turno.accionEsperadaDe,
      esperanRespuesta: analisis.turno.esperandoRespuesta,
      accionEsperada: analisis.accion.accionEsperada,
      confianza: analisis.confianza
    }
    procesos.unshift(nuevo)
    emailToProceso[principal.id]=id
  })

  return { procesos, emailToProceso }
}

function detectarArea(correo){
  const s=(correo.asunto+correo.cuerpo).toLowerCase()
  if(s.includes('acta')||s.includes('entrega')||s.includes('equipo')) return 'TI'
  if(s.includes('certificado')||s.includes('laboral')) return 'Talento Humano'
  if(s.includes('compras')||s.includes('cotizaci')) return 'Compras'
  if(s.includes('capacit')||s.includes('pausas activas')) return 'Bienestar'
  if(s.includes('reclutamiento')||s.includes('temporal')) return 'Reclutamiento'
  return 'Operaciones'
}
