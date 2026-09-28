import { useState, useEffect } from 'react'
import { setModoAlmacenamiento, setUsuarioActual } from '../data/mockFirebase.js'
import { fetchProcesosFirestore, subscribeProcesosFirestore } from '../data/mockFirebase.js'
import { getDemoUser, setDemoUser, clearDemoUser, fetchRealSession, logoutReal, signInWithGoogle, logoutFirebase, onFirebaseAuthChange } from '../services/authService.js'

// Sesión + autenticación: Firebase (cualquier Google) → Composio Gmail real
// → demo. También decide `gmailConectado` (si además de la sesión hay Gmail
// real autorizado) y expone los handlers de login/logout que antes vivían
// sueltos dentro de App(). `setProcesos` y `showToast` vienen de fuera
// porque pertenecen a otros hooks (datos y notificaciones).
export function useAuthSession({ setProcesos, showToast }){
  // Sesión — cualquier persona puede entrar con su propio correo:
  // undefined = verificando • null = sin sesión → LoginScreen • objeto = activa
  const [session,setSession]=useState(undefined)
  const [loginStatus,setLoginStatus]=useState(()=> new URLSearchParams(window.location.search).get('login'))
  // Cuando login=cuenta_incorrecta (ver api/auth/composio/callback.js), estos
  // dos datos vienen en la URL para poder explicarle a la persona exactamente
  // qué pasó: qué correo pidió conectar vs. cuál realmente completó Google.
  const [loginEsperado]=useState(()=> new URLSearchParams(window.location.search).get('esperado'))
  const [loginConectado]=useState(()=> new URLSearchParams(window.location.search).get('conectado'))
  const [composioConfigured,setComposioConfigured]=useState(false)
  const [menuOpen,setMenuOpen]=useState(false)
  // Antes se asumía que session.real === "tiene Gmail conectado". Desde que
  // Firebase permite iniciar sesión con cualquier Google SIN conectar Gmail
  // todavía, eso ya no es cierto: session.real (o session.firebase) solo
  // dice "no es demo". gmailConectado dice si de verdad hay una cuenta Gmail
  // (Composio) conectada — es lo único que autoriza leer/enviar correo real.
  const [gmailConectado,setGmailConectado]=useState(false)

  useEffect(()=>{
    if(!loginStatus) return
    const url = new URL(window.location.href)
    url.searchParams.delete('login')
    url.searchParams.delete('esperado')
    url.searchParams.delete('conectado')
    window.history.replaceState({}, '', url.pathname + (url.search||''))
  },[loginStatus])

  // Firebase primero (cualquier Google) → luego Composio Gmail → luego demo
  useEffect(()=>{
    let resuelto = false
    // Sin Firebase (o si Firebase no responde): Gmail conectado (Composio) → demo → pantalla de inicio.
    async function sinFirebase(){
      const real = await fetchRealSession()
      if(resuelto) return
      resuelto = true
      if(real){ setModoAlmacenamiento(false); setSession({ nombre: real.name || real.email, email: real.email, real:true }); return }
      const demo = getDemoUser()
      if(demo){ setModoAlmacenamiento(true); setSession({ ...demo, real:false }); return }
      setModoAlmacenamiento(true); setSession(null)
    }
    // Red de seguridad: si Firebase Auth no avisa en 6 s (IndexedDB bloqueado,
    // extensión, red), no dejar a la persona mirando "Verificando sesión…" para siempre.
    const guardia = setTimeout(()=>{ if(!resuelto){ console.warn('[auth] Firebase no respondió en 6 s — continúo sin esperar'); sinFirebase() } }, 6000)
    let unsub = null
    try{
      unsub = onFirebaseAuthChange(async (fbUser)=>{
        try{
          if(fbUser){
            resuelto = true; clearTimeout(guardia)
            setModoAlmacenamiento(false)
            setSession(fbUser)
            // Carga inicial Firestore — cada persona ve solo SUS propios procesos.
            const fbList = await fetchProcesosFirestore(fbUser.email)
            if(fbList) setProcesos(fbList)
            return
          }
          clearTimeout(guardia)
          if(!resuelto) await sinFirebase()
          else setSession(s=> s?.firebase ? null : s) // cerró sesión de Google
        }catch(e){
          console.error('[auth] error verificando sesión', e)
          if(!resuelto){ resuelto = true; setSession(null) }
        }
      })
    }catch(e){
      console.error('[auth] Firebase Auth no disponible', e)
      clearTimeout(guardia); sinFirebase()
    }
    return ()=>{ clearTimeout(guardia); unsub && unsub() }
  },[])

  // Suscripción Firestore en vivo cuando hay sesión Firebase — filtrada por
  // dueño, para que cada persona solo reciba en vivo SUS propios procesos.
  useEffect(()=>{
    if(!session?.firebase) return
    const unsub = subscribeProcesosFirestore((list)=> setProcesos(list), session.email)
    return ()=> unsub && unsub()
  },[session?.firebase, session?.email])

  useEffect(()=>{
    fetch('/api/auth/config').then(r=>r.json()).then(j=>setComposioConfigured(!!j.composioConfigured)).catch(()=>{})
  },[])

  useEffect(()=>{
    if(!menuOpen) return
    const onClick=(e)=>{ if(!e.target.closest?.('.user-menu')) setMenuOpen(false) }
    document.addEventListener('click', onClick)
    return ()=>document.removeEventListener('click', onClick)
  },[menuOpen])

  function handleDemoLogin({name,email}){
    const u = { nombre:name, email, real:false }
    setDemoUser(u); setModoAlmacenamiento(true); setSession(u); showToast(`👋 Hola, ${name.split(' ')[0]} — modo demostración`)
  }
  async function handleGoogleLogin(){
    const u = await signInWithGoogle()
    setModoAlmacenamiento(false)
    setSession(u)
    showToast(`👋 Hola ${u.nombre.split(' ')[0]} — Google conectado, tus procesos son privados`)
  }
  function handleRealConnect({name,email}){
    // Antes esto navegaba siempre a /api/auth/composio/start, sin importar si
    // Composio ya estaba configurado en el servidor (COMPOSIO_GMAIL_AUTH_CONFIG_ID).
    // Si faltaba, esa ruta respondía con una página de error en texto plano —
    // la persona salía de la app sin ver ningún mensaje claro dentro de la
    // interfaz, y volvía a "no pasa nada" al presionar atrás. Ahora se avisa
    // aquí mismo, sin salir de la app, exactamente igual en los 3 botones que
    // llaman a esta función (barra superior, menú de usuario, banner del
    // Dashboard).
    if(!composioConfigured){
      showToast('⚠️ Conectar Gmail real aún no está disponible: falta un paso de configuración única en el servidor (Composio). Ver COMPOSIO_SETUP.md.')
      return
    }
    window.location.href = `/api/auth/composio/start?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`
  }
  async function handleLogout(){
    if(session?.firebase) await logoutFirebase()
    else if(session?.real) await logoutReal()
    else clearDemoUser()
    setUsuarioActual(null)
    setSession(null); setMenuOpen(false); showToast('Sesión cerrada')
  }

  return {
    session, setSession,
    loginStatus, loginEsperado, loginConectado,
    composioConfigured,
    menuOpen, setMenuOpen,
    gmailConectado, setGmailConectado,
    handleDemoLogin, handleGoogleLogin, handleRealConnect, handleLogout,
  }
}
