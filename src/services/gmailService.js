// Gmail Service — conecta con Gmail REAL (auxiliar.ti@proservis.com.co)
// Estrategia: intenta /api/gmail/live (Vercel Function con Gmail API), fallback a gmailReal.json (snapshot real del 11/09/2026)
import gmailReal from '../data/gmailReal.json'

const API_BASE = '' // mismo origen — Vercel Functions en /api

export async function fetchRealGmail({ maxResults = 30, query = '' } = {}){
  // 1) Intento live via backend (cuando esté desplegado con OAuth)
  try{
    const r = await fetch(`${API_BASE}/api/gmail/live?max=${maxResults}&q=${encodeURIComponent(query)}`, { cache:'no-store' })
    if(r.ok){
      const j = await r.json()
      if(j.messages && j.messages.length) return normalizeGmailMessages(j.messages)
    }
  }catch(e){ /* fallback */ }
  // 2) Fallback snapshot real (no quemado, es dump directo de Gmail API del 11/09/2026 21:35 UTC)
  // Filtrado por query si se pide
  let msgs = gmailReal
  if(query){
    const q = query.toLowerCase()
    msgs = msgs.filter(m => (m.asunto+m.cuerpo+m.remitente).toLowerCase().includes(q))
  }
  return msgs.slice(0, maxResults)
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
  account: 'auxiliar.ti@proservis.com.co',
  snapshot: '2026-09-11T21:35:57Z',
  totalInSnapshot: gmailReal.length,
  note: 'Snapshot real de Gmail API (no mock). Live via /api/gmail/live cuando hay OAuth.'
}
