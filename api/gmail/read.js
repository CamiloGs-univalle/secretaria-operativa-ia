// POST /api/gmail/read { id } — quita SOLO la etiqueta UNREAD del mensaje
// real (a diferencia de archive.js, que además lo saca de INBOX). Antes no
// existía: "Marcar leído" en la pantalla solo cambiaba el estado local de
// React — el mensaje seguía apareciendo como no leído en la bandeja real de
// Gmail de la persona. Mismo patrón que archive.js: si no hay cuenta
// conectada, 401 y el frontend simplemente sigue con el cambio local (nunca
// bloquea a quien está en modo demostración o solo con Google sin Gmail).
import { getSession } from '../_lib/session.js'
import { ejecutarAccionGmail } from '../_lib/composio.js'

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error:'POST only' })
  const session = getSession(req)
  if(!session?.connectedAccountId){ res.status(401).json({ error:'not_connected' }); return }
  try{
    const { id } = req.body || {}
    if(!id){ res.status(400).json({ error:'missing_id' }); return }
    await ejecutarAccionGmail({ action:'GMAIL_ADD_LABEL_TO_EMAIL', params:{ message_id:id, remove_label_ids:['UNREAD'] }, connectedAccountId: session.connectedAccountId, entityId: session.email })
    res.status(200).json({ ok:true })
  }catch(e){
    console.error('[gmail/read]', e.message)
    res.status(500).json({ error:'read_failed', detalle: e.message })
  }
}
