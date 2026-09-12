// POST /api/gmail/archive { id } — solo funciona cuando la persona conectó
// su propio Gmail real (Composio). Le quita la etiqueta INBOX al mensaje
// real, para que su bandeja de Gmail de verdad se reduzca, no solo la vista
// dentro de la app. Si no hay conexión real, responde 401 y el frontend
// simplemente sigue con el archivado local (nunca bloquea al usuario).
import { getSession } from '../_lib/session.js'
import { ejecutarAccionGmail } from '../_lib/composio.js'

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error:'POST only' })
  const session = getSession(req)
  if(!session?.connectedAccountId){ res.status(401).json({ error:'not_connected' }); return }
  try{
    const { id } = req.body || {}
    if(!id){ res.status(400).json({ error:'missing_id' }); return }
    await ejecutarAccionGmail({ action:'GMAIL_REMOVE_LABEL', params:{ message_id:id, label_ids:['INBOX','UNREAD'] }, connectedAccountId: session.connectedAccountId, entityId: session.email })
    res.status(200).json({ ok:true })
  }catch(e){
    console.error('[gmail/archive]', e.message)
    res.status(500).json({ error:'archive_failed' })
  }
}
