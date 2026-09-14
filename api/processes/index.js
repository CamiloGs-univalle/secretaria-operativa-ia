// Este endpoint quedó en desuso: el frontend lee y escribe procesos
// directamente contra Firestore (ver src/data/mockFirebase.js), nunca contra
// esta ruta. Antes respondía siempre 200 con un "sheets: 'synced'" y un
// "ok: true" inventados, sin hacer nada real — quien lo llamara (por
// ejemplo, inspeccionando la pestaña Red del navegador) podía creer que
// existía una sincronización que en realidad nunca ocurrió. Este archivo no
// se pudo borrar desde aquí (sin acceso de shell a este equipo); se deja
// como un 410 honesto en vez de fingir éxito. Es seguro borrar la carpeta
// api/processes/ por completo.
export default async function handler(req, res){
  res.status(410).json({ error:'no_implementado', note:'Este endpoint no está en uso — los procesos se leen/escriben directo desde el frontend contra Firestore (src/data/mockFirebase.js).' })
}
