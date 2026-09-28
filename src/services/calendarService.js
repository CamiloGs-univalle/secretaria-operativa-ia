// Google Calendar real — todo pasa por /api/calendar/* (Composio en el
// backend); ningún token de Google llega al navegador.

async function pedir(url, opciones = {}){
  const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...opciones })
  const j = await r.json().catch(() => ({}))
  if(!r.ok){
    if(j.detalle) console.warn('[Calendar]', url, j.detalle)
    throw new Error([j.note || j.error || `HTTP ${r.status}`, j.detalle].filter(Boolean).join(' — Detalle: '))
  }
  return j
}

export function estadoCalendar(){
  return pedir('/api/calendar/status')
}

export function conectarCalendar(){
  window.location.href = '/api/calendar/connect'
}

export function desconectarCalendar(){
  return pedir('/api/calendar/disconnect', { method: 'POST' })
}

// desde/hasta: objetos Date locales — se envían en ISO (UTC) para que el
// rango sea exacto sin importar la zona horaria del servidor.
export async function eventosCalendar(desde, hasta){
  const q = new URLSearchParams({ timeMin: desde.toISOString(), timeMax: hasta.toISOString() })
  const j = await pedir(`/api/calendar/events?${q}`)
  return j.eventos || []
}

export function crearEventoCalendar({ titulo, descripcion, fecha, hora = '09:00', duracionMin = 30 }){
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota'
  return pedir('/api/calendar/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ titulo, descripcion, fecha, hora, duracionMin, timezone }),
  })
}
