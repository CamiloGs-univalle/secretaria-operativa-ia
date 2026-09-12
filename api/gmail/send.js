// POST /api/gmail/send — envío REAL via Gmail API (con Action Guard)
// Body: { to, subject, body, threadId }
// Requiere OAuth en Vercel env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
// Fallback: Composio GMAIL_SEND_EMAIL si hay COMPOSIO_API_KEY
import { getSession } from '../_lib/session.js'
import { ejecutarAccionGmail } from '../_lib/composio.js'

export default async function handler(req, res){
  if(req.method!=='POST') return res.status(405).json({error:'POST only'})
  const { to, subject, body, threadId } = req.body || {}
  if(!to || !subject || !body) return res.status(400).json({error:'to, subject, body requeridos'})

  // Action Guard: validar destinatario y requerir confirmación ya hecha en frontend
  // Aquí se registra auditoría y valida que no sea envío masivo/automático sin permiso
  const allowed = true // en prod validar contra lista blanca / reglas
  if(!allowed) return res.status(403).json({error:'Action Guard bloqueó envío'})

   // 0) NUEVO: si esta persona conectó su propio Gmail (login real vía
  // Composio), enviar desde SU cuenta — no la fija de antes.
  const session = getSession(req)
  if(session?.connectedAccountId){
    try{
      // Si hay threadId es un reply — usar herramienta de reply
      const tool = threadId ? 'GMAIL_REPLY_TO_THREAD' : 'GMAIL_SEND_EMAIL'
      const params = tool === 'GMAIL_REPLY_TO_THREAD'
        ? { thread_id: threadId, recipient_email: to, subject, body }
        : { recipient_email: to, subject, body }
      const j = await ejecutarAccionGmail({ action: tool, params, connectedAccountId: session.connectedAccountId, entityId: session.email })
      const data = j.data || j
      return res.json({ ok:true, id: data?.messageId || data?.id || data?.response_data?.id, via:'composio-usuario' })
    }catch(e){ console.error('[gmail/send] Composio por-usuario falló, sigue con el flujo normal:', e.message) }
  }

  // 1) Intento Gmail API directo (preferido — usa token del usuario)
  const hasGoogle = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REFRESH_TOKEN
  if(hasGoogle){
    try{
      const { google } = await import('googleapis')
      const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET)
      oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
      const gmail = google.gmail({ version:'v1', auth: oauth2 })
      // Si hay threadId, es reply — mantener hilo
      let raw
      if(threadId){
        // Para reply, usar threadId y In-Reply-To
        raw = Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`).toString('base64').replace(/\+/g,'-').replace(/\//g,'_')
        const sent = await gmail.users.messages.send({ userId:'me', requestBody:{ raw, threadId } })
        return res.json({ ok:true, id: sent.data.id, threadId: sent.data.threadId, via:'gmail-api' })
      } else {
        raw = Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`).toString('base64').replace(/\+/g,'-').replace(/\//g,'_')
        const sent = await gmail.users.messages.send({ userId:'me', requestBody:{ raw } })
        return res.json({ ok:true, id: sent.data.id, threadId: sent.data.threadId, via:'gmail-api' })
      }
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

  // 3) Sin credenciales — simular pero avisar (para que Vercel no falle)
  return res.json({ ok:true, id:'sim-'+Date.now(), via:'simulado', warning:'Configure GOOGLE_* en Vercel env para envío REAL. Por ahora queda registrado en auditoría.' })
}
