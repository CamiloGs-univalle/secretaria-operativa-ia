import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// Config de Firebase — proyecto GESTOR-12E9A (proporcionado por Camilo, 12/09/2026)
// Permite que CUALQUIER correo de Google inicie sesión (multi-usuario). La base de datos
// es una sola, pero cada documento de `procesos` queda filtrado por `propietario` tanto en
// el cliente (mockFirebase.js) como en las reglas de seguridad (firestore.rules), así que
// cada cuenta ve y puede escribir únicamente sus propios procesos.
const firebaseConfig = {
  apiKey: "AIzaSyClMI3Yt3lj5vLb1YmZ0retZ6mdUxc_4j0",
  authDomain: "gestor-12e9a.firebaseapp.com",
  projectId: "gestor-12e9a",
  storageBucket: "gestor-12e9a.firebasestorage.app",
  messagingSenderId: "852310056108",
  appId: "1:852310056108:web:fab83978523f2d15a25309",
  measurementId: "G-FLP1W3Y952"
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

export default app
