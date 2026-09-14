// GET /api/gmail/live?max=30&q=
// Live Gmail fetch — usa Composio (cuenta conectada por cada persona) o,
// si algún día se configura, Gmail API directa con OAuth propio del
// despliegue (backend, nunca frontend).
//
// Antes había un tercer camino: si la sesión ERA
// auxiliar.ti@proservis.com.co pero SIN cuenta Gmail conectada, se servía un
// snapshot JSON congelado (una foto fija del inbox tomada una sola vez).
// Ese snapshot nunca se actualiza — con el paso de los días se vuelve cada
// vez más viejo y es exactamente el reporte de "datos quemados": alguien
// entra, no ha conectado su Gmail todavía, y ve una bandeja que parece real
// pero es una foto de hace días. Se quitó por completo: sin cuenta
// conectada, la única respuesta honesta es pedir que conecte su Gmail — el
// frontend ya sabe mostrar esa pantalla (ver App.jsx, session.firebase &&
// !gmailConectado).
import { getSession } from '../_lib/session.js'
import { ejecutarAccionGmail } from '../_lib/composio.js'

export default async function handler(req, res){
  const max = Math.min(50, parseInt(req.query.max || '30', 10))
  const q = (req.query.q || '').toLowerCase()

  // Gate de sesión: este endpoint devuelve correo REAL de la empresa (o de la
  // cuenta que se haya conectado). Antes no requería sesión — cualquiera en
  // internet podía pedir /api/gmail/live y recibir el snapshot real de
  // auxiliar.ti@proservis.com.co sin autenticarse. Ahora exige una sesión
  // válida (haber conectado Gmail real vía Composio) antes de devolver nada.
  const session = getSession(req)
  if(!session){ res.status(401).json({ error:'no_autenticado', messages: [] }); return }

  // Si esta persona conectó SU PROPIO Gmail (vía Composio), esta rama es la
  // ÚNICA fuente de verdad posible para ella. Antes, si esta llamada fallaba
  // o el análisis de la respuesta no encontraba mensajes, el código "seguía
  // con el comportamiento de siempre" — es decir, mostraba en su pantalla el
  // snapshot fijo de auxiliar.ti@proservis.com.co (la cuenta de otra
  // persona) como si fuera su propio Gmail real. Eso es exactamente lo que
  // se reportó como "mentira": alguien conecta su cuenta y ve datos de una
  // cuenta ajena. Ahora, si hay una cuenta conectada, NUNCA se cae a la
  // cuenta fija ni al snapshot — si Composio falla, se devuelve un error
  // honesto para que el frontend lo diga claramente en vez de mostrar datos
  // de otra persona.
  if(session?.connectedAccountId){
    try{
      const j = await ejecutarAccionGmail({
        action: 'GMAIL_FETCH_EMAILS',
        params: { max_results: max, query: q || undefined },
        connectedAccountId: session.connectedAccountId,
        entityId: session.email
      })
      const raw = j.data?.messages || j.messages || j.data?.response_data?.messages || []
      const messages = (Array.isArray(raw) ? raw : []).map(m => ({
        id: m.messageId || m.id,
        hiloId: m.threadId || m.hiloId || m.messageId || m.id,
        remitente: m.sender || m.from || m.remitente || '',
        destinatarios: m.to ? (Array.isArray(m.to) ? m.to : [m.to]) : [],
        cc: m.cc || [],
        asunto: m.subject || m.asunto || '(sin asunto)',
        fecha: m.messageTimestamp || m.date || new Date().toISOString(),
        cuerpo: m.messageText || m.snippet || m.cuerpo || '',
        etiquetas: m.labelIds || m.etiquetas || [],
        adjuntos: (m.attachmentList || []).map(a => a.filename || a)
      }))
      // Éxito de verdad (aunque la bandeja esté vacía) — se devuelve tal cual,
      // nunca se completa con datos de otra cuenta.
      return res.json({ messages, source: 'composio-live', account: session.email })
    }catch(e){
      console.error('[gmail/live] Composio per-user fetch falló para', session.email, ':', e.message)
      return res.status(502).json({
        error: 'no_se_pudo_leer_gmail_real',
        detalle: e.message,
        messages: [],
        note: 'Revise que COMPOSIO_GMAIL_AUTH_CONFIG_ID esté bien configurado y que la acción GMAIL_FETCH_EMAILS exista para su plan de Composio (ver logs del servidor).'
      })
    }
  }

  // A partir de aquí NO hay ninguna cuenta real conectada por esta persona —
  // este endpoint solo debería llegar aquí si algún día se añade una cuenta
  // fija propia del despliegue (GOOGLE_REFRESH_TOKEN). Gmail API directa
  // nunca se implementó (el bloque de abajo es solo un ejemplo comentado),
  // así que sin cuenta conectada no hay nada real que mostrar.
  const hasCreds = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REFRESH_TOKEN
  if(hasCreds){
    // Ejemplo con googleapis (instalar: npm i googleapis) — pendiente de implementar:
    // const { google } = require('googleapis')
    // const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET)
    // oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
    // const gmail = google.gmail({ version:'v1', auth: oauth2 })
    // const list = await gmail.users.messages.list({ userId:'me', maxResults:max, q })
    // const messages = await Promise.all(list.data.messages.map(m=> gmail.users.messages.get({ userId:'me', id:m.id, format:'full' })))
    // return res.json({ messages: normalize(messages), source:'gmail-api-live' })
  }

  // Sin cuenta conectada y sin Gmail API directa configurada: la única
  // respuesta honesta es decir que falta conectar Gmail — nunca datos
  // envejecidos disfrazados de "reales".
  return res.status(404).json({ error:'sin_gmail_conectado', messages: [], note:'Esta sesión no tiene una cuenta de Gmail conectada. Use "Conectar mi Gmail real" en la pantalla de inicio.' })
}
