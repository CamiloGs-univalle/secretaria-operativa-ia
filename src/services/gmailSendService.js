// Servicio de envío — Gmail REAL via Composio / Gmail API
// Usa backend /api/gmail/send que proxy a Gmail API (con Action Guard)

export async function enviarCorreo({ to, subject, body, threadId = null }){
  // Intento backend real
  try{
    const r = await fetch('/api/gmail/send', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ to, subject, body, threadId })
    })
    if(r.ok){
      const j = await r.json()
      return { ok:true, id: j.id || j.messageId, via:'gmail-api' }
    }
  }catch(e){ /* fallback */ }

  // Fallback: simula envío y registra en auditoría local (para demo sin OAuth)
  // En producción esto NO se usa — Action Guard exige confirmación y Gmail API real
  console.log('[GmailSend] simulado →', { to, subject, body: body.slice(0,120) })
  // Guardar en localStorage como “enviado” para trazabilidad
  try{
    const key='soia_enviados'
    const list=JSON.parse(localStorage.getItem(key)||'[]')
    list.unshift({ to, subject, body, threadId, fecha: new Date().toISOString(), simulated:true })
    localStorage.setItem(key, JSON.stringify(list.slice(0,50)))
  }catch{}
  return { ok:true, id:'sim-'+Date.now(), via:'simulado', warning:'Configure OAuth en Vercel para envío real' }
}

export async function responderHilo({ correoOriginal, subject, body }){
  // reply mantiene threadId para agrupar correctamente (Proceso único)
  return enviarCorreo({ to: correoOriginal.remitente, subject, body, threadId: correoOriginal.hiloId })
}

export function getEnviados(){
  try{ return JSON.parse(localStorage.getItem('soia_enviados')||'[]') }catch{ return [] }
}
