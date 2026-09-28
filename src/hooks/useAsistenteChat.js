import { useState } from 'react'
import { updateProceso } from '../data/mockFirebase.js'
import { responderChatIA } from '../engine/asistenteChat.js'
import { parsearFechaNatural } from '../utils/textoUtils.js'

// Chat real del "Asistente personal" (sección 15/43): pregunta en lenguaje
// natural → responderChatIA cruza los datos reales de la sesión (procesos,
// seguimientos). Si detecta "recuérdame X", intenta engancharlo a la
// tarea/contacto que mejor calce por nombre; si no encuentra nada, igual lo
// guarda como recordatorio general — nunca se pierde lo que la persona pidió
// recordar.
export function useAsistenteChat({ procesos, seguimientosFlat, showToast, sel, setSel, setRecordatoriosGenerales }){
  const [chatOpen,setChatOpen]=useState(false)
  const [chatInput,setChatInput]=useState('')
  const [chatMessages,setChatMessages]=useState(()=>[{ de:'asistente', texto:'Hola 👋 Soy tu asistente. Pregúntame cosas como "¿quién no me ha respondido?" o "recuérdame llamar a Juan mañana".' }])
  const [chatEnviando,setChatEnviando]=useState(false)

  function enviarPreguntaChat(textoForzado){
    const pregunta = (textoForzado ?? chatInput).trim()
    if(!pregunta || chatEnviando) return
    setChatMessages(m=>[...m, {de:'usuario', texto:pregunta}])
    setChatInput('')
    setChatEnviando(true)
    setTimeout(()=>{
      const activos = procesos.filter(p=>!['COMPLETADO','CERRADO','CANCELADO'].includes(p.estado))
      const respuesta = responderChatIA(pregunta, { procesos: activos, seguimientosFlat })
      if(respuesta.startsWith('__RECORDATORIO__')){
        const texto = respuesta.replace('__RECORDATORIO__','')
        const fecha = parsearFechaNatural(texto)
        const match = activos.find(p=> texto.toLowerCase().includes((p.responsable||'###').toLowerCase()) && p.responsable)
        if(match){
          const seguimientos = [...(match.seguimientos||[]), {fecha, nota:texto}]
          updateProceso(match.id,{seguimientos})
          if(sel?.id===match.id) setSel(s=>s?{...s,seguimientos}:s)
          setChatMessages(m=>[...m, {de:'asistente', texto:`Anotado ✅ — te lo recuerdo el ${fecha} sobre "${match.titulo}".`}])
        } else {
          setRecordatoriosGenerales(r=>[{id:`rec-${Date.now()}`, texto, fecha, creado:new Date().toISOString()}, ...r])
          setChatMessages(m=>[...m, {de:'asistente', texto:`Anotado ✅ — te lo recuerdo el ${fecha}: "${texto}".`}])
        }
        showToast('🔔 Recordatorio guardado')
      } else {
        setChatMessages(m=>[...m, {de:'asistente', texto:respuesta}])
      }
      setChatEnviando(false)
    }, 350) // pequeña pausa: se siente "pensando" en vez de una respuesta instantánea y fría
  }

  return { chatOpen, setChatOpen, chatInput, setChatInput, chatMessages, setChatMessages, chatEnviando, enviarPreguntaChat }
}
