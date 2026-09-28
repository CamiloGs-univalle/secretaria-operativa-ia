import { useState } from 'react'

// Pila de notificaciones (mockup) — varias a la vez, cada una se apila y
// se autodesvanece a los 3.5s. Reemplaza el `toast` singular que quedaba
// declarado sin uso real en versiones anteriores de App.jsx.
export function useToasts(){
  const [toasts, setToasts] = useState([])
  const showToast = (m) => {
    const id = Date.now() + Math.random()
    setToasts(list => [...list, { id, msg: m }])
    setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), 3500)
  }
  const dismissToast = (id) => setToasts(list => list.filter(t => t.id !== id))
  return { toasts, showToast, dismissToast }
}
