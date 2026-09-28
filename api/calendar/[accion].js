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

async function events(req, res, session){
  const { timeMin, timeMax } = req.query || {}
  if(!timeMin || !timeMax || isNaN(Date.parse(timeMin)) || isNaN(Date.parse(timeMax))) return res.status(400).json({ error: 'rango_invalido' })
  try{
    const j = await ejecutarAccion({
      tool: 'GOOGLECALENDAR_EVENTS_LIST',
      connectedAccountId: session.calendarAccountId,
      args: { calendarId: 'primary', timeMin: new Date(timeMin).toISOString(), timeMax: new Date(timeMax).toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 250 },
    })
    const d = datos(j)
    const items = d.items || d.events || d.event_data?.items || []
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
    res.status(502).json({ error: 'no_se_pudo_leer_calendar', note: 'No se pudo leer tu Google Calendar. Si persiste, vuelve a conectarlo desde Configuración.' })
  }
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
    res.status(502).json({ error: 'no_se_pudo_crear_evento', note: 'No se pudo crear el evento en tu Google Calendar.' })
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
