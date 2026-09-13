import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// Config de Firebase — proyecto secretaria-operativa-ia (creado 12/09/2026)
// Permite que CUALQUIER correo de Google inicie sesión (multi-usuario)
const firebaseConfig = {
  apiKey: "AIzaSyDofsKVRF_cgCMc2Tq6Mx_4AychdR75VIk",
  authDomain: "secretaria-operativa-ia.firebaseapp.com",
  projectId: "secretaria-operativa-ia",
  storageBucket: "secretaria-operativa-ia.firebasestorage.app",
  messagingSenderId: "698901683654",
  appId: "1:698901683654:web:d00d9a6592a6290ab466c7"
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()
// Pide acceso a perfil y email — cualquier cuenta Google es bienvenida
googleProvider.setCustomParameters({ prompt: 'select_account' })

export default app
