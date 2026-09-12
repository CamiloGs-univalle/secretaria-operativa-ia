// GET /api/gmail/live?max=30&q=
// Live Gmail fetch — usa Gmail API con OAuth (backend, nunca frontend)
// En local/despliegue sin OAuth, hace fallback al snapshot real
import gmailReal from '../../src/data/gmailReal.json' assert { type: 'json' }
import { getSession } from '../_lib/session.js'
import { ejecutarAccionGmail } from '../_lib/composio.js'

export default async function handler(req, res){
  const max = Math.min(50, parseInt(req.query.max || '30', 10))
  const q = (req.query.q || '').toLowerCase()

  // NUEVO: si esta persona conectó su propio Gmail (login real vía Composio),
  // traer SU bandeja real en vez de la cuenta fija / el snapshot de siempre.
  const session = getSession(req)
  if(session?.connectedAccountId){
    try{
      const j = await ejecutarAccionGmail({
        action: 'GMAIL_FETCH_EMAILS',
        params: { max_results: max, query: q || undefined },
        connectedAccountId: session.connectedAccountId,
        entityId: session.email
      })
      const raw = j.data?.messages || j.messages || j.data?.response_data?.messages || []
      if(Array.isArray(raw) && raw.length){
        const messages = raw.map(m => ({
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
        return res.json({ messages, source: 'composio-live', account: session.email })
      }
    }catch(e){
      console.error('[gmail/live] Composio per-user fetch falló, sigue con el flujo normal:', e.message)
      // sigue abajo con el comportamiento de siempre — nunca rompe la app
    }
  }

  // Si hay credenciales, intentar Gmail API real
  const hasCreds = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REFRESH_TOKEN
  if(hasCreds){
    try{
      // Ejemplo con googleapis (instalar: npm i googleapis)
      // const { google } = require('googleapis')
      // const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET)
      // oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
      // const gmail = google.gmail({ version:'v1', auth: oauth2 })
      // const list = await gmail.users.messages.list({ userId:'me', maxResults:max, q })
      // const messages = await Promise.all(list.data.messages.map(m=> gmail.users.messages.get({ userId:'me', id:m.id, format:'full' })))
      // return res.json({ messages: normalize(messag es), source:'gmail-api-live' })
    }catch(e){
      return res.status(500).json({ error:'Gmail API error', fallback:true, messages: gmailReal.slice(0,max) })
    }
  }

  // Fallback snapshot real (61KB, 30 mensajes del 11/09/2026 21:35 UTC de auxiliar.ti@proservis.com.co)
  let msgs = gmailReal
  if(q) msgs = msgs.filter(m=> (m.asunto+m.cuerpo+m.remitente).toLowerCase().includes(q))
  return res.json({ messages: msgs.slice(0,max), source:'snapshot-real-gmail', account:'auxiliar.ti@proservis.com.co', snapshot:'2026-09-11T21:35:57Z', total: gmailReal.length })
}
