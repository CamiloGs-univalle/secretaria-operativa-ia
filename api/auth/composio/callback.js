// Composio redirige aquí cuando la persona termina (o cancela) el
// consentimiento de Gmail. Trae ?status=success|failed&connected_account_id=...
import { parseCookies, setCookie, clearCookie, encrypt, COOKIE } from '../../_lib/session.js'
import { estadoConexion } from '../../_lib/composio.js'

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

    const session = { email: pending.email, name: pending.name || pending.email, connectedAccountId, connectedAt: Date.now(), real:true }
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
