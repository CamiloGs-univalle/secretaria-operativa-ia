// Composio redirige aquí cuando la persona termina (o cancela) el
// consentimiento de Gmail. Trae ?status=success|failed&connected_account_id=...
import { parseCookies, setCookie, clearCookie, encrypt, COOKIE } from '../../_lib/session.js'

export default async function handler(req, res){
  try{
    const url = new URL(req.url, `https://${req.headers.host}`)
    const status = url.searchParams.get('status')
    const connectedAccountId = url.searchParams.get('connected_account_id') || url.searchParams.get('connectedAccountId')
    const cookies = parseCookies(req)
    const pending = cookies[COOKIE.STATE] ? JSON.parse(cookies[COOKIE.STATE]) : null
    clearCookie(res, COOKIE.STATE)

    if(status !== 'success' || !pending){
      res.writeHead(302, { Location: '/?login=cancelado' }); return res.end()
    }

    const session = { email: pending.email, name: pending.name || pending.email, connectedAccountId, connectedAt: Date.now() }
    setCookie(res, COOKIE.SESSION, encrypt(session), { maxAge: 60 * 60 * 24 * 30 })
    res.writeHead(302, { Location: '/?login=exito' })
    res.end()
  }catch(e){
    console.error('[auth/composio/callback]', e)
    res.writeHead(302, { Location: '/?login=error' })
    res.end()
  }
}
