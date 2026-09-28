import { useState, useEffect, useCallback } from 'react'
import { estadoCalendar, conectarCalendar, desconectarCalendar, eventosCalendar, crearEventoCalendar } from '../services/calendarService.js'
import { fechaLocalISO } from '../utils/dateUtils.js'
import { updateProceso, audit } from '../data/mockFirebase.js'

const MENSAJES_RETORNO = {
  exito: '📅 Google Calendar conectado',
  cancelado: 'Conexión con Google Calendar cancelada',
  error: '⚠️ No se pudo conectar Google Calendar — inténtalo de nuevo',
  sin_gmail: '⚠️ Primero conecta tu Gmail real; luego podrás conectar Google Calendar',
  falta_configuracion: '⚠️ Google Calendar aún no está configurado en el servidor (falta COMPOSIO_GCAL_AUTH_CONFIG_ID)',
}

// Estado de la conexión con Google Calendar + eventos reales del mes que se
// está viendo en la pestaña Calendario. `calMes` = { y, m } (m base 0).
export function useGoogleCalendar({ session, calMes, showToast, refresh }){
  const [estado, setEstado] = useState({ configured: false, gmail: false, connected: false })
  const [eventos, setEventos] = useState([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)
  const [creando, setCreando] = useState(null) // id del proceso que se está enviando

  // Aviso al volver del consentimiento de Google (?calendar=...)
  useEffect(() => {
    const url = new URL(window.location.href)
    const r = url.searchParams.get('calendar')
    if(!r) return
    if(MENSAJES_RETORNO[r]) showToast(MENSAJES_RETORNO[r])
    url.searchParams.delete('calendar')
    window.history.replaceState({}, '', url.pathname + (url.search || ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const actualizarEstado = useCallback(() => {
    if(!session?.real) { setEstado({ configured: false, gmail: false, connected: false }); return }
    estadoCalendar().then(setEstado).catch(() => setEstado(e => ({ ...e, connected: false })))
  }, [session?.real, session?.email])

  useEffect(() => { actualizarEstado() }, [actualizarEstado])

  const cargarEventos = useCallback(async () => {
    if(!estado.connected) { setEventos([]); return }
    const { y, m } = calMes
    // Incluye la semana anterior/siguiente que se ve en la cuadrícula.
    const desde = new Date(y, m, 1 - 7), hasta = new Date(y, m + 1, 7, 23, 59, 59)
    setCargando(true); setError(null)
    try{
      const lista = await eventosCalendar(desde, hasta)
      setEventos(lista.map(e => ({
        ...e,
        // Fecha local del evento: los de "todo el día" ya vienen como YYYY-MM-DD.
        fecha: e.todoElDia ? String(e.inicio).slice(0, 10) : fechaLocalISO(new Date(e.inicio)),
        hora: e.todoElDia ? null : new Date(e.inicio).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
      })))
    }catch(e){
      setError(e.message); setEventos([])
    }finally{ setCargando(false) }
  }, [estado.connected, calMes.y, calMes.m])

  useEffect(() => { cargarEventos() }, [cargarEventos])

  async function desconectar(){
    try{ await desconectarCalendar(); showToast('Google Calendar desconectado de esta sesión') }
    catch(e){ showToast('⚠️ ' + e.message) }
    actualizarEstado()
  }

  // Envía el vencimiento de una tarea a Google Calendar. Guarda el id del
  // evento en el proceso para no crearlo dos veces.
  async function enviarTarea(p, { hora = '09:00' } = {}){
    if(!p?.fechaLimite) { showToast('Esta tarea no tiene fecha límite'); return null }
    if(p.gcalEventId) { showToast('Esta tarea ya está en tu Google Calendar'); return null }
    setCreando(p.id)
    try{
      const r = await crearEventoCalendar({
        titulo: `Vence: ${p.titulo}`,
        descripcion: [p.descripcion, p.proximaAccion && `Próxima acción: ${p.proximaAccion}`, `Tarea ${p.id} — Mi Asistente`].filter(Boolean).join('\n\n'),
        fecha: p.fechaLimite,
        hora,
      })
      updateProceso(p.id, { gcalEventId: r.id || 'creado', gcalEnlace: r.enlace || null })
      audit('calendar_evento_creado', { proceso: p.id, fecha: p.fechaLimite })
      refresh?.()
      showToast('📅 Agregado a tu Google Calendar')
      cargarEventos()
      return r
    }catch(e){
      showToast('⚠️ Google Calendar: ' + e.message)
      return null
    }finally{ setCreando(null) }
  }

  return {
    gcal: estado, gcalEventos: eventos, gcalCargando: cargando, gcalError: error, gcalCreando: creando,
    conectarCalendar, desconectarCalendar: desconectar, recargarCalendar: cargarEventos, enviarTareaACalendar: enviarTarea,
  }
}
