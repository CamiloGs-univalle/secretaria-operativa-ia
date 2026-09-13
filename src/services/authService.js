// Sesión del usuario — ahora con Firebase Auth (cualquier Google) + Composio Gmail opcional
// 1) Firebase: cualquier persona hace "Continuar con Google" y entra con su correo real (multi-usuario).
//    La sesión vive en Firebase Auth (persistencia local), no en localStorage. Firestore guarda datos compartidos.
// 2) Demo (fallback): si Firebase no está configurado o el usuario no quiere Google, sigue modo demo localStorage.
// 3) Gmail real (Composio): después de entrar con Google, puede opcionalmente conectar su Gmail para traer correos reales.
import { auth, googleProvider } from '../lib/firebase.js'
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'

const KEY = 'soia_user_demo'

// Demo local (fallback sin Firebase)
export function getDemoUser(){
  try{ return JSON.parse(localStorage.getItem(KEY) || 'null') }catch{ return null }
}
export function setDemoUser(u){ try{ localStorage.setItem(KEY, JSON.stringify(u)) }catch{} }
export function clearDemoUser(){ try{ localStorage.removeItem(KEY) }catch{} }

// Firebase Google — cualquier correo
export async function signInWithGoogle(){
  const cred = await signInWithPopup(auth, googleProvider)
  const u = cred.user
  return { nombre: u.displayName || u.email, email: u.email, photo: u.photoURL, uid: u.uid, real: true, firebase: true }
}

export async function logoutFirebase(){
  try{ await signOut(auth) }catch{}
  clearDemoUser()
}

export function onFirebaseAuthChange(cb){
  return onAuthStateChanged(auth, (user)=>{
    if(user) cb({ nombre: user.displayName || user.email, email: user.email, photo: user.photoURL, uid: user.uid, real:true, firebase:true })
    else cb(null)
  })
}

// Composio Gmail real (opcional, después del login Firebase)
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
