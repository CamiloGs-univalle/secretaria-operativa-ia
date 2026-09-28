import { useState, useEffect, useCallback, useRef } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db, auth } from '../lib/firebase.js'

// Memoria duradera de la secretaria: hechos que la persona le contó
// ("Juan es el contacto de compras", "prefiere avisos a las 8"). Se guarda en
// Firestore (usuarios/{uid}) cuando hay sesión de Google, y siempre en este
// navegador como respaldo. Máximo 80 recuerdos.
const MAX = 80
export function useMemoriaAsistente(email){
  const [memoria, setMemoria] = useState([])
  const listo = useRef(false)
  const clave = email ? `mi_asistente_memoria_${email}` : null

  useEffect(() => {
    listo.current = false
    if(!clave) { setMemoria([]); return }
    let local = []
    try{ local = JSON.parse(localStorage.getItem(clave) || '[]') }catch{}
    setMemoria(local)
    const uid = auth.currentUser?.uid
    if(!uid) { listo.current = true; return }
    getDoc(doc(db, 'usuarios', uid))
      .then(s => { const remota = s.exists() ? (s.data().memoria || []) : []; if(remota.length) setMemoria(unir(remota, local)) })
      .catch(e => console.warn('[memoria] lectura Firestore', e.message))
      .finally(() => { listo.current = true })
  }, [clave])

  useEffect(() => {
    if(!clave || !listo.current) return
    try{ localStorage.setItem(clave, JSON.stringify(memoria)) }catch{}
    const uid = auth.currentUser?.uid
    if(uid) setDoc(doc(db, 'usuarios', uid), { memoria, email, actualizado: new Date().toISOString() }, { merge: true }).catch(e => console.warn('[memoria] escritura Firestore', e.message))
  }, [memoria, clave, email])

  const recordar = useCallback((textos) => {
    const nuevos = (Array.isArray(textos) ? textos : [textos]).map(t => String(t || '').trim()).filter(Boolean)
    if(!nuevos.length) return
    listo.current = true
    setMemoria(m => unir(m, nuevos.map(texto => ({ texto, fecha: new Date().toISOString().slice(0, 10) }))).slice(-MAX))
  }, [])
  const olvidar = useCallback((textos) => {
    const quitar = new Set((Array.isArray(textos) ? textos : [textos]).map(t => String(t).trim().toLowerCase()))
    listo.current = true
    setMemoria(m => m.filter(x => !quitar.has(x.texto.trim().toLowerCase())))
  }, [])

  return { memoria, recordar, olvidar }
}

function unir(a, b){
  const vistos = new Set(), out = []
  for(const x of [...a, ...b]){
    const k = (x?.texto || '').trim().toLowerCase()
    if(!k || vistos.has(k)) continue
    vistos.add(k); out.push(x)
  }
  return out
}
