import { useState, useEffect, useCallback, useRef } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db, auth } from '../lib/firebase.js'

// "Entrenamiento" de la secretaria IA — lo que cada persona le enseña:
//  • perfil: quién es, su cargo, en qué trabaja, qué le importa
//  • reglas: remitentes VIP, palabras clave importantes, cosas a ignorar
//  • etiquetas propias (nombre + cuándo usarla)
//  • estilo: tono y firma para los borradores
//  • instrucciones libres ("si un proveedor manda factura, crea tarea para…")
//  • ejemplos: correcciones que la persona hizo a la clasificación (aprendizaje)
// Se guarda en Firestore usuarios/{uid}.entrenamiento (sigue a la persona en
// cualquier equipo) y en este navegador como respaldo.
export const PERFIL_VACIO = {
  perfil: { cargo: '', area: '', responsabilidades: '', importante: '' },
  reglas: { vip: [], palabrasClave: [], ignorar: [] },
  etiquetas: [],            // [{ nombre, descripcion }]
  estilo: { tono: 'cordial', firma: '', idioma: 'tú' },
  instrucciones: '',
  ejemplos: [],             // [{ asunto, de, extracto, estado, etiqueta, nota, fecha }]
}
const MAX_EJEMPLOS = 40

export function useEntrenamientoIA(email){
  const [entrenamiento, setEntrenamiento] = useState(PERFIL_VACIO)
  const [guardado, setGuardado] = useState(null) // fecha del último guardado
  const listo = useRef(false)
  const clave = email ? `mi_asistente_entrenamiento_${email}` : null

  useEffect(() => {
    listo.current = false
    if(!clave){ setEntrenamiento(PERFIL_VACIO); return }
    let local = null
    try{ local = JSON.parse(localStorage.getItem(clave) || 'null') }catch{}
    setEntrenamiento(normalizar(local))
    const uid = auth.currentUser?.uid
    if(!uid){ listo.current = true; return }
    getDoc(doc(db, 'usuarios', uid))
      .then(s => { const r = s.exists() ? s.data().entrenamiento : null; if(r) setEntrenamiento(normalizar(r)) })
      .catch(e => console.warn('[entrenamiento] lectura', e.message))
      .finally(() => { listo.current = true })
  }, [clave])

  useEffect(() => {
    if(!clave || !listo.current) return
    const t = setTimeout(() => {
      try{ localStorage.setItem(clave, JSON.stringify(entrenamiento)) }catch{}
      const uid = auth.currentUser?.uid
      if(uid) setDoc(doc(db, 'usuarios', uid), { entrenamiento, email, actualizado: new Date().toISOString() }, { merge: true })
        .then(() => setGuardado(new Date()))
        .catch(e => console.warn('[entrenamiento] escritura', e.message))
      else setGuardado(new Date())
    }, 600)
    return () => clearTimeout(t)
  }, [entrenamiento, clave, email])

  const actualizar = useCallback((fn) => { listo.current = true; setEntrenamiento(e => normalizar(typeof fn === 'function' ? fn(e) : { ...e, ...fn })) }, [])

  const agregarRegla = useCallback((tipo, valor) => {
    const v = String(valor || '').trim()
    if(!v || !['vip', 'palabrasClave', 'ignorar'].includes(tipo)) return false
    actualizar(e => ({ ...e, reglas: { ...e.reglas, [tipo]: e.reglas[tipo].some(x => x.toLowerCase() === v.toLowerCase()) ? e.reglas[tipo] : [...e.reglas[tipo], v] } }))
    return true
  }, [actualizar])
  const quitarRegla = useCallback((tipo, valor) => actualizar(e => ({ ...e, reglas: { ...e.reglas, [tipo]: e.reglas[tipo].filter(x => x !== valor) } })), [actualizar])

  const agregarEjemplo = useCallback((ej) => {
    actualizar(e => ({ ...e, ejemplos: [...e.ejemplos.filter(x => !(x.asunto === ej.asunto && x.de === ej.de)), { ...ej, fecha: new Date().toISOString().slice(0, 10) }].slice(-MAX_EJEMPLOS) }))
  }, [actualizar])

  return { entrenamiento, actualizar, agregarRegla, quitarRegla, agregarEjemplo, guardado }
}

function normalizar(x){
  const e = x || {}
  return {
    perfil: { ...PERFIL_VACIO.perfil, ...(e.perfil || {}) },
    reglas: { vip: arr(e.reglas?.vip), palabrasClave: arr(e.reglas?.palabrasClave), ignorar: arr(e.reglas?.ignorar) },
    etiquetas: (Array.isArray(e.etiquetas) ? e.etiquetas : []).filter(t => t?.nombre).map(t => ({ nombre: String(t.nombre).slice(0, 40), descripcion: String(t.descripcion || '').slice(0, 200) })).slice(0, 20),
    estilo: { ...PERFIL_VACIO.estilo, ...(e.estilo || {}) },
    instrucciones: String(e.instrucciones || '').slice(0, 3000),
    ejemplos: Array.isArray(e.ejemplos) ? e.ejemplos.slice(-MAX_EJEMPLOS) : [],
  }
}
const arr = a => (Array.isArray(a) ? a : []).map(String).filter(Boolean).slice(0, 50)

// Aplica las reglas de la persona sobre un remitente/asunto/cuerpo. Devuelve
// { vip, clave, ignorar } — se usa para forzar prioridad sin depender de la IA.
export function evaluarReglas(entrenamiento, { remitente = '', asunto = '', cuerpo = '' }){
  const r = entrenamiento?.reglas || {}
  const de = remitente.toLowerCase(), texto = `${asunto} ${cuerpo}`.toLowerCase()
  const calza = v => { const x = v.toLowerCase().trim(); return x && (de.includes(x) || texto.includes(x)) }
  return {
    vip: (r.vip || []).some(v => de.includes(v.toLowerCase().trim())),
    clave: (r.palabrasClave || []).find(calza) || null,
    ignorar: (r.ignorar || []).some(calza),
  }
}
