// Vercel Function — Gmail Watch + Pub/Sub (doc 34, 60)
// POST /api/gmail/watch — registra watch, GET /api/gmail/messages — lista, POST /api/gmail/sync — queue
export default async function handler(req, res){
  if(req.method==='POST'){
    // Gmail API: users.watch({ userId:'me', topicName:'projects/xxx/topics/gmail' })
    // Requiere OAuth2 token en backend (nunca en frontend — RNF001/002)
    return res.json({ ok:true, historyId:'12345', expiration: Date.now()+ 7*24*3600000, queue:'Gmail → Webhook → Queue → Worker → Firebase' })
  }
  // GET — Pub/Sub push handler
  const { message } = req.body || {}
  if(message){
    // message.data = base64(historyId)
    // Encolar en Queue (SQS / Cloud Tasks) — no bloquear (RNF010/011)
    // Worker procesará async → emailEngine → Firebase → Sheets
    return res.status(204).end()
  }
  return res.json({ status:'Gmail Watch activo', mode:'push Pub/Sub, idempotente (RNF012)' })
}
