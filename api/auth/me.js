import { getSession } from '../_lib/session.js'

export default async function handler(req, res){
  const session = getSession(req)
  if(!session){ res.status(401).json({ connected: false }); return }
  res.status(200).json({ connected: true, email: session.email, name: session.name })
}
