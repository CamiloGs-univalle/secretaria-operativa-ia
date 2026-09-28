// GET /api/auth/composio/start?email=ana@empresa.com&name=Ana
// Inicia la conexión real de Gmail de esa persona vía Composio y la manda
// a la pantalla de consentimiento hospedada por Composio.
import { crearEnlaceConexion } from '../../_lib/composio.js'
import { setCookie, getAppUrl, COOKIE } from '../../_lib/session.js'
import crypto from 'crypto'
import { defaultRateLimiter } from '../../_lib/rateLimiter.js'

// Genera un nonce criptográfico seguro para el estado OAuth (state)
// Previene CSRF en el flujo de Composio
function generarStateNonce(){
  return crypto.randomBytes(16).toString('hex')
}

export default async function handler(req, res){
  if(!process.env.COMPOSIO_API_KEY || !process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID){
    // Antes esto respondía 500 con texto plano — sacaba a la persona de la
    // app (perdía toda la sesión de React) sin ninguna explicación visible
    // en la interfaz, dando la impresión de que "la app se rompió" en vez de
    // "falta un paso de configuración". Ahora vuelve a la app con un aviso
    // claro (ver LoginScreen.jsx / login=falta_configuracion). El frontend
    // ya evita llegar aquí cuando sabe que falta configurar (composioConfigured
    // via /api/auth/config), pero esto queda como respaldo por si alguien
    // navega directo a esta URL.
    console.error('[auth/composio/start] falta COMPOSIO_API_KEY / COMPOSIO_GMAIL_AUTH_CONFIG_ID — ver COMPOSIO_SETUP.md')
    res.writeHead(302, { Location: '/?login=falta_configuracion' })
    res.end()
    return
  }
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'anon'
  if(defaultRateLimiter.isLimited(ip)){ res.status(429).send('Demasiados intentos — espere unos minutos'); return }
  const email = (req.query?.email || '').trim()
  const name = (req.query?.name || '').trim()
  if(!/^\S+@\S+\.\S+$/.test(email)){ res.status(400).send('Correo inválido'); return }
  try{
    const appUrl = getAppUrl(req)
    const stateNonce = crypto.randomBytes(16).toString('hex')
    const { redirectUrl } = await crearEnlaceConexion({
      userId: email,
      callbackUrl: `${getAppUrl(req)}/api/auth/composio/callback`,
      state: stateNonce
    })
    // Guardamos quién está intentando conectar + el nonce, para validar en callback
    setCookie(res, COOKIE.STATE, JSON.stringify({ email, name, stateNonce }), { maxAge: 600 })
    // Agregamos el state a la URL de redirección (Composio lo devuelve en el callback)
    const url = new URL(redirectUrl)
    url.searchParams.set('state', stateNonce)
    res.writeHead(302, { Location: url.toString() })
    res.end()
  }catch(e){
    console.error('[auth/composio/start]', e)
    res.writeHead(302, { Location: '/?login=error' })
    res.end()
  }
}
