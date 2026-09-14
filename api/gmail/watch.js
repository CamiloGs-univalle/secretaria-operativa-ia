// Este endpoint quedó en desuso: no hay integración real con Gmail
// Watch/Pub-Sub (notificaciones push de Gmail). Antes respondía siempre 200
// con un "historyId" inventado, sin registrar ninguna suscripción real. Este
// archivo no se pudo borrar desde aquí (sin acceso de shell a este equipo);
// se deja como un 410 honesto en vez de fingir éxito. Hoy el correo se
// actualiza por consulta directa (polling) desde el cliente vía
// /api/gmail/live, no por notificaciones push — ver la sección "Qué falta"
// del README para el roadmap real de esta función.
export default async function handler(req, res){
  res.status(410).json({ error:'no_implementado', note:'No hay integración real con Gmail Watch/Pub-Sub. El correo se actualiza por consulta directa (polling) vía /api/gmail/live.' })
}
