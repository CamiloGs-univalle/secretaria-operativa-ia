// Sesión del usuario — dos modos, uno siempre disponible y uno "real":
// 1) Demo: cualquiera escribe su nombre/correo, se guarda solo en este
//    navegador (localStorage). No requiere nada configurado. Sigue mostrando
//    el snapshot de correos de ejemplo.
// 2) Gmail real (vía Composio): la persona conecta su propia cuenta de
//    Gmail de verdad. La sesión vive en una cookie httpOnly cifrada en el
//    servidor — aquí solo preguntamos "¿hay alguien conectado?" vía /api/auth/me.
const KEY = 'soia_user_demo'

export function getDemoUser(){
  try{ return JSON.parse(localStorage.getItem(KEY) || 'null') }catch{ return null }
}
export function setDemoUser(u){ try{ localStorage.setItem(KEY, JSON.stringify(u)) }catch{} }
export function clearDemoUser(){ try{ localStorage.removeItem(KEY) }catch{} }

export async function fetchRealSession(){
  try{
    const r = await fetch('/api/auth/me', { credentials: 'same-origin' })
    if(!r.ok) return null
    const j = await r.json()
    return j.connected ? j : null
  }catch{ return null }
}

export async function logoutReal(){
  try{ await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }) }catch{}
}

export function iniciales(nombre){
  if(!nombre) return '??'
  const partes = nombre.trim().split(/\s+/)
  return ((partes[0]?.[0] || '') + (partes[1]?.[0] || partes[0]?.[1] || '')).toUpperCase()
}
