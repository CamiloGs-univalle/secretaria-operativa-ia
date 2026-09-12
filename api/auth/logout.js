import { clearCookie, COOKIE } from '../_lib/session.js'

export default async function handler(req, res){
  clearCookie(res, COOKIE.SESSION)
  res.status(200).json({ ok: true })
}
