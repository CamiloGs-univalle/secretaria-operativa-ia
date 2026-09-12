// Firebase mock — fuente de verdad local + persistencia localStorage
const KEY='soia_procesos_v1'
export const ESTADOS = { NUEVO:'NUEVO', CLASIFICADO:'CLASIFICADO', PENDIENTE:'PENDIENTE', EN_PROCESO:'EN_PROCESO', ESPERANDO:'ESPERANDO', SEGUIMIENTO:'SEGUIMIENTO', COMPLETADO:'COMPLETADO', CERRADO:'CERRADO', BLOQUEADO:'BLOQUEADO', VENCIDO:'VENCIDO', REPROGRAMADO:'REPROGRAMADO', CANCELADO:'CANCELADO', CON_INCIDENCIA:'CON_INCIDENCIA' }

let _procesos = [
  {
    id:'PROC-00182', titulo:'Contratación — María López — Auxiliar Administrativo XYZ', descripcion:'Validar documentación de María López para cargo auxiliar administrativo empresa XYZ antes del viernes',
    origen:'Gmail', categoria:'Contratación', responsable:'Coordinadora', area:'Operaciones', prioridad:'CRITICA', estado:'EN_PROCESO', etapa:'ESPERANDO_APROBACION',
    creado:'2026-09-08T09:00:00', fechaLimite:'2026-09-12', tiempoObjetivo:4, tiempoTranscurrido:3, tiempoRestante:1, retraso:0, ultimaActividad:'2026-09-10T14:32:00', proximaAccion:'Confirmar fecha de ingreso', correos:['m1','m2','m5'], tareas:[{id:'t1', titulo:'Validar documentación', done:false},{id:'t2', titulo:'Confirmar fecha ingreso', done:false}], incidencias:[], seguimientos:[{fecha:'2026-09-11', nota:'Seguimiento programado'}], historial:[
      {fecha:'2026-09-08', icon:'📧', texto:'Correo recibido — Solicitud validación'},
      {fecha:'2026-09-08', icon:'🧠', texto:'Proceso creado'},
      {fecha:'2026-09-09', icon:'📧', texto:'Información recibida'},
      {fecha:'2026-09-09', icon:'🔄', texto:'Estado → EN_PROCESO'},
      {fecha:'2026-09-10', icon:'⚠️', texto:'Incidencia — falta fecha ingreso'},
    ], fechaCierre:null, motivoCierre:null, turnoActual:'COORDINADORA', esperanRespuesta:true, accionEsperada:'Confirmar fecha de ingreso', bloquea:true, impacto:'alto', confid:0.96
  },
  {
    id:'PROC-00190', titulo:'Compra equipos — Proveedor X — Cotización', descripcion:'Compra de 12 portátiles para sede Cali. Proveedor X envió cotización, pendiente aprobación gerencia.',
    origen:'Gmail', categoria:'Compras', responsable:'Coordinadora', area:'Compras', prioridad:'ALTA', estado:'ESPERANDO', etapa:'Aprobación', creado:'2026-09-09T08:00:00', fechaLimite:'2026-09-13', tiempoObjetivo:5, tiempoTranscurrido:2, tiempoRestante:3, retraso:0, ultimaActividad:'2026-09-10T10:00:00', proximaAccion:'Reenviar a gerencia', correos:['m6','m7'], tareas:[{id:'t3', titulo:'Enviar cotización a gerencia', done:false}], incidencias:[], seguimientos:[], historial:[{fecha:'2026-09-09', icon:'📧', texto:'Solicitud cotización'}, {fecha:'2026-09-10', icon:'📧', texto:'Cotización recibida'}], bloquea:false, impacto:'medio'
  },
  {
    id:'PROC-00176', titulo:'Informe novedades colaboradores — Sede Cali', descripcion:'Informe mensual novedades. Detectada inconsistencia colaborador Juan Pérez — confirmar fecha ingreso 5 septiembre',
    origen:'Gmail', categoria:'Informes', responsable:'Coordinadora', area:'Talento Humano', prioridad:'CRITICA', estado:'VENCIDO', etapa:'Entrega', creado:'2026-09-07T08:00:00', fechaLimite:'2026-09-10', tiempoObjetivo:3, tiempoTranscurrido:4, tiempoRestante:-1, retraso:1, ultimaActividad:'2026-09-09T17:00:00', proximaAccion:'Corregir y reenviar informe', correos:['m8','m9','m10','m11'], tareas:[{id:'t4', titulo:'Corregir fecha Juan Pérez', done:false}], incidencias:[{fecha:'2026-09-10', descripcion:'Inconsistencia Juan Pérez', impacto:'medio', diasRetraso:1}], seguimientos:[], historial:[{fecha:'2026-09-07', icon:'📧', texto:'Solicitud informe'} ,{fecha:'2026-09-08',icon:'📧',texto:'Informe enviado'},{fecha:'2026-09-09',icon:'📧',texto:'Incidencia detectada'}], bloquea:true, impacto:'alto'
  },
  {
    id:'PROC-00195', titulo:'Creación 20 usuarios — Proyecto Epsilon', descripcion:'Crear 20 usuarios. Faltaban 3, ya se enviaron datos faltantes. Pendiente activar.',
    origen:'Gmail', categoria:'TI', responsable:'OTRA_PERSONA', area:'TI', prioridad:'MEDIA', estado:'SEGUIMIENTO', etapa:'Activación', creado:'2026-09-06T11:00:00', fechaLimite:'2026-09-14', tiempoObjetivo:5, tiempoTranscurrido:4, tiempoRestante:1, retraso:0, ultimaActividad:'2026-09-11T09:00:00', proximaAccion:'Verificar activación usuarios', correos:['m12','m13'], tareas:[{id:'t5', titulo:'Verificar 3 usuarios faltantes', done:false}], incidencias:[], seguimientos:[{fecha:'2026-09-12', nota:'Hacer seguimiento lunes'}], historial:[{fecha:'2026-09-06',icon:'📧',texto:'Solicitud 20 usuarios'},{fecha:'2026-09-11',icon:'📧',texto:'Datos faltantes enviados'}], bloquea:false, impacto:'medio'
  },
  {
    id:'PROC-00201', titulo:'Certificación laboral — Carlos Ruiz', descripcion:'Solicitud de certificación laboral para banco. Urgente, vence hoy.',
    origen:'Gmail', categoria:'Certificaciones', responsable:'Coordinadora', area:'Operaciones', prioridad:'CRITICA', estado:'PENDIENTE', etapa:'Generación', creado:'2026-09-11T07:30:00', fechaLimite:'2026-09-11', tiempoObjetivo:1, tiempoTranscurrido:0, tiempoRestante:1, retraso:0, ultimaActividad:'2026-09-11T07:30:00', proximaAccion:'Generar certificado', correos:['m14'], tareas:[{id:'t6',titulo:'Generar PDF certificación', done:false}], incidencias:[], seguimientos:[], historial:[{fecha:'2026-09-11',icon:'📧',texto:'Solicitud certificación — urgente'}], bloquea:true, impacto:'alto'
  },
  {
    id:'PROC-00203', titulo:'Validación proveedor — Entrega viernes → lunes', descripcion:'Proveedor indica reprogramación entrega viernes a lunes por problema logístico. Impacto +3 días.',
    origen:'Gmail', categoria:'Logística', responsable:'Coordinadora', area:'Compras', prioridad:'ALTA', estado:'REPROGRAMADO', etapa:'Reprogramación', creado:'2026-09-09T13:00:00', fechaLimite:'2026-09-15', tiempoObjetivo:4, tiempoTranscurrido:2, tiempoRestante:2, retraso:3, ultimaActividad:'2026-09-10T16:00:00', proximaAccion:'Confirmar nueva fecha con operación', correos:['m15'], tareas:[], incidencias:[{fecha:'2026-09-10', descripcion:'Reprogramación proveedor', impacto:'alto', diasRetraso:3}], seguimientos:[], historial:[{fecha:'2026-09-10',icon:'📧',texto:'No podemos entregarlo el viernes, sino el lunes'}], bloquea:false, impacto:'alto'
  },
]

export const correosMock=[
  {id:'m1', hiloId:'th-182', remitente:'talento@xyz.com', destinatarios:['coordinadora@proservis.com.co'], cc:[], asunto:'Validar documentación María López — Auxiliar Administrativo', fecha:'2026-09-08T09:12:00', cuerpo:'Buenos días Coordinadora,\nPor favor validar la documentación de María López para el cargo de auxiliar administrativo de la empresa XYZ antes del viernes.\nAdjunto hoja de vida y soportes.\nGracias.', etiquetas:['INBOX'], adjuntos:['HV_MariaLopez.pdf']},
  {id:'m2', hiloId:'th-182', remitente:'coordinadora@proservis.com.co', destinatarios:['talento@xyz.com'], cc:['gerencia@xyz.com'], asunto:'RE: Validar documentación María López', fecha:'2026-09-09T11:00:00', cuerpo:'Hola,\nHe revisado la documentación. Falta confirmar fecha de ingreso.\n¿Nos pueden confirmar la fecha exacta?', etiquetas:['SENT'], adjuntos:[]},
  {id:'m3', hiloId:'th-000', remitente:'newsletter@rrhh.com', destinatarios:['coordinadora@proservis.com.co'], cc:[], asunto:'Boletín semanal RH — Novedades laborales', fecha:'2026-09-09T07:00:00', cuerpo:'Boletín semanal con novedades del sector. Lee las últimas tendencias en gestión humana.', etiquetas:['PROMOTIONS'], adjuntos:[]},
  {id:'m4', hiloId:'th-000', remitente:'noreply@sistema.com', destinatarios:['coordinadora@proservis.com.co'], cc:[], asunto:'Su solicitud fue recibida #4521', fecha:'2026-09-09T07:05:00', cuerpo:'Confirmamos que su solicitud fue recibida. Número de ticket 4521.', etiquetas:['INBOX'], adjuntos:[]},
  {id:'m5', hiloId:'th-182', remitente:'talento@xyz.com', destinatarios:['coordinadora@proservis.com.co'], cc:[], asunto:'RE: Validar documentación María López — falta fecha', fecha:'2026-09-10T14:20:00', cuerpo:'Coordinadora,\nLa fecha correcta de ingreso es el 5 de septiembre. Quedamos atentos a la aprobación.\nPor favor confirmar hoy antes de las 4 PM.', etiquetas:['INBOX','UNREAD'], adjuntos:[]},
  {id:'m6', hiloId:'th-190', remitente:'coordinadora@proservis.com.co', destinatarios:['proveedorx@proveedor.com'], cc:[], asunto:'Solicitud de cotización — 12 portátiles', fecha:'2026-09-09T08:10:00', cuerpo:'Buenos días,\nNecesitamos cotización para 12 portátiles para sede Cali. Por favor enviar antes de mañana.', etiquetas:['SENT'], adjuntos:[]},
  {id:'m7', hiloId:'th-190', remitente:'proveedorx@proveedor.com', destinatarios:['coordinadora@proservis.com.co'], cc:[], asunto:'RE: Cotización 12 portátiles — Adjunta', fecha:'2026-09-10T10:00:00', cuerpo:'Adjunto cotización solicitada. Quedo atento a aprobación.\nValor total: $24.000.000 COP', etiquetas:['INBOX'], adjuntos:['Cotizacion_ProveedorX.pdf']},
  {id:'m8', hiloId:'th-176', remitente:'operaciones@proservis.com.co', destinatarios:['coordinadora@proservis.com.co'], cc:[], asunto:'Informe novedades colaboradores sede Cali — requerido mañana', fecha:'2026-09-07T08:00:00', cuerpo:'Buenos días, necesitamos el informe de novedades de los colaboradores de la sede Cali para mañana.', etiquetas:['INBOX'], adjuntos:[]},
  {id:'m14', hiloId:'th-201', remitente:'carlos.ruiz@personal.com', destinatarios:['coordinadora@proservis.com.co'], cc:[], asunto:'URGENTE — Certificación laboral requerida hoy', fecha:'2026-09-11T07:30:00', cuerpo:'Coordinadora urgente,\nNecesito certificación laboral para trámite bancario hoy antes de las 2 PM. ¿Me la puede enviar por favor?', etiquetas:['INBOX','UNREAD'], adjuntos:[]},
  {id:'m15', hiloId:'th-203', remitente:'logistica@proveedor.com', destinatarios:['coordinadora@proservis.com.co'], cc:[], asunto:'Reprogramación entrega', fecha:'2026-09-10T16:00:00', cuerpo:'Coordinadora,\nNo podemos entregarlo el viernes, sino el lunes por problema con proveedor de transporte. Lamentamos el inconveniente.', etiquetas:['INBOX'], adjuntos:[]},
  {id:'m16', hiloId:'th-182', remitente:'sistema@proservis.com.co', destinatarios:['coordinadora@proservis.com.co'], cc:[], asunto:'[Automático] Seguimiento proceso 182', fecha:'2026-09-10T18:00:00', cuerpo:'Hola, ¿cómo vamos con el proceso de María López? Seguimos pendientes de la aprobación.', etiquetas:['INBOX'], adjuntos:[]},
]

export function loadProcesos(){
  try{ const v=localStorage.getItem(KEY); if(v) return JSON.parse(v)}catch{}
  return _procesos
}
export function saveProcesos(list){ try{ localStorage.setItem(KEY, JSON.stringify(list))}catch{} }
export function getProcesos(){ return loadProcesos() }
export function getProceso(id){ return loadProcesos().find(p=>p.id===id) }
export function updateProceso(id, patch){
  const list=loadProcesos()
  const i=list.findIndex(p=>p.id===id)
  if(i>=0){ list[i]={...list[i], ...patch, ultimaActividad:new Date().toISOString()}; saveProcesos(list); return list[i]}
  return null
}
export function addProceso(p){ const list=loadProcesos(); list.unshift(p); saveProcesos(list); return p }
export function resetMock(){ localStorage.removeItem(KEY); return _procesos }

// auditoria
export function audit(action, extra={}){
  const logs=JSON.parse(localStorage.getItem('soia_audit')||'[]')
  logs.unshift({fecha:new Date().toISOString(), usuario:'Coordinadora', accion:action, ...extra})
  localStorage.setItem('soia_audit', JSON.stringify(logs.slice(0,200)))
}
// Devuelve el historial REAL de acciones (lo que de verdad se hizo), no un ejemplo fijo.
export function getAuditLog(){
  try{ return JSON.parse(localStorage.getItem('soia_audit')||'[]') }catch{ return [] }
}
