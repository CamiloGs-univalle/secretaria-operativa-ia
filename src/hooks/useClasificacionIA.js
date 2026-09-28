import { useState, useEffect, useRef, useCallback } from 'react'
import { updateProceso, addProceso, audit, getProcesos } from '../data/mockFirebase.js'
import { clasificarHilosIA, etiquetarGmailIA } from '../services/aiService.js'
import { fechaLocalISO } from '../utils/dateUtils.js'
import { correoDeRemitente } from '../utils/contactoUtils.js'
import { evaluarReglas } from './useEntrenamientoIA.js'

// La secretaria revisa cada conversación de la bandeja con IA: la etiqueta,
// decide si ya se cerró, si le falta algo o a quién le toca, y actualiza la
// tarea correspondiente (o crea una si hace falta). Solo re-analiza los hilos
// que cambiaron desde la última vez (caché por cuenta en este navegador).
const LOTE = 10, MAX_POR_RONDA = 30
const ESTADO_PROCESO = { CERRADO: 'COMPLETADO', ESPERANDO_OTRO: 'ESPERANDO', PENDIENTE_MI_RESPUESTA: 'PENDIENTE', FALTA_INFO: 'PENDIENTE' }
const CERRADOS = ['COMPLETADO', 'CERRADO', 'CANCELADO']

export function useClasificacionIA({ session, iaConfigurada, correos, procesos, refresh, configuracion, gmailConectado, agregarMensajeAsistente, showToast, entrenamiento }){
  const entRef = useRef(entrenamiento)
  entRef.current = entrenamiento
  const clave = session?.email ? `mi_asistente_ia_${session.email}` : null
  const [iaPorHilo, setIaPorHilo] = useState({})
  const [clasificando, setClasificando] = useState(false)
  const corriendo = useRef(false)
  const auto = configuracion?.clasificacionIA !== false

  useEffect(() => {
    if(!clave) { setIaPorHilo({}); return }
    try{ setIaPorHilo(JSON.parse(localStorage.getItem(clave) || '{}')) }catch{ setIaPorHilo({}) }
  }, [clave])

  const clasificar = useCallback(async ({ forzar = false, silencioso = false } = {}) => {
    if(!iaConfigurada || !session?.real || corriendo.current || !correos.length) return
    corriendo.current = true; setClasificando(true)
    try{
      let cache = {}
      try{ cache = JSON.parse(localStorage.getItem(clave) || '{}') }catch{}
      const miEmail = (session.email || '').toLowerCase()
      const porHilo = {}
      for(const c of correos){ (porHilo[c.hiloId] = porHilo[c.hiloId] || []).push(c) }
      const pendientes = Object.entries(porHilo).map(([hiloId, msgs]) => {
        msgs.sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
        const firma = `${msgs.length}:${msgs[msgs.length - 1].id}`
        return { hiloId, msgs, firma }
      }).filter(h => forzar || cache[h.hiloId]?.firma !== h.firma)
        .sort((a, b) => new Date(b.msgs[b.msgs.length - 1].fecha) - new Date(a.msgs[a.msgs.length - 1].fecha))
        .slice(0, MAX_POR_RONDA)
      if(!pendientes.length){ if(!silencioso) showToast('✨ Tu bandeja ya está revisada'); return }

      const resultados = []
      for(let i = 0; i < pendientes.length; i += LOTE){
        const lote = pendientes.slice(i, i + LOTE)
        const r = await clasificarHilosIA(lote.map(h => ({
          hiloId: h.hiloId, asunto: h.msgs[0].asunto,
          mensajes: h.msgs.map(m => ({ de: correoDeRemitente(m.remitente) === miEmail ? `YO (${miEmail})` : m.remitente, para: (m.destinatarios || []).join(', '), fecha: m.fecha, texto: m.cuerpo })),
        })), fechaLocalISO(), entRef.current)
        for(const res of r.hilos || []){
          const h = lote.find(x => x.hiloId === res.hiloId)
          if(!h) continue
          // Reglas de la persona: se aplican siempre, aunque la IA opine distinto.
          const ult = h.msgs[h.msgs.length - 1]
          const rg = evaluarReglas(entRef.current, { remitente: h.msgs.map(m => m.remitente).join(' '), asunto: h.msgs[0].asunto, cuerpo: ult.cuerpo })
          if(rg.ignorar && !rg.vip){ res.estado = res.estado === 'CERRADO' ? 'CERRADO' : 'INFORMATIVO'; res.prioridad = 'BAJA' }
          if(rg.vip && ['MEDIA', 'BAJA'].includes(res.prioridad)) res.prioridad = 'ALTA'
          if(rg.clave && ['MEDIA', 'BAJA'].includes(res.prioridad)) res.prioridad = 'ALTA'
          resultados.push({ ...res, firma: h.firma, ultimoId: ult.id, msgs: h.msgs })
        }
      }

      // Aplicar a las tareas
      const lista = getProcesos()
      const cuenta = { CERRADO: 0, ESPERANDO_OTRO: 0, PENDIENTE_MI_RESPUESTA: 0, FALTA_INFO: 0, nuevas: 0 }
      for(const r of resultados){
        cuenta[r.estado] = (cuenta[r.estado] || 0) + 1
        const p = lista.find(x => x.hiloId === r.hiloId || r.msgs.some(m => x.correos?.includes(m.id)))
        const patch = { iaEtiquetas: r.etiquetas, iaEstado: r.estado, iaResumen: r.resumen, iaFalta: r.falta || '', iaSiguientePaso: r.siguientePaso, iaRevisado: fechaLocalISO() }
        if(p){
          if(p.origen === 'manual' || CERRADOS.includes(p.estado)) { await updateProceso(p.id, patch); continue }
          const historial = [...(p.historial || [])]
          if(r.estado !== p.iaEstado && ESTADO_PROCESO[r.estado]){
            patch.estado = ESTADO_PROCESO[r.estado]
            patch.turnoActual = r.estado === 'ESPERANDO_OTRO' ? 'OTRA_PERSONA' : 'COORDINADORA'
            if(r.estado === 'CERRADO') patch.fechaCierre = new Date().toISOString()
            historial.push({ fecha: fechaLocalISO(), icon: '✨', texto: `Secretaria IA: ${textoEstado(r.estado)}${r.falta ? ` — falta: ${r.falta}` : ''}` })
          }
          if(r.prioridad) patch.prioridad = r.prioridad
          if(/^\d{4}-\d{2}-\d{2}$/.test(r.fechaLimite || '')) patch.fechaLimite = r.fechaLimite
          if(r.siguientePaso) patch.proximaAccion = r.siguientePaso.slice(0, 80)
          await updateProceso(p.id, { ...patch, historial })
        } else if(r.estado === 'PENDIENTE_MI_RESPUESTA' || r.estado === 'FALTA_INFO'){
          // Algo que requiere acción y que las reglas no habían convertido en tarea.
          const m0 = r.msgs[0]
          const id = `IA-${Date.now().toString(36).toUpperCase()}${cuenta.nuevas}`
          await addProceso({
            id, hiloId: r.hiloId, propietario: session.email, titulo: (m0.asunto || 'Correo').slice(0, 65), descripcion: r.resumen,
            origen: 'Gmail', categoria: r.etiquetas?.[0] || 'General', responsable: 'Coordinadora', area: 'Operaciones',
            prioridad: r.prioridad || 'MEDIA', estado: 'PENDIENTE', etapa: 'Inicial',
            fechaLimite: /^\d{4}-\d{2}-\d{2}$/.test(r.fechaLimite || '') ? r.fechaLimite : fechaLocalISO(new Date(Date.now() + 3 * 86400000)),
            creado: m0.fecha, ultimaActividad: r.msgs[r.msgs.length - 1].fecha, tiempoObjetivo: 3, tiempoTranscurrido: 0,
            proximaAccion: (r.siguientePaso || 'Responder').slice(0, 80), correos: r.msgs.map(m => m.id),
            tareas: r.falta ? [{ id: `t-${id}-0`, titulo: r.falta, done: false }] : [], incidencias: [], seguimientos: [],
            historial: [{ fecha: fechaLocalISO(), icon: '✨', texto: 'Tarea creada por la secretaria IA' }],
            turnoActual: 'COORDINADORA', esperanRespuesta: true, ...patch,
          })
          cuenta.nuevas++
        }
      }

      // Etiquetas en Gmail real (opcional)
      if(configuracion?.etiquetarGmail && gmailConectado){
        const items = resultados.filter(r => r.etiquetas?.length && !cache[r.hiloId]?.gmail?.includes(r.etiquetas[0]))
          .map(r => ({ messageId: r.ultimoId, etiqueta: r.etiquetas[0] }))
        if(items.length){
          try{ const g = await etiquetarGmailIA(items); if(g.fallidas) showToast(`⚠️ ${g.fallidas} etiqueta(s) no se aplicaron en Gmail`) ; items.forEach(it => { const r = resultados.find(x => x.ultimoId === it.messageId); if(r) r.gmail = [it.etiqueta] }) }
          catch(e){ showToast('⚠️ Etiquetas en Gmail: ' + e.message) }
        }
      }

      const nuevoCache = { ...cache }
      for(const r of resultados){
        const { msgs, ...resto } = r
        nuevoCache[r.hiloId] = { ...resto, gmail: r.gmail || cache[r.hiloId]?.gmail }
      }
      try{ localStorage.setItem(clave, JSON.stringify(nuevoCache)) }catch{}
      setIaPorHilo(nuevoCache)
      refresh?.()
      audit('ia_clasificacion', { hilos: resultados.length, ...cuenta })

      const partes = []
      if(cuenta.PENDIENTE_MI_RESPUESTA) partes.push(`🟠 ${cuenta.PENDIENTE_MI_RESPUESTA} te toca${cuenta.PENDIENTE_MI_RESPUESTA === 1 ? '' : 'n'} a ti`)
      if(cuenta.FALTA_INFO) partes.push(`🟡 ${cuenta.FALTA_INFO} le${cuenta.FALTA_INFO === 1 ? '' : 's'} falta algo`)
      if(cuenta.ESPERANDO_OTRO) partes.push(`🔵 ${cuenta.ESPERANDO_OTRO} esperando respuesta de otros`)
      if(cuenta.CERRADO) partes.push(`✅ ${cuenta.CERRADO} ya se cerr${cuenta.CERRADO === 1 ? 'ó' : 'aron'}`)
      if(resultados.length) agregarMensajeAsistente(`Revisé ${resultados.length} conversación${resultados.length === 1 ? '' : 'es'} de tu correo:\n${partes.join('\n') || 'Nada que requiera acción.'}${cuenta.nuevas ? `\nCreé ${cuenta.nuevas} tarea${cuenta.nuevas === 1 ? '' : 's'} nueva${cuenta.nuevas === 1 ? '' : 's'} para lo que no tenía seguimiento.` : ''}\nPregúntame por cualquiera y te digo qué falta.`)
    }catch(e){
      if(!silencioso) showToast('⚠️ Secretaria IA: ' + e.message)
      console.warn('[clasificacionIA]', e.message)
    }finally{ corriendo.current = false; setClasificando(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iaConfigurada, session?.email, session?.real, correos, clave, configuracion?.etiquetarGmail, gmailConectado])

  // Automático: cada vez que llegan correos nuevos.
  useEffect(() => {
    if(!auto || !iaConfigurada || !correos.length) return
    const t = setTimeout(() => clasificar({ silencioso: true }), 1500)
    return () => clearTimeout(t)
  }, [auto, iaConfigurada, correos, clasificar])

  // Corrección manual de la persona para un hilo: se guarda en la caché (la
  // bandeja lo refleja ya) y se aplica a su tarea.
  const corregirHilo = useCallback(async (hiloId, { estado, etiqueta, falta }) => {
    let cache = {}
    try{ cache = JSON.parse(localStorage.getItem(clave) || '{}') }catch{}
    const prev = cache[hiloId] || {}
    cache[hiloId] = { ...prev, hiloId, estado, etiquetas: [etiqueta, ...(prev.etiquetas || []).filter(x => x !== etiqueta)].filter(Boolean).slice(0, 3), falta: falta ?? prev.falta ?? '', corregido: true }
    try{ localStorage.setItem(clave, JSON.stringify(cache)) }catch{}
    setIaPorHilo(cache)
    const p = getProcesos().find(x => x.hiloId === hiloId)
    if(p && !CERRADOS.includes(p.estado) && ESTADO_PROCESO[estado]){
      await updateProceso(p.id, {
        iaEstado: estado, iaEtiquetas: cache[hiloId].etiquetas, iaFalta: cache[hiloId].falta,
        estado: ESTADO_PROCESO[estado], turnoActual: estado === 'ESPERANDO_OTRO' ? 'OTRA_PERSONA' : 'COORDINADORA',
        ...(estado === 'CERRADO' ? { fechaCierre: new Date().toISOString() } : {}),
        historial: [...(p.historial || []), { fecha: fechaLocalISO(), icon: '🎓', texto: `Corregido por ti: ${textoEstado(estado)}${etiqueta ? ` · ${etiqueta}` : ''}` }],
      })
      refresh?.()
    }
  }, [clave, refresh])

  return { iaPorHilo, clasificando, clasificarAhora: () => clasificar({ forzar: false }), reanalizarTodo: () => clasificar({ forzar: true }), corregirHilo }
}

function textoEstado(e){
  return { CERRADO: 'el asunto quedó cerrado', ESPERANDO_OTRO: 'esperando respuesta de la otra persona', PENDIENTE_MI_RESPUESTA: 'te toca responder', FALTA_INFO: 'falta información para cerrarlo' }[e] || e
}
