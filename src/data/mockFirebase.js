// Firebase mock + Firestore real — fuente de verdad híbrida
// - Si hay usuario Firebase autenticado (cualquier Google) → Firestore es la verdad, pero
//   filtrada por `propietario` (el correo de quien inició sesión) — la colección física es
//   la misma para todas las cuentas, pero cada quien solo lee/escribe sus propios documentos
//   (ver fetchProcesosFirestore/subscribeProcesosFirestore más abajo y firestore.rules).
// - Si no hay sesión Firebase (demo/offline) → localStorage como antes.
// - Namespace demo/real separado para que demo no mezcle con real en mismo navegador.
//
// IMPORTANTE — antes esto sembraba datos falsos como si fueran reales: en
// cuanto Firestore (o el localStorage de una sesión real) estaba vacío, se
// devolvían los 6 "_procesos" de ejemplo (María López, Juan Pérez, Carlos
// Ruiz…) como si fueran procesos de verdad, y encima se ESCRIBÍAN en
// Firestore compartido — así que la primera persona en entrar con Google
// contaminaba la base para todo el equipo. Eso es exactamente el reporte de
// "veo datos quemados". Ahora una sesión real (Firebase o no) que no tiene
// nada guardado empieza con una bandeja vacía de verdad: los procesos solo
// aparecen cuando se generan desde correos reales (ver processGenerator.js).
// `_procesosEjemploLegacy` ya NO se usa como semilla — se conserva solo para
// que `limpiarDatosDeEjemploFirestore()` sepa qué IDs borrar si alguien los
// alcanzó a sembrar en Firestore antes de este arreglo.
import { db, auth } from '../lib/firebase.js'
import { collection, doc, deleteDoc, setDoc, getDocs, onSnapshot, query, where, orderBy, addDoc } from 'firebase/firestore'

let NS = ''
export function setModoAlmacenamiento(esDemo){ NS = esDemo ? '_demo' : '' }
function keyProcesos(){ return `soia_procesos_v1${NS}` }
function keyAudit(){ return `soia_audit${NS}` }
export const ESTADOS = { NUEVO:'NUEVO', CLASIFICADO:'CLASIFICADO', PENDIENTE:'PENDIENTE', EN_PROCESO:'EN_PROCESO', ESPERANDO:'ESPERANDO', SEGUIMIENTO:'SEGUIMIENTO', COMPLETADO:'COMPLETADO', CERRADO:'CERRADO', BLOQUEADO:'BLOQUEADO', VENCIDO:'VENCIDO', REPROGRAMADO:'REPROGRAMADO', CANCELADO:'CANCELADO', CON_INCIDENCIA:'CON_INCIDENCIA' }

// Legacy: contenido 100% ficticio. Ya NO se usa para sembrar Firestore ni
// localStorage — solo lo lee limpiarDatosDeEjemploFirestore() para saber qué
// IDs borrar si Firestore ya los tenía guardados de antes de este arreglo.
let _procesosEjemploLegacy = [
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

function isFirebaseMode(){ return !!auth.currentUser && !NS } // demo nunca va a Firestore

// Antes: `NS ? [] : _procesos` — una sesión real con localStorage vacío
// (siempre, la primera vez) recibía los 6 procesos de ejemplo como si fueran
// reales. Ahora ninguna sesión arranca con datos inventados: vacío es vacío,
// hasta que se generen procesos reales desde correos reales.
export function loadProcesos(){
  try{ const v=localStorage.getItem(keyProcesos()); if(v) return JSON.parse(v)}catch{}
  return []
}
export function saveProcesos(list){ try{ localStorage.setItem(keyProcesos(), JSON.stringify(list))}catch{} }
export function getProcesos(){ return loadProcesos() }
export function getProceso(id){ return loadProcesos().find(p=>p.id===id) }

// Firestore helpers.
//
// Antes esto leía TODA la colección `procesos` sin ningún filtro — cualquier
// persona que entrara con Google veía, mezclados en una sola lista, los
// procesos generados desde el correo de TODAS las demás personas. Con 4
// personas usando la app, cada una viendo sus tareas mezcladas con las de
// las otras 3, sin poder distinguir de quién era cada una — exactamente el
// reporte de "está uniendo todo". Ahora cada proceso se guarda con
// `propietario` (el correo de quien lo generó — ver processGenerator.js) y
// esta consulta solo trae los del correo indicado: cada persona ve solo sus
// propios procesos, nunca los de otra.
export async function fetchProcesosFirestore(miEmail){
  if(!isFirebaseMode() || !miEmail) return null
  try{
    const q = query(collection(db, 'procesos'), where('propietario','==', miEmail))
    const snap = await getDocs(q)
    // Antes: si la colección estaba vacía, se sembraban los 6 procesos de
    // ejemplo directo en Firestore compartido — la primera persona en entrar
    // con Google convertía esos datos ficticios en "los datos del equipo"
    // para siempre. Ahora una colección vacía se queda vacía: los procesos
    // reales llegan solos en cuanto alguien conecta su Gmail y se generan
    // desde correos de verdad (ver processGenerator.js / saveProcesoFirestore).
    if(snap.empty) return []
    const list = snap.docs.map(d=> d.data())
    // Cache local para offline
    saveProcesos(list)
    return list
  }catch(e){ console.warn('[Firestore] fetchProcesos', e.message); return null }
}

// Borra en Firestore los 6 documentos de ejemplo si quedaron sembrados ahí
// por el bug anterior (antes de este arreglo). Segura de llamar aunque ya no
// existan — deleteDoc en un id inexistente no falla. Úsese una sola vez
// desde Auditoría → "Limpiar datos de ejemplo" si el equipo los ve.
export async function limpiarDatosDeEjemploFirestore(){
  if(!auth.currentUser) return { ok:false, razon:'Debes iniciar sesión con Google primero.' }
  let borrados = 0
  // También limpia la copia en caché local (localStorage) de este
  // navegador — si no, aunque Firestore quede limpio, loadProcesos() sigue
  // devolviendo la caché local con los 6 ejemplos hasta el próximo cambio.
  try{ localStorage.removeItem(keyProcesos()) }catch{}
  for(const p of _procesosEjemploLegacy){
    try{ await deleteDoc(doc(db, 'procesos', p.id)); borrados++ }catch(e){ console.warn('[Firestore] limpiar', p.id, e.message) }
  }
  return { ok:true, borrados }
}

// Igual que fetchProcesosFirestore: antes suscribía a TODA la colección
// (todos los procesos de todas las personas mezclados). Ahora filtra por
// `propietario` para que cada quien solo reciba actualizaciones en tiempo
// real de sus propios procesos.
export function subscribeProcesosFirestore(cb, miEmail){
  if(!isFirebaseMode() || !miEmail) return ()=>{}
  try{
    const q = query(collection(db, 'procesos'), where('propietario','==', miEmail), orderBy('ultimaActividad','desc'))
    return onSnapshot(q, (snap)=>{
      const list = snap.docs.map(d=> d.data())
      saveProcesos(list)
      cb(list)
    }, (err)=> console.warn('[Firestore] subscribe', err.message))
  }catch(e){ console.warn(e); return ()=>{} }
}

export async function saveProcesoFirestore(proceso){
  if(!isFirebaseMode()) return
  try{ await setDoc(doc(db, 'procesos', proceso.id), proceso, { merge:true }) }catch(e){ console.warn(e.message) }
}

export function updateProceso(id, patch){
  const list=loadProcesos()
  const i=list.findIndex(p=>p.id===id)
  if(i>=0){
    list[i]={...list[i], ...patch, ultimaActividad:new Date().toISOString()}
    saveProcesos(list)
    // Firestore async (no bloquea UI) — cualquier correo lo ve
    if(isFirebaseMode()) saveProcesoFirestore(list[i])
    return list[i]
  }
  return null
}
export function addProceso(p){
  const list=loadProcesos(); list.unshift(p); saveProcesos(list)
  if(isFirebaseMode()) saveProcesoFirestore(p)
  return p
}
export function resetMock(){ localStorage.removeItem(keyProcesos()); return [] }

// auditoria — dual: local + Firestore
//
// Antes, cuando no había sesión Firebase (modo demostración, o alguien que
// solo conectó Gmail por Composio sin pasar por Google), el registro de
// auditoría siempre decía "Coordinadora" — un nombre fijo, sin importar
// quién de verdad estuviera usando la app en ese momento. Eso es justo lo
// que se reportó como "dato quemado": dos personas distintas en modo demo
// verían exactamente el mismo nombre en su historial. `setUsuarioActual`
// deja que App.jsx le diga a este módulo quién es la persona real de la
// sesión actual (nombre o correo), para que auditoría refleje a quien
// corresponda incluso sin Firebase.
let _usuarioActual = null
export function setUsuarioActual(u){ _usuarioActual = u || null }
export function audit(action, extra={}){
  const entry = { fecha:new Date().toISOString(), usuario: auth.currentUser?.email || _usuarioActual || 'Invitado', accion:action, ...extra }
  try{
    const logs=JSON.parse(localStorage.getItem(keyAudit())||'[]')
    logs.unshift(entry)
    localStorage.setItem(keyAudit(), JSON.stringify(logs.slice(0,200)))
  }catch(e){ console.error('[audit] local', e.message) }
  if(isFirebaseMode()){
    addDoc(collection(db, 'auditoria'), entry).catch(()=>{})
  }
}
export function getAuditLog(){
  try{ return JSON.parse(localStorage.getItem(keyAudit())||'[]') }catch{ return [] }
}
export async function fetchAuditFirestore(){
  if(!isFirebaseMode()) return []
  try{ const snap=await getDocs(collection(db,'auditoria')); return snap.docs.map(d=>d.data()).sort((a,b)=> new Date(b.fecha)-new Date(a.fecha)).slice(0,100) }catch{ return [] }
}
