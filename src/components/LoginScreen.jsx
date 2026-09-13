import { useState } from 'react'
import './LoginScreen.css'

const FEATURES = [
  { icon: '🧠', t: 'La IA lee cada correo por ti', d: 'Clasifica, prioriza y te dice en palabras simples qué esperan de ti y para cuándo.' },
  { icon: '📬', t: 'Tu bandeja de verdad se reduce', d: 'Al marcar algo "Listo" desaparece — de la app y, si conectas tu Gmail, también de tu bandeja real.' },
  { icon: '📈', t: 'Mide si te está ayudando', d: 'Un panel de productividad con datos reales de tu propia cuenta, no ejemplos inventados.' },
]

function GoogleIcon(){
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.8 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.2-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4c-7.6 0-14.2 4.3-17.7 10.7z"/>
      <path fill="#4CAF50" d="M24 44c5.4 0 10.3-2.1 14-5.4l-6.5-5.4C29.4 34.8 26.8 36 24 36c-5.3 0-9.7-3.4-11.3-8.1l-6.5 5C9.7 39.6 16.3 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.1-2.1 3.9-3.9 5.2l6.5 5.4C39.3 37 44 31 44 24c0-1.2-.1-2.4-.4-3.5z"/>
    </svg>
  )
}

// Login multi-correo: cualquier persona con Google entra (Firebase Auth).
// Luego, opcionalmente, conecta su Gmail real vía Composio para traer correos.
// Demo sigue disponible sin Google.
export default function LoginScreen({ onDemoLogin, onRealConnect, onGoogleLogin, loginStatus, composioConfigured }){
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  function validar(){
    if(!name.trim()){ setError('Escribe tu nombre para continuar.'); return null }
    if(!/^\S+@\S+\.\S+$/.test(email.trim())){ setError('Escribe un correo válido.'); return null }
    setError('')
    return { name: name.trim(), email: email.trim() }
  }

  function submitDemo(e){
    e.preventDefault()
    const datos = validar()
    if(!datos) return
    onDemoLogin(datos)
  }

  async function handleGoogle(){
    setError(''); setGoogleLoading(true)
    try{ await onGoogleLogin() }catch(e){ setError(e.message || 'No se pudo iniciar con Google. Verifica que el proveedor Google esté habilitado en Firebase Console → Authentication → Providers.') }
    setGoogleLoading(false)
  }
  function conectarReal(){
    const datos = validar()
    if(!datos) return
    setConnecting(true)
    onRealConnect(datos)
  }

  return (
    <div className="login-screen">
      <div className="login-hero">
        <div className="login-hero-inner">
          <div className="login-logo"><span>SO</span></div>
          <h1>Secretaria Operativa IA</h1>
          <p className="login-tag">Tu correo, ordenado por una IA — para cualquier persona, con su propia cuenta.</p>
          <div className="login-features">
            {FEATURES.map(f => (
              <div key={f.t} className="login-feature">
                <div className="login-feature-icon">{f.icon}</div>
                <div>
                  <div className="login-feature-t">{f.t}</div>
                  <div className="login-feature-d">{f.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="login-panel">
        <div className="login-card">
          <h2>Iniciar sesión</h2>
          <p className="login-sub"><b>Cualquier correo</b> — entra con tu Google y todos verán los mismos procesos en Firestore (compartido). Luego, si quieres, conecta tu Gmail para traer correos reales.</p>

          {loginStatus === 'error' && <div className="login-alert error">No se pudo completar la conexión con tu Gmail. Intenta de nuevo o usa el modo demostración.</div>}
          {loginStatus === 'cancelado' && <div className="login-alert">Cancelaste la conexión de tu Gmail.</div>}

          <button type="button" className="login-google-btn" onClick={handleGoogle} disabled={googleLoading} style={{width:'100%',justifyContent:'center'}}>
            <GoogleIcon /> {googleLoading ? 'Abriendo Google…' : 'Continuar con Google — cualquier correo'}
          </button>
          <div className="login-note" style={{marginTop:8}}>✅ Firebase: <b>cualquier cuenta Google</b> entra. Los procesos se guardan compartidos en Firestore.</div>

          <div className="login-divider"><span>y</span></div>

          <form onSubmit={submitDemo} className="login-form">
            <label>Tu nombre<input value={name} onChange={e=>setName(e.target.value)} placeholder="Ej: Ana Gómez" autoComplete="name" /></label>
            <label>Tu correo<input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Ej: ana@empresa.com" type="email" autoComplete="email" /></label>
            {error && <div className="login-alert error">{error}</div>}

            <button type="button" className="login-google-btn" onClick={conectarReal} disabled={connecting} style={{opacity:0.9}}>
              <GoogleIcon /> {connecting ? 'Conectando Gmail…' : 'Conectar mi Gmail real (Composio)'}
            </button>
            {!composioConfigured && (
              <div className="login-note">ℹ️ Gmail: requiere COMPOSIO_GMAIL_AUTH_CONFIG_ID. Ya configurado.</div>
            )}
            {composioConfigured && (
              <div className="login-note" style={{color:'#059669',borderColor:'#a7f3d0',background:'#ecfdf5'}}>✅ Gmail listo — autoriza Gmail para traer tu bandeja real (opcional).</div>
            )}

            <div className="login-divider"><span>o</span></div>

            <button type="submit" className="btn primary" style={{width:'100%',justifyContent:'center',padding:'12px'}}>Entrar en modo demostración →</button>
          </form>
          <div className="login-note">💡 En modo demostración verás datos de ejemplo, personalizados con tu nombre — nada se conecta todavía. Cuando conectas tu Gmail real, la app trabaja directamente sobre tu propia bandeja.</div>
        </div>
      </div>
    </div>
  )
}
