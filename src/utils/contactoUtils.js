import { estadoSeguimiento } from './estadoUtils.js'

// Regex simple de validación de correo — usada al derivar contactos.
export const RE_EMAIL = /^\S+@\S+\.\S+$/

// Colores de avatar consistentes por persona (mismo remitente = mismo
// color siempre) — igual que el mockup, sin depender de una foto real.
export const AVATAR_COLORES = ['#059669','#2563EB','#7C3AED','#DC2626','#D97706','#0D9488','#DB2777','#4F46E5']
export function colorDeAvatar(str){
  let h=0; for(let i=0;i<(str||'').length;i++) h=(h*31+str.charCodeAt(i))>>>0
  return AVATAR_COLORES[h%AVATAR_COLORES.length]
}
export function inicialesDe(nombre){
  const partes=(nombre||'').trim().split(/\s+/).filter(Boolean)
  if(!partes.length) return '?'
  return (partes[0][0]+(partes[1]?.[0]||'')).toUpperCase()
}

export function nombreDeRemitente(remitente){ return (remitente||'').split('<')[0].trim() || remitente || '—' }
export function correoDeRemitente(remitente){ const m=(remitente||'').match(/<([^>]+)>/); return (m? m[1] : remitente || '').toLowerCase().trim() }

// --- Contactos: nadie los crea a mano, se arman solos con quién ha
// escrito, cuántas veces, y qué queda pendiente/esperando con cada uno.
export function derivarContactos(correos, procesos){
  const map = new Map()
  correos.forEach(c=>{
    const email = correoDeRemitente(c.remitente)
    if(!email || !RE_EMAIL.test(email)) return
    if(!map.has(email)) map.set(email, { email, nombre: nombreDeRemitente(c.remitente), empresa: (email.split('@')[1]||'').split('.')[0], conversaciones:0, ultima:null, temas:new Set(), pendientes:0, esperando:0 })
    const c2 = map.get(email)
    c2.conversaciones++
    if(!c2.ultima || new Date(c.fecha)>new Date(c2.ultima)) c2.ultima=c.fecha
    if(c.asunto) c2.temas.add(c.asunto.replace(/^(re|fwd):\s*/i,'').slice(0,40))
  })
  procesos.forEach(p=>{
    const correosDelProceso = correos.filter(c=> p.correos?.includes(c.id) || (p.hiloId && c.hiloId===p.hiloId))
    const vistos = new Set()
    correosDelProceso.forEach(c=>{
      const email = correoDeRemitente(c.remitente)
      const c2 = map.get(email)
      if(!c2 || vistos.has(email)) return
      vistos.add(email)
      if(!['COMPLETADO','CERRADO','CANCELADO'].includes(p.estado)){
        if(p.turnoActual==='COORDINADORA') c2.pendientes++
        else c2.esperando++
      }
    })
  })
  return [...map.values()].map(c=>({...c, temas:[...c.temas].slice(0,3)})).sort((a,b)=> new Date(b.ultima)-new Date(a.ultima))
}

export function flattenSeguimientos(procesos){
  const out=[]
  procesos.forEach(p=>{
    ;(p.seguimientos||[]).forEach((s,i)=>{
      out.push({ segId:`${p.id}::${i}`, procesoId:p.id, idx:i, titulo:p.titulo, contacto:p.responsable, fecha:s.fecha, nota:s.nota, prioridad:p.prioridad, estado: estadoSeguimiento(s) })
    })
  })
  return out.sort((a,b)=> new Date(a.fecha)-new Date(b.fecha))
}
