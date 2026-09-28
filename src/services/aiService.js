// Secretaria IA (Gemini) — todo pasa por /api/ai/* (la API key vive en el servidor).
import { auth } from '../lib/firebase.js'

async function cabeceras(){
  const h = { 'Content-Type': 'application/json' }
  try{ const t = await auth.currentUser?.getIdToken(); if(t) h.Authorization = `Bearer ${t}` }catch{}
  return h
}

async function pedir(ruta, body){
  const r = await fetch(`/api/ai/${ruta}`, {
    method: body ? 'POST' : 'GET',
    headers: await cabeceras(),
    credentials: 'same-origin',
    cache: 'no-store',
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if(!r.ok) throw new Error(j.note || j.error || `HTTP ${r.status}`)
  return j
}

export const estadoIA = () => pedir('status')
export const chatIA = (mensajes, contexto) => pedir('chat', { mensajes, contexto })
export const clasificarHilosIA = (hilos, hoy, entrenamiento) => pedir('clasificar', { hilos, hoy, entrenamiento })
export const etiquetarGmailIA = (items) => pedir('etiquetar-gmail', { items })
