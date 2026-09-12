// POST /api/agent/command — mascota → backend (instrucciones naturales doc 22)
// "Este ya quedó listo" → { intent:'COMPLETAR', requiereConfirmacion:true }
export default async function handler(req,res){
  const { text, procesoId } = req.body
  const lower = (text||'').toLowerCase()
  let intent='UNKNOWN', patch={}, confirm=false
  if(/ya qued[oó] listo|completado/.test(lower)){ intent='POSIBLE_COMPLETADO'; confirm=true }
  else if(/mandar a carlos|reenviar/.test(lower)){ intent='FORWARD'; confirm=true }
  else if(/para ma(ñ|n)ana/.test(lower)){ intent='RESCHEDULE'; patch={ fechaLimite: 'tomorrow' } }
  else if(/seguimiento.*lunes/.test(lower)){ intent='FOLLOW_UP'; patch={ seguimiento:'lunes' } }
  else if(/urgente/.test(lower)){ intent='PRIORITY_CRITICAL'; patch={ prioridad:'CRITICA' } }
  // Guard: enviar/reenviar/cerrar siempre piden confirmación (doc 23, 50)
  return res.json({ intent, procesoId, patch, requiereConfirmacion: confirm, confidence: 0.91 })
}
