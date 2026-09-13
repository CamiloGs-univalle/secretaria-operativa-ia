// Servicio de envío — Gmail REAL via Composio / Gmail API
// Usa backend /api/gmail/send que proxy a Gmail API (con Action Guard)

// requiereReal: viene de session.real. Antes, CUALQUIER error del backend
// (incluido un rechazo honesto de /api/gmail/send porque falló el envío por
// la cuenta conectada) se tragaba en silencio y terminaba en "envío
// simulado exitoso" — la persona veía "✉️ Respuesta enviada" cuando en
// realidad no se envió nada. Ahora, si la sesión es real, un fallo del
// backend se propaga como error de verdad; el simulado solo es válido para
// modo demostración, donde nunca hubo un envío real que fingir.
export async function enviarCorreo({ to, subject, body, threadId = null, requiereReal = false }){
  try{
    const r = await fetch('/api/gmail/send', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ to, subject, body, threadId }),
      credentials: 'same-origin'
    })
    const j = await r.json().catch(()=>({}))
    if(r.ok){
      return { ok:true, id: j.id || j.messageId || j?.data?.messageId, via: j.via || 'gmail-api', warning: j.warning }
    }
    throw new Error(j.note || j.error || `Error ${r.status}: ${JSON.stringify(j).slice(0,120)}`)
  }catch(e){
    if(requiereReal){
      // Sesión real conectada: no hay simulado honesto posible — se propaga
      // el error para que la pantalla lo diga claramente.
      throw e
    }
    console.error('[GmailSend] modo demostración, sin backend real — se simula localmente:', e.message)
  }

  // Fallback SOLO para modo demostración: simula envío y lo registra en
  // auditoría local, nunca se usa si requiereReal es true.
  console.log('[GmailSend] simulado (demo) →', { to, subject, body: body.slice(0,120) })
  try{
    const key='soia_enviados_demo'
    const list=JSON.parse(localStorage.getItem(key)||'[]')
    list.unshift({ to, subject, body, threadId, fecha: new Date().toISOString(), simulated:true })
    localStorage.setItem(key, JSON.stringify(list.slice(0,50)))
  }catch{}
  return { ok:true, id:'sim-'+Date.now(), via:'simulado', warning:'Modo demostración — ningún correo real fue enviado.' }
}

export async function responderHilo({ correoOriginal, subject, body, requiereReal=false }){
  // reply mantiene threadId para agrupar correctamente (Proceso único)
  return enviarCorreo({ to: correoOriginal.remitente, subject, body, threadId: correoOriginal.hiloId, requiereReal })
}

export function getEnviados(){
  try{ return JSON.parse(localStorage.getItem('soia_enviados_demo')||'[]') }catch{ return [] }
}
