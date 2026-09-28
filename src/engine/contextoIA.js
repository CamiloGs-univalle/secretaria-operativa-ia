import { estadoEfectivo, fechaLocalISO } from '../utils/dateUtils.js'
import { nombreDeRemitente } from '../utils/contactoUtils.js'

// Resumen compacto de los datos reales de la sesión para la secretaria IA.
// Se limita el tamaño para no gastar cuota ni mandar más de lo necesario.
export function construirContextoIA({ session, procesos, correos, seguimientosFlat, recordatoriosGenerales, gcalEventos, iaPorHilo, memoria, entrenamiento }){
  const cerrados = ['COMPLETADO', 'CERRADO', 'CANCELADO']
  const activos = procesos.filter(p => !cerrados.includes(p.estado))
  const recientesCerrados = procesos.filter(p => cerrados.includes(p.estado))
    .sort((a, b) => String(b.ultimaActividad).localeCompare(String(a.ultimaActividad))).slice(0, 10)
  const tarea = p => ({
    id: p.id, titulo: p.titulo, estado: estadoEfectivo(p), prioridad: p.prioridad, vence: p.fechaLimite,
    leToca: p.turnoActual === 'COORDINADORA' ? 'a mí' : 'a la otra persona', responsable: p.responsable,
    proximaAccion: p.iaSiguientePaso || p.proximaAccion, falta: p.iaFalta || undefined, resumenIA: p.iaResumen || undefined,
    ultimaActividad: String(p.ultimaActividad || '').slice(0, 10),
    seguimientos: (p.seguimientos || []).filter(s => !s.completado && !s.cancelado).map(s => ({ fecha: s.fecha, nota: s.nota })),
    enGoogleCalendar: !!p.gcalEventId || undefined,
  })
  const correosOrden = [...correos].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 40)
  return {
    hoy: fechaLocalISO(),
    zona: Intl.DateTimeFormat().resolvedOptions().timeZone,
    nombre: session?.nombre,
    memoria: (memoria || []).map(m => m.texto),
    entrenamiento,
    tareas: [...activos.slice(0, 60).map(tarea), ...recientesCerrados.map(tarea)],
    correos: correosOrden.map(c => {
      const ia = iaPorHilo?.[c.hiloId]
      return {
        id: c.id, hiloId: c.hiloId, de: nombreDeRemitente(c.remitente) + ' <' + (c.remitente.match(/<([^>]+)>/)?.[1] || c.remitente) + '>',
        asunto: c.asunto, fecha: String(c.fecha).slice(0, 16), noLeido: (c.etiquetas || []).includes('UNREAD') || undefined,
        extracto: String(c.cuerpo || '').replace(/\s+/g, ' ').slice(0, 280),
        ia: ia ? { etiquetas: ia.etiquetas, estado: ia.estado, falta: ia.falta || undefined } : undefined,
      }
    }),
    seguimientos: seguimientosFlat.filter(s => ['PENDIENTE', 'PROXIMO', 'VENCIDO'].includes(s.estado)).slice(0, 30)
      .map(s => ({ procesoId: s.procesoId, titulo: s.titulo, fecha: s.fecha, nota: s.nota, estado: s.estado })),
    recordatorios: (recordatoriosGenerales || []).slice(0, 20).map(r => ({ texto: r.texto, fecha: r.fecha })),
    calendario: (gcalEventos || []).filter(e => e.fecha >= fechaLocalISO()).slice(0, 20).map(e => ({ titulo: e.titulo, fecha: e.fecha, hora: e.hora })),
  }
}
