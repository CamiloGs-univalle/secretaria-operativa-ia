// Motor inteligente — pipeline completo según doc sección 5-15, 38-58
export const CATEGORIAS = {
  INFORMATIVO:'INFORMATIVO', SOLICITUD:'SOLICITUD', SEGUIMIENTO:'SEGUIMIENTO', RESPUESTA:'RESPUESTA', CONFIRMACION:'CONFIRMACION', FINALIZACION:'FINALIZACION', INCIDENCIA:'INCIDENCIA', REPROGRAMACION:'REPROGRAMACION', URGENTE:'URGENTE', NO_RELEVANTE:'NO_RELEVANTE'
}
export const PRIORIDADES = { CRITICA:'CRITICA', ALTA:'ALTA', MEDIA:'MEDIA', BAJA:'BAJA', INFORMATIVA:'INFORMATIVA' }

// patrones
const RE_URGENT = /(urgente|inmediat|asap|prioridad alta|emergencia|crítico|bloquea)/i
const RE_INCIDENCIA = /(inconveniente|no fue posible|se retras|no hemos recibido|falta|error|debemos corregir|se present[oó] un problema|no podemos cumplir|inconsistencia|rechazad)/i
const RE_FINALIZ = /(ya qued[oó] listo|se complet[oó]|proceso termin[oó]|ya fue realizado|qued[oó] corregido|solucionado|entregado|finalizado)/i
const RE_REPROG = /(no podemos entregarlo|reprogramar|cambiamos.*fecha|en lugar de.*ser[áa]|mover.*para el)/i
const RE_FECHA = /(mañana|pasado mañana|hoy|el lunes|el martes|el mi[eé]rcoles|el jueves|el viernes|esta semana|próxima semana|antes de las \d|a primera hora|en \d días?|cuanto antes|urgente|\d{1,2}[\/\-]\d{1,2})/i
const RE_SOLICITUD = /(por favor|necesitamos|solicitamos|podrías|requiere|enviar|aprobar|confirmar|validar|adjuntar)/i
const RE_SEGUIMIENTO = /(quedamos atentos|seguimos pendientes|cómo vamos|recordatorio|seguimiento|pendiente de respuesta|a la espera)/i
const RE_CONFIRMACION = /(confirmamos|recibido|recibimos|hemos recibido|acusamos recibo)/i
const RE_AUTOMATICO = /^(noreply|no-reply|notific|alertas|sistema|facturaci)/i

export function normalizarEmail(email){
  return {
    ...email,
    cuerpoNorm: (email.cuerpo||'').toLowerCase(),
    asuntoNorm: (email.asunto||'').toLowerCase(),
    isAuto: RE_AUTOMATICO.test(email.remitente||'') || (email.asunto||'').toLowerCase().includes('notificación automática')
  }
}

export function clasificar(email){
  const c=email.cuerpoNorm, a=email.asuntoNorm, subj=email.asunto||'', body=email.cuerpo||''
  if(RE_AUTOMATICO.test(email.remitente) && !RE_INCIDENCIA.test(c) && !RE_SOLICITUD.test(c) && !c.includes('rechaz')) return {tipo:CATEGORIAS.NO_RELEVANTE, confidence:0.92, razon:'Correo automático sin impacto operativo'}
  if(/newsletter|promoci|oferta|descuento|boletín/i.test(c+a) && !RE_SOLICITUD.test(c)) return {tipo:CATEGORIAS.NO_RELEVANTE, confidence:0.88, razon:'Newsletter / promoción'}
  if(RE_URGENT.test(c+a) || RE_URGENT.test(subj)) return {tipo:CATEGORIAS.URGENTE, confidence:0.96, razon:'Lenguaje de urgencia detectado'}
  if(RE_INCIDENCIA.test(c)) return {tipo:CATEGORIAS.INCIDENCIA, confidence:0.94, razon:'Frase de incidencia detectada'}
  if(RE_REPROG.test(c)) return {tipo:CATEGORIAS.REPROGRAMACION, confidence:0.91, razon:'Cambio de fecha/compromiso'}
  if(RE_FINALIZ.test(c) && c.length<200) return {tipo:CATEGORIAS.FINALIZACION, confidence:0.89, razon:'Indica posible finalización'}
  if(RE_SEGUIMIENTO.test(c) && !RE_SOLICITUD.test(c)) return {tipo:CATEGORIAS.SEGUIMIENTO, confidence:0.87, razon:'Solicitud de seguimiento'}
  if(RE_CONFIRMACION.test(c) && !RE_SOLICITUD.test(c)) return {tipo:CATEGORIAS.CONFIRMACION, confidence:0.85, razon:'Confirmación de recepción'}
  if(RE_SOLICITUD.test(c) || RE_SOLICITUD.test(a)) return {tipo:CATEGORIAS.SOLICITUD, confidence:0.93, razon:'Solicita acción directa'}
  if(email.hiloId && email.hiloId!=='new') return {tipo:CATEGORIAS.RESPUESTA, confidence:0.82, razon:'Respuesta en hilo existente'}
  return {tipo:CATEGORIAS.INFORMATIVO, confidence:0.78, razon:'Informativo sin acción requerida'}
}

export function analizarRelevancia(email, clasif){
  if(clasif.tipo===CATEGORIAS.NO_RELEVANTE) return {esRelevante:false, score:12, razon:clasif.razon, nivel:'BAJA'}
  if([CATEGORIAS.URGENTE,CATEGORIAS.INCIDENCIA,CATEGORIAS.SOLICITUD].includes(clasif.tipo)) return {esRelevante:true, score:94, razon:clasif.razon, nivel:'ALTA'}
  if([CATEGORIAS.REPROGRAMACION,CATEGORIAS.FINALIZACION,CATEGORIAS.SEGUIMIENTO].includes(clasif.tipo)) return {esRelevante:true, score:78, razon:clasif.razon, nivel:'MEDIA'}
  if(clasif.tipo===CATEGORIAS.RESPUESTA) return {esRelevante:true, score:68, razon:'Respuesta que puede requerir seguimiento', nivel:'MEDIA'}
  return {esRelevante:false, score:35, razon:'Informativo o confirmación', nivel:'BAJA'}
}

// miEmail: el correo de la cuenta real conectada (session.email). Antes esta
// función solo reconocía la palabra "coordinadora" o el correo fijo de
// Proservis — es decir, para CUALQUIER otra persona que conectara su propio
// Gmail (justo lo que ahora permite el login con Google), su bandeja nunca
// calzaba con "coordinadora" y la función solo llegaba al último fallback
// genérico. Ahora, si se conoce el correo real de la sesión, también cuenta
// como "va dirigido a mí" cuando aparece en TO/CC — generaliza el turno
// COORDINADORA/OTRA_PERSONA a cualquier cuenta, no solo la fija de Proservis.
export function detectarResponsable(email, miEmail=null, coordEmail='coordinadora@proservis.com.co'){
  const to=(email.destinatarios||[]).join(' ').toLowerCase()
  const cc=(email.cc||[]).join(' ').toLowerCase()
  const miEmailLower = (miEmail||'').trim().toLowerCase()
  const coordInTo = to.includes('coordinadora') || to.includes(coordEmail.toLowerCase()) || (!!miEmailLower && to.includes(miEmailLower))
  const coordInCc = cc.includes('coordinadora') || cc.includes(coordEmail.toLowerCase()) || (!!miEmailLower && cc.includes(miEmailLower))
  const body=email.cuerpo||''
  // Si está en TO y hay solicitud directa
  if(coordInTo) return {responsablePrincipal:'COORDINADORA', esParaCoordinadora:true, esCC:false, confianza:0.97, turno:'COORDINADORA'}
  if(coordInCc){
    // analizar lenguaje: si menciona a la coordinadora por nombre/rol
    if(/coordinadora|maría|operaciones/i.test(body) && /por favor|necesitamos/i.test(body)) return {responsablePrincipal:'COORDINADORA', esParaCoordinadora:true, esCC:true, confianza:0.72, turno:'COORDINADORA'}
    return {responsablePrincipal:'OTRO', esParaCoordinadora:false, esCC:true, confianza:0.88, turno:'OTRA_PERSONA'}
  }
  // Si no está, pero el remitente escribe a coordinadora (ella recibe)
  if(email.remitente && /coordinadora/.test(to)) return {responsablePrincipal:'COORDINADORA', esParaCoordinadora:true, esCC:false, confianza:0.85, turno:'COORDINADORA'}
  return {responsablePrincipal:'COORDINADORA', esParaCoordinadora:true, esCC:false, confianza:0.65, turno:'COORDINADORA'}
}

export function detectarFechas(email){
  const body=email.cuerpo||''
  const m=body.match(RE_FECHA)
  let fechaTexto=m?m[0]:null
  let fechaCalculada=null
  let esFechaLimite=false
  if(fechaTexto){
    const lower=fechaTexto.toLowerCase()
    const hoy=new Date()
    if(lower.includes('mañana') && !lower.includes('pasado')) { const d=new Date(hoy); d.setDate(hoy.getDate()+1); fechaCalculada=d.toISOString().slice(0,10); esFechaLimite=/necesitamos|antes|entregar|enviar/i.test(body) }
    else if(lower.includes('pasado mañana')){ const d=new Date(hoy); d.setDate(hoy.getDate()+2); fechaCalculada=d.toISOString().slice(0,10) }
    else if(lower.includes('hoy')) fechaCalculada=hoy.toISOString().slice(0,10)
    else if(/lunes|martes|miércoles|jueves|viernes/i.test(lower)){
      const dias={lunes:1,martes:2,'miércoles':3,miercoles:3,jueves:4,viernes:5}
      const target=dias[lower.replace('el ','').trim()]
      if(target){ const d=new Date(hoy); const diff=(target - d.getDay() +7)%7 ||7; d.setDate(d.getDate()+diff); fechaCalculada=d.toISOString().slice(0,10)}
    }
  }
  // horas
  const horaMatch=body.match(/(\d{1,2}):(\d{2})|(\d{1,2})\s*pm|(\d{1,2})\s*am/i)
  return {fechaMencionada:fechaTexto, fechaCalculada, fechaLimite:esFechaLimite, horaLimite:horaMatch?horaMatch[0]:null, confianza: fechaTexto?0.86:0.0}
}

export function tipoRespuesta(email){
  const c=email.cuerpoNorm
  if(/adjunto|anexo|envío|te envío/i.test(email.cuerpo||'') && /informe|documento|reporte|listado/i.test(c)) return 'ENTREGA'
  if(/confirmamos|confirmo|s[ií] podemos|aprobado|autorizado/i.test(c)) return 'APROBACION'
  if(/no es posible|rechazado|negado|no podemos/i.test(c)) return 'RECHAZO'
  if(/no podremos|reprogram|mover para/i.test(c)) return 'REPROGRAMACION'
  if(/tuvimos|inconveniente|no fue posible|error|falta/i.test(c)) return 'INCIDENCIA'
  if(/necesitamos tambi|adicionalmente|también requerimos/i.test(c)) return 'NUEVA_SOLICITUD'
  if(/precio|cotizaci|valor|presupuesto/i.test(c) && /adjunto/i.test(c)) return 'ENTREGA'
  if(/gracias|recibido/i.test(c) && c.length<120) return 'CONFIRMACION'
  if(RE_FINALIZ.test(c)) return 'FINALIZACION'
  return 'RESPUESTA_GENERAL'
}

export function calcularPrioridad({clasif, relevancia, responsable, fechas, diasTranscurridos=0, tiempoObjetivo=3, bloqueaSiguiente=false, impacto='medio'}){
  let score=30
  if(clasif.tipo===CATEGORIAS.URGENTE) score+=40
  if(clasif.tipo===CATEGORIAS.INCIDENCIA) score+=35
  if(clasif.tipo===CATEGORIAS.SOLICITUD) score+=25
  if(responsable.turno==='COORDINADORA' && relevancia.esRelevante) score+=15
  if(fechas.fechaLimite) score+=15
  if(fechas.fechaCalculada){
    const diff=Math.ceil((new Date(fechas.fechaCalculada)-new Date())/86400000)
    if(diff<=0) score+=30
    else if(diff===1) score+=20
    else if(diff<=3) score+=10
  }
  if(bloqueaSiguiente) score+=12
  if(impacto==='alto') score+=10
  const pct = diasTranscurridos/tiempoObjetivo
  if(pct>=1) score+=20
  else if(pct>=0.8) score+=12
  else if(pct>=0.5) score+=5
  score=Math.min(100,score)
  let nivel=PRIORIDADES.BAJA
  if(score>=88) nivel=PRIORIDADES.CRITICA
  else if(score>=70) nivel=PRIORIDADES.ALTA
  else if(score>=50) nivel=PRIORIDADES.MEDIA
  else if(score>=20) nivel=PRIORIDADES.BAJA
  else nivel=PRIORIDADES.INFORMATIVA
  return {score, nivel, confianza:0.92}
}

export function checklistRespuesta(email){
  // Detecta múltiples preguntas
  const body=email.cuerpo||''
  const items=[]
  const lines=body.split(/\n|;|\d\./).map(s=>s.trim()).filter(s=>s.length>15)
  // buscar patrones de preguntas
  if(/cantidad.*personas|cantidad de/i.test(body)) items.push({q:'Cantidad de personas', done:false})
  if(/fecha.*ingreso|cuándo ingresa/i.test(body)) items.push({q:'Fecha de ingreso', done:false})
  if(/ciudad|sede|ubicaci/i.test(body)) items.push({q:'Ciudad / Sede', done:false})
  if(/cargo|puesto/i.test(body)) items.push({q:'Cargo', done:false})
  if(/documento|soporte|anexo/i.test(body)) items.push({q:'Documentación adjunta', done:false})
  if(items.length===0){
    // fallback: extrae preguntas con ?
    const qs=body.match(/[^.?\n]*\?/g)
    if(qs) qs.slice(0,4).forEach(q=>items.push({q:q.trim().slice(0,60), done:false}))
  }
  if(items.length===0) items.push({q:'Responder solicitud principal', done:false})
  return items
}

export function detectarEntidades(email){
  const body=email.cuerpo||''
  const persona=body.match(/(?:colaborador|señor|señora|usuario)\s+([A-ZÁÉÍÓÚ][a-záéí]+ [A-ZÁÉÍÓÚ][a-záéí]+)/)?.[1] || body.match(/Juan Pérez|María López|María del Mar|Carlos|Yeferson/i)?.[0] || null
  const empresa=body.match(/empresa\s+([A-Z]+)/i)?.[1] || body.match(/Proservis|ABC|XYZ/i)?.[0] || null
  const cargo=body.match(/cargo de ([a-záéíóú\s]+)/i)?.[1] || null
  return {persona, empresa, cargo}
}

// Pipeline 15 preguntas
export function analizarCorreoCompleto(email, contextoProceso=null, miEmail=null){
  const norm=normalizarEmail(email)
  const clasif=clasificar(norm)
  const relevancia=analizarRelevancia(norm, clasif)
  const responsable=detectarResponsable(norm, miEmail)
  const fechas=detectarFechas(norm)
  const entidades=detectarEntidades(norm)
  const respTipo=tipoRespuesta(norm)
  const checklist=checklistRespuesta(norm)
  const incidencia=clasif.tipo===CATEGORIAS.INCIDENCIA
  const posibleFinalizacion=clasif.tipo===CATEGORIAS.FINALIZACION || respTipo==='FINALIZACION'
  const prioridad=calcularPrioridad({clasif, relevancia, responsable, fechas, diasTranscurridos: contextoProceso? Math.floor((Date.now()-new Date(contextoProceso.creado).getTime())/86400000):0, bloqueaSiguiente: /bloquea|depende|sin esto no/i.test(norm.cuerpoNorm) })

  const esperanRespuesta = relevancia.esRelevante && responsable.turno==='COORDINADORA' && [CATEGORIAS.SOLICITUD, CATEGORIAS.SEGUIMIENTO, CATEGORIAS.URGENTE, CATEGORIAS.INCIDENCIA].includes(clasif.tipo)
  const accionEsperada = esperanRespuesta ? (norm.cuerpo.slice(0,120).split('.')[0] || 'Responder solicitud') : 'Seguimiento / Observación'
  const replyReadiness = esperanRespuesta ? (checklist.length>2 ? 'PARTIAL' : 'READY') : 'NO_REPLY_NEEDED'

  // matching proceso: threadId exacto -> alta confianza
  let procesoMatch=null
  if(contextoProceso) procesoMatch={existe:true, processId:contextoProceso.id, confidence:0.96}

  return {
    emailId: email.id,
    threadId: email.hiloId,
    clasificacion:{tipo:clasif.tipo, confianza:clasif.confidence, razon:clasif.razon},
    relevancia,
    destinatarios:responsable,
    accion:{requiereAccion:esperanRespuesta, tipo: esperanRespuesta?'RESPONDER':'OBSERVAR', accionEsperada},
    turno:{accionEsperadaDe: responsable.turno, esperandoRespuesta: esperanRespuesta, tipoRespuesta: respTipo},
    proceso: procesoMatch || {existe:false, confidence:0},
    fechas,
    respuesta:{necesitaRespuesta:esperanRespuesta, replyReadiness, informacionNecesaria: checklist.map(c=>c.q), informacionDisponible: replyReadiness==='READY', checklist},
    incidencia:{existe:incidencia, descripcion: incidencia? norm.cuerpo.slice(0,180):null},
    finalizacion:{posibleFinalizacion, confianza: posibleFinalizacion?0.89:0.12},
    prioridad,
    entidades,
    confianza: Math.round((clasif.confidence+relevancia.score/100+0.9)/3*100)/100,
    explicacion: `Prioridad ${prioridad.nivel} porque: ${[
      relevancia.esRelevante?'solicita acción directa':'informativo',
      responsable.turno==='COORDINADORA'?'esperan respuesta de la coordinadora':'CC informativo',
      fechas.fechaCalculada?`fecha límite ${fechas.fechaCalculada}`:null,
      incidencia?'incidencia detectada':null,
      posibleFinalizacion?'posible cierre':null
    ].filter(Boolean).join(' • ')}`
  }
}

export function filtrarCorreosIrrelevantes(correos){
  return correos.filter(c=>{
    const n=normalizarEmail(c)
    const k=clasificar(n)
    return k.tipo!==CATEGORIAS.NO_RELEVANTE
  })
}

// Sugerencia de respuesta con contexto completo (15 preguntas + hilo)
export function sugerirRespuesta(correo, analisis, proceso=null, hilo=[]){
  const nombreRemitente = (correo.remitente||'').split('<')[0].trim().split(' ')[0] || 'buen día'
  const esSolicitud = analisis.clasificacion.tipo==='SOLICITUD' || analisis.clasificacion.tipo==='URGENTE'
  const esIncidencia = analisis.incidencia.existe
  const esReprogram = analisis.clasificacion.tipo==='REPROGRAMACION'
  const checklist = analisis.respuesta.checklist || []
  const fechaLim = analisis.fechas.fechaCalculada
  let asunto = correo.asunto.startsWith('Re:')||correo.asunto.startsWith('RE:') ? correo.asunto : `Re: ${correo.asunto}`
  let cuerpo = ''
  let tono = 'profesional y cordial'

  if(esIncidencia){
    cuerpo = `Hola ${nombreRemitente},\n\nGracias por informar la incidencia.\n\nHe tomado nota de: "${analisis.incidencia.descripcion?.slice(0,120)}"\nQuedo atenta a la solución y al nuevo compromiso${fechaLim? ` para el ${fechaLim}`:''}.\n${proceso? `Proceso: ${proceso.id} — ${proceso.titulo}. `:''}¿Podrías confirmarme la nueva fecha y el responsable?\n\nQuedo atenta,\nCoordinación — Proservis\n`
  } else if(esReprogram){
    cuerpo = `Hola ${nombreRemitente},\n\nEntendido el cambio de fecha${fechaLim? ` al ${fechaLim}`:''}.\nHe actualizado el proceso${proceso? ` ${proceso.id}`:''} y ajustado el seguimiento.\nConfirmo que quedamos para ${fechaLim || 'la nueva fecha'}.\n\nSi hay impacto adicional me avisas por favor.\n\nCordial saludo,\nCoordinación — Proservis\n`
  } else if(esSolicitud){
    const pendientes = checklist.filter(c=>!c.done).map(c=>`• ${c.q}`).join('\n')
    cuerpo = `Hola ${nombreRemitente},\n\nGracias por tu correo.\n\n` +
      (checklist.length? `Para responder necesito verificar:\n${pendientes}\n\n`:'') +
      (fechaLim? `Entiendo el compromiso para ${fechaLim}. `:'' ) +
      `Te confirmo en el transcurso del día con la información completa.\n\n`+
      (proceso? `Referencia: ${proceso.id}\n`:'') +
      `Quedo atenta,\nCoordinación — Proservis\nAuxiliar TI • auxiliar.ti@proservis.com.co`
  } else if(analisis.clasificacion.tipo==='SEGUIMIENTO'){
    cuerpo = `Hola ${nombreRemitente},\n\nGracias por el seguimiento.\nEn este momento ${analisis.turno.accionEsperadaDe==='COORDINADORA' ? 'estoy finalizando la gestión y te envío actualización hoy' : 'estamos a la espera de respuesta externa y haré seguimiento' }.\nTe confirmo en breve.\n\nSaludos,\nCoordinación\n`
  } else if(analisis.finalizacion.posibleFinalizacion){
    cuerpo = `Hola ${nombreRemitente},\n\nPerfecto, gracias por confirmar.\nHe marcado el proceso como posible cierre${proceso? ` (${proceso.id})`:''}. Quedo atenta si surge algo adicional.\n\nSaludos cordiales,\nCoordinación\n`
  } else {
    cuerpo = `Hola ${nombreRemitente},\n\nGracias por tu mensaje.\nHe recibido tu correo "${correo.asunto.slice(0,60)}" y lo tengo en seguimiento.\nTe respondo con detalle en breve.\n\nCordial saludo,\nCoordinación — Proservis\n`
  }

  // hilo contexto (últimos 2 correos del hilo)
  let contextoHilo = ''
  if(hilo.length>1){
    const ult = hilo.slice(-2).map(h=> `${h.remitente.split('<')[0].trim()}: ${h.cuerpo.slice(0,90)}…`).join('\n')
    contextoHilo = `\n\n— Contexto hilo —\n${ult}`
  }

  return { asunto, cuerpo: cuerpo.trim(), tono, checklist, contextoHilo, confianza: analisis.confianza, requiereConfirmacion: true }
}
