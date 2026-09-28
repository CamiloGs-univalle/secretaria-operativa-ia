// GET /api/auth/composio/start?email=ana@empresa.com&name=Ana
// Inicia la conexión real de Gmail de esa persona vía Composio y la manda
// a la pantalla de consentimiento hospedada por Composio.
import { crearEnlaceConexion } from '../../_lib/composio.js'
import { setCookie, getAppUrl, encrypt, COOKIE } from '../../_lib/session.js'
import crypto from 'crypto'
import { defaultRateLimiter } from '../../_lib/rateLimiter.js'

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
    const { redirectUrl, connectedAccountId } = await crearEnlaceConexion({
      userId: email,
      callbackUrl: `${getAppUrl(req)}/api/auth/composio/callback`,
    })
    // Estado CIFRADO (no JSON plano): quién inicia, qué cuenta creó Composio
    // y un nonce. El callback exige que el connected_account_id que vuelve en
    // la URL sea exactamente este — así nadie puede colar el id de una cuenta
    // ajena. No se toca la URL de Composio (su OAuth usa su propio `state`).
    const state = { email, name, caId: connectedAccountId || null, nonce: crypto.randomBytes(16).toString('hex'), exp: Date.now() + 10 * 60 * 1000 }
    setCookie(res, COOKIE.STATE, encrypt(state), { maxAge: 600 })
    res.writeHead(302, { Location: redirectUrl })
    res.end()
  }catch(e){
    console.error('[auth/composio/start]', e)
    res.writeHead(302, { Location: '/?login=error' })
    res.end()
  }
}
