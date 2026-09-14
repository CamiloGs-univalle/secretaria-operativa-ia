// Composio redirige aquí cuando la persona termina (o cancela) el
// consentimiento de Gmail. Trae ?status=success|failed&connected_account_id=...
import { parseCookies, setCookie, clearCookie, encrypt, COOKIE } from '../../_lib/session.js'
import { estadoConexion, emailDeCuentaConectada } from '../../_lib/composio.js'

export default async function handler(req, res){
  try{
    const url = new URL(req.url, `https://${req.headers.host}`)
    const status = url.searchParams.get('status')
    const connectedAccountId = url.searchParams.get('connected_account_id') || url.searchParams.get('connectedAccountId')
    const cookies = parseCookies(req)
    const pending = cookies[COOKIE.STATE] ? JSON.parse(cookies[COOKIE.STATE]) : null
    clearCookie(res, COOKIE.STATE)

    if(status !== 'success' || !pending || !connectedAccountId){
      res.writeHead(302, { Location: '/?login=cancelado' }); return res.end()
    }

    // Verificar contra Composio (nunca confiar solo en los query params que
    // manda el navegador de vuelta) que la cuenta conectada de verdad quedó
    // activa antes de confiar en ella y emitir una sesión.
    const estado = await estadoConexion(connectedAccountId)
    const activa = estado.ok && /ACTIVE|CONNECTED|success/i.test(String(estado.status || ''))
    if(!activa){
      console.error('[auth/composio/callback] conexión no activa, no se emite sesión:', estado.status)
      res.writeHead(302, { Location: '/?login=error' }); return res.end()
    }

    // Verificación CRÍTICA que faltaba: Google no obliga a usar la cuenta
    // que la persona escribió en nuestro formulario — si su navegador ya
    // tenía otra cuenta de Google activa, el consentimiento pudo completarse
    // con ESA cuenta sin que Composio ni nosotros lo notáramos (Composio
    // solo confirma que "una" cuenta quedó conectada, no cuál). Eso permitía
    // que alguien terminara con el Gmail real de OTRA persona conectado a su
    // sesión, mostrado como si fuera el suyo — el bug de "datos quemados de
    // otra cuenta" reportado. Ahora se le pregunta a la cuenta ya conectada
    // cuál es su propio correo real (GMAIL_GET_PROFILE) y se compara contra
    // lo que la persona dijo que iba a conectar, ANTES de emitir la sesión.
    const emailReal = await emailDeCuentaConectada(connectedAccountId)
    if(emailReal && emailReal.toLowerCase().trim() !== String(pending.email||'').toLowerCase().trim()){
      console.error('[auth/composio/callback] cuenta conectada no coincide:', emailReal, 'esperado:', pending.email)
      const esperado = encodeURIComponent(pending.email)
      const conectado = encodeURIComponent(emailReal)
      res.writeHead(302, { Location: `/?login=cuenta_incorrecta&esperado=${esperado}&conectado=${conectado}` })
      return res.end()
    }

    const session = { email: emailReal || pending.email, name: pending.name || pending.email, connectedAccountId, connectedAt: Date.now(), real:true }
    // 7 días en vez de 30 — no hay revocación de sesión del lado del
    // servidor todavía, así que una cookie robada o filtrada dura menos.
    setCookie(res, COOKIE.SESSION, encrypt(session), { maxAge: 60 * 60 * 24 * 7 })
    res.writeHead(302, { Location: '/?login=exito' })
    res.end()
  }catch(e){
    console.error('[auth/composio/callback]', e)
    res.writeHead(302, { Location: '/?login=error' })
    res.end()
  }
}
