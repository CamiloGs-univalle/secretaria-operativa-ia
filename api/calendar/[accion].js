// Google Calendar vía Composio — UNA sola función de Vercel para todas las
// acciones (el plan Hobby permite máximo 12 funciones por despliegue):
//
//   GET  /api/calendar/connect     → inicia la conexión de Google Calendar
//   GET  /api/calendar/callback    → Composio vuelve aquí tras el consentimiento
//   GET  /api/calendar/status      → { configured, connected }
//   GET  /api/calendar/events?timeMin=ISO&timeMax=ISO → eventos reales
//   POST /api/calendar/create      → { titulo, descripcion, fecha, hora, duracionMin, timezone }
//   POST /api/calendar/disconnect  → olvida la conexión en esta sesión
//
// Requiere que la persona ya tenga su Gmail conectado (sesión cifrada): el
// id de la cuenta de Calendar se guarda dentro de esa misma cookie.
import crypto from 'crypto'
import { getSession, parseCookies, setCookie, clearCookie, encrypt, decrypt, getAppUrl, COOKIE } from '../_lib/session.js'
import { crearEnlaceConexion, estadoConexion, ejecutarAccion } from '../_lib/composio.js'

const STATE_COOKIE = 'soia_gcal_state'
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/
const RE_HORA = /^\d{2}:\d{2}$/
const RE_TZ = /^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$/

function configurado(){
  return !!(process.env.COMPOSIO_API_KEY && process.env.COMPOSIO_GCAL_AUTH_CONFIG_ID)
}
function redirigir(res, location){ res.writeHead(302, { Location: location }); res.end() }
function guardarSesion(res, session){
  setCookie(res, COOKIE.SESSION, encrypt(session), { maxAge: 60 * 60 * 24 * 7 })
}
function datos(j){ return j?.data?.response_data ?? j?.data ?? j ?? {} }

async function connect(req, res, session){
  if(!configurado()) return redirigir(res, '/?calendar=falta_configuracion')
  if(!session?.email) return redirigir(res, '/?calendar=sin_gmail')
  try{
    const { redirectUrl, connectedAccountId } = await crearEnlaceConexion({
      userId: session.email,
      callbackUrl: `${getAppUrl(req)}/api/calendar/callback`,
      authConfigId: process.env.COMPOSIO_GCAL_AUTH_CONFIG_ID,
    })
    // Estado cifrado: quién inició, qué cuenta creó Composio y un nonce. En
    // el callback se exige que coincida — así nadie puede "colar" en la URL
    // el id de una cuenta conectada ajena.
    const state = { nonce: crypto.randomBytes(16).toString('hex'), caId: connectedAccountId, email: session.email, exp: Date.now() + 10 * 60 * 1000 }
    setCookie(res, STATE_COOKIE, encrypt(state), { maxAge: 600 })
    redirigir(res, redirectUrl)
  }catch(e){
    console.error('[calendar/connect]', e.message)
    redirigir(res, '/?calendar=error')
  }
}

async function callback(req, res, session){
  const url = new URL(req.url, 'https://x')
  const status = url.searchParams.get('status')
  const caId = url.searchParams.get('connected_account_id') || url.searchParams.get('connectedAccountId')
  const raw = parseCookies(req)[STATE_COOKIE]
  const state = raw ? decrypt(raw) : null
  clearCookie(res, STATE_COOKIE)

  if(status !== 'success' || !caId || !state || state.exp < Date.now()) return redirigir(res, '/?calendar=cancelado')
  if(!session?.email || session.email !== state.email) return redirigir(res, '/?calendar=error')
  if(state.caId && state.caId !== caId){
    console.error('[calendar/callback] connected_account_id no coincide con el creado en connect')
    return redirigir(res, '/?calendar=error')
  }
  try{
    const estado = await estadoConexion(caId)
    const activa = estado.ok && /ACTIVE|CONNECTED|success/i.test(String(estado.status || ''))
    const authConfig = estado.raw?.auth_config?.id || estado.raw?.auth_config_id
    const dueno = estado.raw?.user_id
    if(!activa || (authConfig && authConfig !== process.env.COMPOSIO_GCAL_AUTH_CONFIG_ID) || (dueno && dueno !== session.email)){
      console.error('[calendar/callback] conexión inválida:', estado.status, authConfig, dueno)
      return redirigir(res, '/?calendar=error')
    }
    guardarSesion(res, { ...session, calendarAccountId: caId, calendarConnectedAt: Date.now() })
    redirigir(res, '/?calendar=exito')
  }catch(e){
    console.error('[calendar/callback]', e.message)
    redirigir(res, '/?calendar=error')
  }
}

// Composio tiene dos herramientas para leer eventos (EVENTS_LIST en
// camelCase y FIND_EVENT en snake_case). Se prueba una y, si falla, la otra.
async function leerEventos(session, tMin, tMax){
  const intentos = [
    { tool: 'GOOGLECALENDAR_EVENTS_LIST', args: { calendarId: 'primary', timeMin: tMin, timeMax: tMax, singleEvents: true, orderBy: 'startTime', maxResults: 250 } },
    { tool: 'GOOGLECALENDAR_FIND_EVENT', args: { calendar_id: 'primary', time_min: tMin, time_max: tMax, single_events: true, order_by: 'startTime', max_results: 250 } },
  ]
  const errores = []
  for(const it of intentos){
    try{ return await ejecutarAccion({ ...it, connectedAccountId: session.calendarAccountId, entityId: session.email }) }
    catch(e){ errores.push(e.message); console.warn('[calendar/events]', e.message) }
  }
  throw new Error(errores.join(' | '))
}

function extraerItems(d){
  for(const c of [d.items, d.events, d.event_data?.items, d.event_data, d.response_data?.items, d.data?.items]){
    if(Array.isArray(c)) return c
  }
  return []
}

async function events(req, res, session){
  const { timeMin, timeMax } = req.query || {}
  if(!timeMin || !timeMax || isNaN(Date.parse(timeMin)) || isNaN(Date.parse(timeMax))) return res.status(400).json({ error: 'rango_invalido' })
  try{
    const j = await leerEventos(session, new Date(timeMin).toISOString(), new Date(timeMax).toISOString())
    const d = datos(j)
    const items = extraerItems(d)
    const eventos = (Array.isArray(items) ? items : [])
      .filter(e => e.status !== 'cancelled')
      .map(e => ({
        id: e.id,
        titulo: e.summary || '(sin título)',
        inicio: e.start?.dateTime || e.start?.date || null,
        fin: e.end?.dateTime || e.end?.date || null,
        todoElDia: !e.start?.dateTime,
        enlace: e.htmlLink || null,
        lugar: e.location || null,
      }))
    res.json({ eventos, calendario: d.summary || null })
  }catch(e){
    console.error('[calendar/events]', e.message)
    const permiso = /scope|permission|insufficient|403|unauthori[sz]ed|401|expired|invalid_grant/i.test(e.message)
    res.status(502).json({ error: 'no_se_pudo_leer_calendar', detalle: String(e.message).slice(0, 400),
      note: permiso ? 'Google no dio permiso para leer tu calendario. Desconéctalo en Configuración y vuelve a conectarlo aceptando todos los permisos.' : 'No se pudo leer tu Google Calendar.' })
  }
}

// Diagnóstico paso a paso (Configuración → Google Calendar → Diagnosticar):
// sesión, estado de la conexión en Composio y una lectura real de prueba.
// No devuelve tokens ni la API key; los ids se recortan.
async function diagnostico(req, res, session){
  const corto = s => s ? String(s).slice(0, 6) + '…' : null
  const out = { fecha: new Date().toISOString(), configurado: configurado(), sesion: { gmail: !!session?.email, email: session?.email || null, calendarAccountId: corto(session?.calendarAccountId) } }
  if(!session?.calendarAccountId) return res.json({ ...out, conclusion: 'Esta sesión no tiene Google Calendar conectado (conéctalo en Configuración).' })
  try{
    const est = await estadoConexion(session.calendarAccountId)
    const r = est.raw || {}
    out.conexion = {
      httpOk: est.ok, estado: est.status || null,
      authConfig: corto(r.auth_config?.id || r.auth_config_id), authConfigCoincide: (r.auth_config?.id || r.auth_config_id) ? (r.auth_config?.id || r.auth_config_id) === process.env.COMPOSIO_GCAL_AUTH_CONFIG_ID : null,
      toolkit: r.toolkit?.slug || r.toolkit || r.appName || null, usuarioComposio: r.user_id || null,
      scopes: r.data?.scope || r.state?.val?.scope || r.params?.scope || null,
      error: est.ok ? null : JSON.stringify(r).slice(0, 300),
    }
  }catch(e){ out.conexion = { error: e.message } }
  const tMin = new Date(Date.now() - 30 * 86400000).toISOString(), tMax = new Date(Date.now() + 60 * 86400000).toISOString()
  out.pruebas = []
  for(const it of [
    { tool: 'GOOGLECALENDAR_EVENTS_LIST', args: { calendarId: 'primary', timeMin: tMin, timeMax: tMax, singleEvents: true, orderBy: 'startTime', maxResults: 20 } },
    { tool: 'GOOGLECALENDAR_FIND_EVENT', args: { calendar_id: 'primary', time_min: tMin, time_max: tMax, single_events: true, max_results: 20 } },
  ]){
    try{
      const j = await ejecutarAccion({ ...it, connectedAccountId: session.calendarAccountId, entityId: session.email })
      const d = datos(j), items = extraerItems(d)
      out.pruebas.push({ tool: it.tool, ok: true, clavesRespuesta: Object.keys(j || {}), clavesData: Object.keys(d || {}).slice(0, 15), calendario: d.summary || null, eventos: items.length,
        ejemplo: items.slice(0, 3).map(e => ({ titulo: e.summary, inicio: e.start?.dateTime || e.start?.date })) })
    }catch(e){ out.pruebas.push({ tool: it.tool, ok: false, error: String(e.message).slice(0, 400) }) }
  }
  const ok = out.pruebas.find(p => p.ok)
  out.conclusion = !ok ? 'Composio/Google rechazan la lectura: mira "error" en pruebas.'
    : ok.eventos === 0 ? `La lectura funciona pero el calendario${ok.calendario ? ` "${ok.calendario}"` : ''} no tiene eventos entre hace 30 días y dentro de 60. ¿Es la cuenta de Google correcta?`
    : `Funciona: ${ok.eventos} evento(s) en el calendario${ok.calendario ? ` "${ok.calendario}"` : ''}.`
  res.json(out)
}

async function create(req, res, session){
  const { titulo, descripcion = '', fecha, hora = '09:00', duracionMin = 30, timezone = 'America/Bogota' } = req.body || {}
  const t = String(titulo || '').trim().slice(0, 200)
  if(!t) return res.status(400).json({ error: 'falta_titulo' })
  if(!RE_FECHA.test(fecha || '')) return res.status(400).json({ error: 'fecha_invalida' })
  if(!RE_HORA.test(hora)) return res.status(400).json({ error: 'hora_invalida' })
  const tz = RE_TZ.test(timezone) ? timezone : 'America/Bogota'
  const mins = Math.min(8 * 60, Math.max(15, parseInt(duracionMin, 10) || 30))
  try{
    const j = await ejecutarAccion({
      tool: 'GOOGLECALENDAR_CREATE_EVENT',
      connectedAccountId: session.calendarAccountId,
      entityId: session.email,
      args: {
        calendar_id: 'primary',
        summary: t,
        description: String(descripcion).slice(0, 4000),
        start_datetime: `${fecha}T${hora}:00`,
        event_duration_hour: Math.floor(mins / 60),
        event_duration_minutes: mins % 60,
        timezone: tz,
        create_meeting_room: false,
        send_updates: 'none',
      },
    })
    const d = datos(j)
    const ev = d.event || d
    res.json({ ok: true, id: ev.id || null, enlace: ev.htmlLink || null })
  }catch(e){
    console.error('[calendar/create]', e.message)
    res.status(502).json({ error: 'no_se_pudo_crear_evento', detalle: String(e.message).slice(0, 400), note: 'No se pudo crear el evento en tu Google Calendar.' })
  }
}

export default async function handler(req, res){
  const accion = String(req.query?.accion || '')
  const session = getSession(req)

  if(accion === 'connect' && req.method === 'GET') return connect(req, res, session)
  if(accion === 'callback' && req.method === 'GET') return callback(req, res, session)
  if(accion === 'status' && req.method === 'GET'){
    return res.json({ configured: configurado(), gmail: !!session?.email, connected: !!session?.calendarAccountId })
  }

  if(accion === 'diagnostico' && req.method === 'GET') return diagnostico(req, res, session)

  if(!session?.calendarAccountId) return res.status(401).json({ error: 'calendar_no_conectado' })

  if(accion === 'events' && req.method === 'GET') return events(req, res, session)
  if(accion === 'create' && req.method === 'POST') return create(req, res, session)
  if(accion === 'disconnect' && req.method === 'POST'){
    const { calendarAccountId, calendarConnectedAt, ...resto } = session
    guardarSesion(res, resto)
    return res.json({ ok: true })
  }
  res.status(404).json({ error: 'accion_desconocida' })
}
