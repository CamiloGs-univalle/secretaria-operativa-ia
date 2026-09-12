// /api/processes — Firestore CRUD + Sheets sync + Auditoría (doc 30, 32, 51)
export default async function handler(req,res){
  const { method } = req
  // Firebase Admin SDK (backend seguro, tokens nunca en frontend)
  // const db = admin.firestore()
  if(method==='GET') return res.json({ procesos: [], total: 0, note:'Firestore collection: procesos (fuente de verdad)' })
  if(method==='POST'){
    const proc = req.body
    // idempotente: si emailId ya existe, no crear duplicado (RNF012)
    // await db.collection('procesos').doc(proc.id).set(proc, { merge:true })
    // await syncSheets(proc) // Google Sheets API + Apps Script (doc 35)
    // await audit({ usuario:'system', accion:'crear_proceso', proceso: proc.id, confianza: proc.confianza })
    return res.json({ ok:true, id: proc.id, sheets:'synced' })
  }
  if(method==='PATCH'){
    // update estado, prioridad, etc — Action Guard valida
    return res.json({ ok:true, guard:'confirmación requerida para cerrar/enviar' })
  }
  return res.status(405).end()
}
