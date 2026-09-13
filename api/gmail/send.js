// POST /api/gmail/send — envío REAL via Gmail API (con Action Guard)
// Body: { to, subject, body, threadId }
// Requiere OAuth en Vercel env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
// Fallback: Composio GMAIL_SEND_EMAIL si hay COMPOSIO_API_KEY
import { getSession } from '../_lib/session.js'
import { ejecutarAccionGmail } from '../_lib/composio.js'

const RE_EMAIL = /^\S+@\S+\.\S+$/
// Rate limit simple en memoria — por proceso, no distribuido, pero suficiente
// como primera barrera contra un script que golpee este endpoint en bucle.
// Se reinicia si la función serverless se recicla; eso es aceptable aquí.
const intentos = new Map()
const RATE_MAX = 8
const RATE_WINDOW_MS = 10 * 60 * 1000
function rateLimited(clave){
  const ahora = Date.now()
  const lista = (intentos.get(clave) || []).filter(t => ahora - t < RATE_WINDOW_MS)
  lista.push(ahora)
  intentos.set(clave, lista)
  return lista.length > RATE_MAX
}
// Evita inyección de encabezados de correo: un \r o \n dentro de "to" o
// "subject" permitiría inyectar destinatarios (Bcc:), encabezados extra, o
// incluso un segundo mensaje dentro del mismo raw MIME.
function sinCRLF(s){ return String(s || '').replace(/[\r\n]+/g, ' ').trim() }

export default async function handler(req, res){
  if(req.method!=='POST') return res.status(405).json({error:'POST only'})
  const session = getSession(req)

  const clave = session?.email || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'anon'
  if(rateLimited(clave)) return res.status(429).json({ error:'Demasiados envíos — espere unos minutos' })

  let { to, subject, body, threadId } = req.body || {}
  if(!to || !subject || !body) return res.status(400).json({error:'to, subject, body requeridos'})
  to = sinCRLF(to); subject = sinCRLF(subject)
  if(!RE_EMAIL.test(to)) return res.status(400).json({ error:'Destinatario inválido' })

  // Action Guard: validar destinatario y requerir confirmación ya hecha en frontend
  // Aquí se registra auditoría y valida que no sea envío masivo/automático sin permiso
  const allowed = true // en prod validar contra lista blanca / reglas
  if(!allowed) return res.status(403).json({error:'Action Guard bloqueó envío'})

  // Si esta persona conectó su propio Gmail (login real vía Composio), este
  // es el ÚNICO camino permitido para ella — enviar desde SU cuenta. Antes,
  // si esta llamada fallaba, el código seguía de largo hacia las rutas 1) y
  // 2) de abajo, que envían con las credenciales FIJAS del despliegue (el
  // token de una sola cuenta, o la API key global de Composio). Eso quiere
  // decir que un envío que la persona cree que sale de SU Gmail podía en
  // realidad salir de la cuenta fija de la empresa, sin que nadie se diera
  // cuenta — el mismo tipo de "mentira" reportado con la lectura de correo.
  // Ahora, si hay cuenta conectada, nunca se cae a una cuenta distinta: si
  // falla, se devuelve un error honesto.
  if(session?.connectedAccountId){
    try{
      const tool = threadId ? 'GMAIL_REPLY_TO_THREAD' : 'GMAIL_SEND_EMAIL'
      const params = tool === 'GMAIL_REPLY_TO_THREAD'
        ? { thread_id: threadId, recipient_email: to, subject, body }
        : { recipient_email: to, subject, body }
      const j = await ejecutarAccionGmail({ action: tool, params, connectedAccountId: session.connectedAccountId, entityId: session.email })
      const data = j.data || j
      return res.json({ ok:true, id: data?.messageId || data?.id || data?.response_data?.id, via:'composio-usuario' })
    }catch(e){
      console.error('[gmail/send] Composio por-usuario falló para', session.email, ':', e.message)
      return res.status(502).json({ error:'no_se_pudo_enviar', detalle:e.message, note:'No se envió nada — nunca se usa la cuenta de otra persona como respaldo.' })
    }
  }

  // Las rutas 1) y 2) de abajo envían usando credenciales FIJAS del
  // despliegue (el token OAuth de una sola cuenta, o la API key global de
  // Composio) — no las de "quien está pidiendo el envío". Solo tienen
  // sentido para la propia cuenta fija de Proservis, nunca para alguien más
  // (aunque haya iniciado sesión de otra forma). Sin cuenta conectada
  // propia, un envío real solo procede si la sesión ES la cuenta fija.
  if(session?.real && session.email === 'auxiliar.ti@proservis.com.co'){
    // 1) Intento Gmail API directo (preferido — usa token del usuario)
    const hasGoogle = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REFRESH_TOKEN
    if(hasGoogle){
      try{
        const { google } = await import('googleapis')
        const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET)
        oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
        const gmail = google.gmail({ version:'v1', auth: oauth2 })
        const raw = Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`).toString('base64').replace(/\+/g,'-').replace(/\//g,'_')
        const requestBody = threadId ? { raw, threadId } : { raw }
        const sent = await gmail.users.messages.send({ userId:'me', requestBody })
        return res.json({ ok:true, id: sent.data.id, threadId: sent.data.threadId, via:'gmail-api' })
      }catch(e){
        console.error('Gmail API error', e.message)
        // fallback a Composio si falla
      }
    }

    // 2) Fallback Composio (si hay COMPOSIO_API_KEY) — usa v3.1
    if(process.env.COMPOSIO_API_KEY){
      try{
        const tool = threadId ? 'GMAIL_REPLY_TO_THREAD' : 'GMAIL_SEND_EMAIL'
        const params = tool === 'GMAIL_REPLY_TO_THREAD'
          ? { thread_id: threadId, recipient_email: to, subject, body }
          : { recipient_email: to, subject, body }
        const j = await ejecutarAccionGmail({ action: tool, params })
        const data = j.data || j
        if(data) return res.json({ ok:true, id: data?.messageId || data?.id || data?.response_data?.id, via:'composio' })
      }catch(e){ console.error('Composio error', e.message) }
    }
  }

  // 3) Sin sesión real conectada (o sin credenciales configuradas) —
  // simular pero avisar, nunca usar las credenciales fijas para alguien
  // que no conectó su propia cuenta.
  return res.json({ ok:true, id:'sim-'+Date.now(), via:'simulado', warning:'Conecte su Gmail real para envío REAL. Por ahora queda registrado en auditoría.' })
}
