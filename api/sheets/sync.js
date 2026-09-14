// POST /api/sheets/sync — Google Sheets REAL (no simulado)
// Usa Composio proxy a Sheets API con la misma cuenta Gmail+Sheets conectada (ac_SrmZWdA3zeP2)
// Body: { procesos: [...] } o rows: [[...]]
// Requiere sesión con Gmail+Sheets conectado (misma cuenta). Si no, devuelve 401 y el frontend muestra CTA.
import { getSession } from '../_lib/session.js'

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error:'POST only' })
  const session = getSession(req)
  if(!session?.connectedAccountId){
    return res.status(401).json({ error:'no_gmail_conectado', note:'Conecta tu Gmail+Sheets con Google para sincronizar. El mismo login Gmail ya incluye Sheets.' })
  }
  const procesos = req.body?.procesos || req.body?.rows || []
  if(!Array.isArray(procesos) || procesos.length===0){
    return res.status(400).json({ error:'no_procesos' })
  }
  const spreadsheetId = process.env.SHEETS_ID || '1kM6NkvKXybPwiBM-XWka87eu-JGzX-Q88GIBwQGMT0A' // Seguimiento Actas por defecto
  const range = process.env.SHEETS_RANGE || 'Procesos!A1'

  // Prepara filas: cabecera + datos
  const header = ['ID','Título','Área','Prioridad','Estado','Etapa','Vence','Retraso','Responsable','Última actividad']
  const rows = procesos.map(p=> [
    p.id||'', p.titulo||'', p.area||'', p.prioridad||'', p.estado||'', p.etapa||'', p.fechaLimite||'', String(p.retraso||0), p.responsable||'', p.ultimaActividad||''
  ])
  const values = [header, ...rows]

  try{
    // Usa Composio proxy para Sheets API — no necesita tool predefinido, usa el OAuth de la cuenta conectada
    const r = await fetch('https://backend.composio.dev/api/v3.1/tools/execute/proxy', {
      method:'POST',
      headers:{ 'x-api-key': process.env.COMPOSIO_API_KEY, 'Content-Type':'application/json' },
      body: JSON.stringify({
        connected_account_id: session.connectedAccountId,
        entity_id: session.email,
        method: 'POST',
        endpoint: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=OVERWRITE`,
        parameters: [],
        body: { values }
      })
    })
    const j = await r.json().catch(()=>({}))
    if(!r.ok){
      // Fallback: intenta con el endpoint de clear + update si append falla por rango
      console.error('[sheets/sync] proxy append falló', j)
      return res.status(r.status).json({ error:'sheets_proxy_failed', detalle: j, via:'composio-proxy' })
    }
    return res.json({ ok:true, via:'sheets-proxy', spreadsheetId, range, updated: j.data?.updates?.updatedRows || rows.length, sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}` })
  }catch(e){
    console.error('[sheets/sync]', e.message)
    return res.status(500).json({ error:'sheets_error', detalle: e.message })
  }
}
