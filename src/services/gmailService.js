// Gmail Service — conecta con Gmail REAL de la persona que inició sesión.
// Todo el fetch pasa por el backend (/api/gmail/live), que exige sesión
// autenticada antes de devolver nada. Antes este archivo importaba
// gmailReal.json directamente aquí en el frontend — eso significaba que el
// snapshot REAL de correos de la empresa quedaba empaquetado dentro del
// bundle JS público, descargable por cualquiera que visitara el sitio,
// sin iniciar sesión siquiera. Se quitó: el snapshot de respaldo ahora
// vive solo en el servidor (api/gmail/live.js), detrás del gate de sesión.
const API_BASE = '' // mismo origen — Vercel Functions en /api

// Antes, cualquier error acá (401, 502, red caída) se tragaba en silencio y
// devolvía [] — la persona veía "0 correos" sin ninguna explicación, o peor,
// el backend rellenaba con el snapshot de OTRA cuenta y esta función lo
// devolvía como si nada. Ahora un fallo real se lanza como error explícito
// (con el mensaje que mandó el servidor) para que la pantalla pueda avisar
// con honestidad qué pasó, en vez de mostrar una bandeja vacía o ajena sin
// explicación.
export async function fetchRealGmail({ maxResults = 30, query = '' } = {}){
  const r = await fetch(`${API_BASE}/api/gmail/live?max=${maxResults}&q=${encodeURIComponent(query)}`, { cache:'no-store', credentials:'same-origin' })
  const j = await r.json().catch(()=>({}))
  if(!r.ok){
    throw new Error(j.note || j.error || `No se pudo leer Gmail real (HTTP ${r.status})`)
  }
  return normalizeGmailMessages(j.messages || [])
}

export function normalizeGmailMessages(messages){
  // Ya viene normalizado desde el backend, pero asegura formato interno
  return messages.map(m=>({
    id: m.id || m.messageId,
    hiloId: m.hiloId || m.threadId,
    remitente: m.remitente || m.sender,
    destinatarios: m.destinatarios || (m.to ? [m.to] : []),
    cc: m.cc || [],
    asunto: m.asunto || m.subject || m.preview?.subject || '(sin asunto)',
    fecha: m.fecha || m.messageTimestamp || m.internalDate,
    cuerpo: m.cuerpo || m.messageText || m.preview?.body || '',
    etiquetas: m.etiquetas || m.labelIds || [],
    adjuntos: m.adjuntos || (m.attachmentList||[]).map(a=>a.filename)
  }))
}

// Para sync manual — vuelve a consultar Gmail y detecta nuevos
export async function syncGmail(){
  const fresh = await fetchRealGmail({ maxResults: 15 })
  // aquí iría: comparar con cache, encolar en Worker, analizar con IA
  return fresh
}

export const GMAIL_META = {
  note: 'Gmail real vía /api/gmail/live — requiere sesión conectada. Cada persona ve su propia cuenta.'
}

// Antes "Archivar" y "Marcar leído" en la pantalla SOLO cambiaban el estado
// local de React — el mensaje seguía intacto (con INBOX/UNREAD) en la
// bandeja real de Gmail de la persona. El endpoint /api/gmail/archive ya
// existía en el backend pero nunca se llamaba desde aquí. Estas dos
// funciones lo conectan: cuando hay Gmail real conectado, la acción se
// refleja también en la bandeja real; si falla o no hay conexión (modo
// demo), no se lanza — el estado local ya cambió, que es lo único que hay
// en modo demostración.
export async function archivarGmailReal(id){
  const r = await fetch('/api/gmail/archive', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }), credentials:'same-origin' })
  if(!r.ok){ const j = await r.json().catch(()=>({})); throw new Error(j.error || `HTTP ${r.status}`) }
  return true
}

export async function marcarLeidoGmailReal(id){
  const r = await fetch('/api/gmail/read', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }), credentials:'same-origin' })
  if(!r.ok){ const j = await r.json().catch(()=>({})); throw new Error(j.error || `HTTP ${r.status}`) }
  return true
}
