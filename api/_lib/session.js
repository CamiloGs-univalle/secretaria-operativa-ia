// Sesión del usuario que conectó su propio Gmail vía Composio.
// Guardamos solo { email, connectedAccountId, connectedAt } en una cookie
// httpOnly cifrada (AES-256-GCM) — nunca un token de Google directamente,
// eso lo maneja Composio de su lado con la cuenta ya conectada.
import crypto from 'crypto'

const COOKIE_NAME = 'soia_session'
const STATE_COOKIE = 'soia_composio_state'
export const COOKIE = { SESSION: COOKIE_NAME, STATE: STATE_COOKIE }

function getKey(){
  const secret = process.env.SESSION_SECRET || 'dev-insecure-secret-cambiar-en-produccion'
  return crypto.createHash('sha256').update(secret).digest()
}

export function encrypt(obj){
  const iv = crypto.randomBytes(12)
  const key = getKey()
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(obj), 'utf8')), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64url')
}

export function decrypt(str){
  try{
    const buf = Buffer.from(str, 'base64url')
    const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), data = buf.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv)
    decipher.setAuthTag(tag)
    return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'))
  }catch(e){ return null }
}

export function parseCookies(req){
  const header = req.headers.cookie || ''
  const out = {}
  header.split(';').forEach(part=>{
    const idx = part.indexOf('=')
    if(idx < 0) return
    const k = part.slice(0, idx).trim()
    if(k) out[k] = decodeURIComponent(part.slice(idx + 1).trim())
  })
  return out
}

export function setCookie(res, name, value, { maxAge, httpOnly = true, path = '/' } = {}){
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'SameSite=Lax']
  if(httpOnly) parts.push('HttpOnly')
  if(process.env.VERCEL || process.env.NODE_ENV === 'production') parts.push('Secure')
  if(maxAge != null) parts.push(`Max-Age=${maxAge}`)
  const prev = res.getHeader('Set-Cookie')
  const arr = prev ? (Array.isArray(prev) ? prev : [prev]) : []
  arr.push(parts.join('; '))
  res.setHeader('Set-Cookie', arr)
}

export function clearCookie(res, name){ setCookie(res, name, '', { maxAge: 0 }) }

export function getSession(req){
  const raw = parseCookies(req)[COOKIE_NAME]
  return raw ? decrypt(raw) : null
}

export function getAppUrl(req){
  const appUrl = process.env.APP_URL
  if(appUrl) return appUrl.replace(/\/$/, '')
  const proto = req.headers['x-forwarded-proto'] || 'https'
  return `${proto}://${req.headers.host}`
}
