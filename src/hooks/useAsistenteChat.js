import { useState, useEffect, useRef } from 'react'
import { updateProceso } from '../data/mockFirebase.js'
import { responderChatIA } from '../engine/asistenteChat.js'
import { construirContextoIA } from '../engine/contextoIA.js'
import { chatIA } from '../services/aiService.js'
import { parsearFechaNatural } from '../utils/textoUtils.js'

// Chat de la secretaria. Con IA configurada (Gemini) responde cualquier cosa
// usando los datos reales de la sesión + su memoria, y PROPONE acciones que
// la persona confirma con un botón. Sin IA, cae al motor de reglas de antes.
// La conversación se guarda por cuenta en este navegador.
const MAX_HIST = 60

export function useAsistenteChat({ session, iaConfigurada, procesos, correos, seguimientosFlat, recordatoriosGenerales, gcalEventos, getIaPorHilo, memoria, recordar, olvidar, ejecutores, showToast, sel, setSel, setRecordatoriosGenerales }){
  const clave = session?.email ? `mi_asistente_chat_${session.email}` : null
  const [chatOpen,setChatOpen]=useState(false)
  const [chatInput,setChatInput]=useState('')
  const [chatMessages,setChatMessages]=useState([])
  const [chatEnviando,setChatEnviando]=useState(false)
  const cargado = useRef(false)

  useEffect(()=>{
    cargado.current = false
    if(!clave) return
    let hist = []
    try{ hist = JSON.parse(localStorage.getItem(clave) || '[]') }catch{}
    setChatMessages(hist.length ? hist : [saludoInicial(session, procesos)])
    cargado.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[clave])
  useEffect(()=>{
    if(!clave || !cargado.current) return
    try{ localStorage.setItem(clave, JSON.stringify(chatMessages.slice(-MAX_HIST))) }catch{}
  },[chatMessages, clave])

  function agregarMensajeAsistente(texto, extra={}){
    setChatMessages(m=>[...m, { de:'asistente', texto, fecha:new Date().toISOString(), ...extra }])
  }
  function borrarConversacion(){
    setChatMessages([saludoInicial(session, procesos)])
  }

  async function enviarPreguntaChat(textoForzado){
    const pregunta = (textoForzado ?? chatInput).trim()
    if(!pregunta || chatEnviando) return
    const nuevoHist = [...chatMessages, { de:'usuario', texto:pregunta, fecha:new Date().toISOString() }]
    setChatMessages(nuevoHist)
    setChatInput('')
    setChatEnviando(true)
    try{
      if(iaConfigurada){
        const contexto = construirContextoIA({ session, procesos, correos, seguimientosFlat, recordatoriosGenerales, gcalEventos, iaPorHilo: getIaPorHilo?.(), memoria })
        const r = await chatIA(nuevoHist.map(m=>({ de:m.de, texto:m.texto })), contexto)
        if(r.recordar?.length) recordar(r.recordar)
        if(r.olvidar?.length) olvidar(r.olvidar)
        agregarMensajeAsistente(r.respuesta, {
          acciones: (r.acciones||[]).map(a=>({ ...a, estado:'pendiente' })),
          recordado: r.recordar?.length ? r.recordar : undefined,
        })
      } else {
        responderConReglas(pregunta)
      }
    }catch(e){
      agregarMensajeAsistente(`⚠️ ${e.message}`)
    }finally{ setChatEnviando(false) }
  }

  // Motor de reglas (sin IA configurada) — el comportamiento de siempre.
  function responderConReglas(pregunta){
    const activos = procesos.filter(p=>!['COMPLETADO','CERRADO','CANCELADO'].includes(p.estado))
    const respuesta = responderChatIA(pregunta, { procesos: activos, seguimientosFlat })
    if(!respuesta.startsWith('__RECORDATORIO__')) { agregarMensajeAsistente(respuesta); return }
    const texto = respuesta.replace('__RECORDATORIO__','')
    const fecha = parsearFechaNatural(texto)
    const match = activos.find(p=> p.responsable && texto.toLowerCase().includes(p.responsable.toLowerCase()))
    if(match){
      const seguimientos = [...(match.seguimientos||[]), {fecha, nota:texto}]
      updateProceso(match.id,{seguimientos})
      if(sel?.id===match.id) setSel(s=>s?{...s,seguimientos}:s)
      agregarMensajeAsistente(`Anotado ✅ — te lo recuerdo el ${fecha} sobre "${match.titulo}".`)
    } else {
      setRecordatoriosGenerales(r=>[{id:`rec-${Date.now()}`, texto, fecha, creado:new Date().toISOString()}, ...r])
      agregarMensajeAsistente(`Anotado ✅ — te lo recuerdo el ${fecha}: "${texto}".`)
    }
    showToast('🔔 Recordatorio guardado')
  }

  // Confirmar / descartar una acción propuesta por la IA (Action Guard).
  async function resolverAccion(iMsg, iAcc, confirmar){
    const msg = chatMessages[iMsg]; const acc = msg?.acciones?.[iAcc]
    if(!acc || acc.estado!=='pendiente') return
    const marcar = (estado, resultado) => setChatMessages(m=> m.map((x,i)=> i!==iMsg ? x : { ...x, acciones: x.acciones.map((a,j)=> j!==iAcc ? a : { ...a, estado, resultado }) }))
    if(!confirmar) return marcar('descartada')
    marcar('ejecutando')
    try{
      const fn = ejecutores[acc.tipo]
      if(!fn) throw new Error('No sé hacer esa acción todavía')
      const res = await fn(acc)
      marcar('hecha', typeof res === 'string' ? res : undefined)
    }catch(e){
      marcar('error', e.message)
    }
  }

  return { chatOpen, setChatOpen, chatInput, setChatInput, chatMessages, setChatMessages, chatEnviando, enviarPreguntaChat, resolverAccion, agregarMensajeAsistente, borrarConversacion }
}

function saludoInicial(session, procesos){
  const nombre = (session?.nombre || '').split(' ')[0]
  const activos = (procesos||[]).filter(p=>!['COMPLETADO','CERRADO','CANCELADO'].includes(p.estado))
  const meToca = activos.filter(p=>p.turnoActual==='COORDINADORA').length
  const urg = activos.filter(p=>p.prioridad==='CRITICA').length
  const estado = activos.length
    ? `Tienes ${activos.length} pendiente${activos.length===1?'':'s'}${urg?`, ${urg} urgente${urg===1?'':'s'}`:''}; ${meToca} te toca${meToca===1?'':'n'} a ti.`
    : 'Estoy revisando tu bandeja.'
  return { de:'asistente', texto:`Hola${nombre?` ${nombre}`:''} 👋 Soy tu secretaria. ${estado}\nPregúntame lo que quieras: "¿qué me falta para cerrar lo de compras?", "redacta una respuesta para Juan", "recuérdame llamar a Ana el jueves"…`, fecha:new Date().toISOString() }
}
