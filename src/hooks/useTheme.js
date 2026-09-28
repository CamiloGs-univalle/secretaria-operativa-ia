import { useState, useEffect } from 'react'

// Tema claro/oscuro persistido en localStorage — aplicado como atributo
// data-theme en <html> para que toda la hoja de estilos reaccione sola.
export function useTheme(){
  const [theme, setTheme] = useState(() => localStorage.getItem('soia_theme') || 'light')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('soia_theme', theme)
  }, [theme])
  return [theme, setTheme]
}
