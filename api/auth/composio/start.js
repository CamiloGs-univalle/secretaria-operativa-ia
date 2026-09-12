// GET /api/auth/composio/start?email=ana@empresa.com&name=Ana
// Inicia la conexión real de Gmail de esa persona vía Composio y la manda
// a la pantalla de consentimiento hospedada por Composio.
import { crearEnlaceConexion } from '../../_lib/composio.js'
import { setCookie, getAppUrl, COOKIE } from '../../_lib/session.js'

export default async function handler(req, res){
  if(!process.env.COMPOSIO_API_KEY || !process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID){
    res.status(500).send('Falta configurar COMPOSIO_API_KEY / COMPOSIO_GMAIL_AUTH_CONFIG_ID. Ver COMPOSIO_SETUP.md')
    return
  }
  const email = (req.query?.email || '').trim()
  const name = (req.query?.name || '').trim()
  if(!/^\S+@\S+\.\S+$/.test(email)){ res.status(400).send('Correo inválido'); return }
  try{
    const appUrl = getAppUrl(req)
    const { redirectUrl } = await crearEnlaceConexion({
      userId: email,
      callbackUrl: `${appUrl}/api/auth/composio/callback`
    })
    // Guardamos quién está intentando conectar, para leerlo de vuelta en el callback
    setCookie(res, COOKIE.STATE, JSON.stringify({ email, name }), { maxAge: 600 })
    res.writeHead(302, { Location: redirectUrl })
    res.end()
  }catch(e){
    console.error('[auth/composio/start]', e)
    res.writeHead(302, { Location: '/?login=error' })
    res.end()
  }
}
