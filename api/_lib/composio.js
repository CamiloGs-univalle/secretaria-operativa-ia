// Helpers para Composio — el mismo servicio que ya usa api/gmail/send.js
// para el fallback de envío (COMPOSIO_API_KEY ya está configurada).
//
// Esto AÑADE la parte que faltaba: dejar que CUALQUIER persona conecte su
// propia cuenta de Gmail (no solo la cuenta fija de antes), usando el flujo
// de cuentas conectadas de Composio.
//
// Nota importante: la API de Composio evoluciona seguido. Los nombres de
// acción y campos aquí están basados en su documentación pública más
// reciente (api/v3.1 para conexiones, api/v2 para ejecutar acciones — igual
// que ya usa send.js). Si algo aquí falla, el dashboard de Composio
// (sección "API Playground" de cada acción) muestra el request exacto que
// funciona para tu cuenta — es la fuente más confiable para ajustar esto.
const V3 = 'https://backend.composio.dev/api/v3.1'
const V2 = 'https://backend.composio.dev/api/v2'

function headers(){
  return { 'x-api-key': process.env.COMPOSIO_API_KEY, 'Content-Type': 'application/json' }
}

// Crea una sesión de autorización hospedada por Composio para que `userId`
// (usamos su correo como identificador) conecte su Gmail. Devuelve la URL a
// la que hay que redirigir al navegador.
export async function crearEnlaceConexion({ userId, callbackUrl }){
  const r = await fetch(`${V3}/connected_accounts/link`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      user_id: userId,
      auth_config_id: process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID,
      callback_url: callbackUrl
    })
  })
  const j = await r.json().catch(()=>({}))
  if(!r.ok) throw new Error('composio_link_failed: ' + JSON.stringify(j))
  const redirectUrl = j.redirect_url || j.redirectUrl || j.data?.redirect_url
  if(!redirectUrl) throw new Error('composio_link_no_redirect_url: ' + JSON.stringify(j))
  return { redirectUrl, connectedAccountId: j.connected_account_id || j.connectedAccountId || j.id || null }
}

export async function estadoConexion(connectedAccountId){
  const r = await fetch(`${V3}/connected_accounts/${connectedAccountId}`, { headers: headers() })
  const j = await r.json().catch(()=>({}))
  return { ok: r.ok, status: j.status || j.data?.status, raw: j }
}

// Pregunta a Gmail (vía la cuenta ya conectada) cuál es su propia dirección
// real — GMAIL_GET_PROFILE es el equivalente de users.getProfile de la API
// de Gmail y devuelve emailAddress. Se usa para VERIFICAR que la cuenta de
// Google que de verdad completó el consentimiento es la misma que la
// persona dijo que iba a conectar — Google no obliga a usar una cuenta en
// particular solo porque nuestro formulario pedía un correo específico; si
// el navegador ya tenía otra cuenta de Google activa, pudo terminar
// conectando ESA sin que nadie lo notara. Ver callback.js para el uso.
export async function emailDeCuentaConectada(connectedAccountId){
  try{
    const j = await ejecutarAccionGmail({ action:'GMAIL_GET_PROFILE', params:{}, connectedAccountId })
    const data = j.data || j
    return data?.emailAddress || data?.email || null
  }catch(e){ console.warn('[composio] GMAIL_GET_PROFILE falló:', e.message); return null }
}

// Ejecuta una acción del toolkit gmail para la cuenta conectada de una
// persona específica — v3.1 (v2 está deprecado 410).
// Requiere entity_id = email del usuario que conectó su Gmail.
export async function ejecutarAccionGmail({ action, params, connectedAccountId, entityId }){
  // Normaliza params para v3.1: GMAIL_SEND_EMAIL espera recipient_email, no `to`
  let args = { ...params }
  if(args.to && !args.recipient_email) { args.recipient_email = args.to; delete args.to }
  // threadId -> para reply usar GMAIL_REPLY_TO_THREAD si existe threadId
  const tool = action
  const payload = {
    arguments: args,
  }
  if(connectedAccountId) payload.connected_account_id = connectedAccountId
  if(entityId) payload.entity_id = entityId
  const r = await fetch(`${V3}/tools/execute/${tool}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload)
  })
  const j = await r.json().catch(()=>({}))
  if(!r.ok) throw new Error('composio_action_failed: ' + JSON.stringify(j))
  return j
}
