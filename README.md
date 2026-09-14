# Secretaria Operativa IA — Centro de Control de Correo y Tareas

React + Vite + Vercel Functions | Firebase Auth/Firestore + Composio (Gmail real)

## Qué hace hoy (funcional, no simulado)

- **Cualquier persona entra con su propio Google** (Firebase Auth) — no hay una sola cuenta fija. Los procesos se guardan compartidos en Firestore para todo el equipo.
- **Cada persona puede conectar su propio Gmail real** (Composio) para traer su bandeja de verdad. El servidor verifica que la cuenta que Google conectó de verdad sea la que la persona pidió conectar — evita mostrar el correo de otra cuenta por error.
- **La IA lee cada correo** (`src/engine/emailEngine.js`) y responde en lenguaje simple: si es relevante, quién debe actuar, qué esperan y para cuándo — sin necesidad de leer el correo completo.
- **Dashboard en 4 categorías** (🔴 Debes atender ahora / 🟠 Requiere tu respuesta / 🟡 Siguiendo / 🟢 Sin acción) con un botón por correo — el detalle numérico completo sigue disponible detrás de "Ver más".
- **Responder y reenviar correos de verdad** desde la app, con borrador sugerido por IA y confirmación obligatoria antes de enviar (Action Guard). Si el envío falla, el error real queda visible en el propio formulario, no en un aviso que desaparece solo.
- **Marcar leído y archivar se reflejan en el Gmail real** de la persona (antes solo cambiaban la vista dentro de la app).
- **Exportar procesos a CSV** — se abre directo en Excel o Google Sheets (Archivo → Importar).
- **Mascota** (asistente flotante): estados 🟢🟡🟠🔴 según los procesos reales, recordatorios periódicos configurables, e instrucciones en lenguaje natural ("ya quedó listo", "mándalo a Carlos", "déjalo para mañana", "hazle seguimiento el lunes", "es urgente") con confirmación obligatoria antes de cualquier cambio sensible.
- **Auditoría** — todo envío, sincronización, cierre o instrucción a la Mascota queda registrado con fecha, usuario y detalle.
- **Modo demostración** — sin conectar nada, cualquiera puede probar la app con un inbox 100% ficticio (nunca correo real de la empresa) generado localmente.

## Cómo correr

```bash
npm install
npm run dev      # http://localhost:5174
npm run build    # producción
```

Ver `COMPOSIO_SETUP.md` para conectar Gmail real (una sola vez, por el administrador del despliegue).

## Arquitectura real

```
Google (Firebase Auth) ─┬─ Firestore (procesos, auditoría — compartido)
                         └─ Composio (Gmail real por persona)
                              ├─ GMAIL_FETCH_EMAILS  → /api/gmail/live
                              ├─ GMAIL_SEND_EMAIL / GMAIL_REPLY_TO_THREAD → /api/gmail/send
                              └─ GMAIL_REMOVE_LABEL  → /api/gmail/archive, /api/gmail/read

Correos → emailEngine.js (clasificación, relevancia, turno, fechas, prioridad, checklist)
        → processGenerator.js (agrupa por hilo → PROCESO)
        → mockFirebase.js (Firestore si hay sesión Google; localStorage en modo demo)
        → Dashboard / Inbox / Procesos / Análisis IA / Auditoría / Mascota
```

- **Frontend:** React + Vite, CSS propio con tema claro/oscuro.
- **Backend:** Vercel Functions en `api/` — sesión cifrada (AES-256-GCM) en cookie httpOnly, nunca tokens de Google en el frontend.
- **Motor IA:** reglas (`src/engine/emailEngine.js`) — sin costo, sin llamadas externas. Clasifica en 10 categorías, calcula prioridad 0-100, detecta fechas en lenguaje natural, arma checklist de lo que falta para responder.

## Qué falta (roadmap, no implementado — nada finge que sí)

- **Sheets en vivo:** hoy se exporta a CSV (abre directo en Sheets/Excel); una sincronización automática por API de Google Sheets requeriría credenciales propias del cliente.
- **Gemini / IA de segundo nivel:** el motor de reglas cubre la clasificación hoy; una capa con modelo generativo para los casos de baja confianza es un paso futuro.
- **Gmail Watch / Pub-Sub (push en tiempo real):** hoy la sincronización es manual (botón "Sincronizar"); notificación push de Gmail es un paso futuro.
- **App de escritorio (Electron/mascota nativa):** no existe todavía — la Mascota web (botón flotante) cubre esa función mientras tanto.

## Estructura de carpetas

```
src/
  engine/       — emailEngine.js (clasificación/prioridad), mascotaEngine.js (instrucciones naturales)
  services/     — authService, gmailService, gmailSendService, processGenerator
  data/         — mockFirebase.js (Firestore + localStorage), demoGmail.js (datos 100% ficticios de demo)
  components/   — LoginScreen, Mascota, Charts
  lib/firebase.js
api/
  auth/         — login Composio (start/callback), sesión (me/logout/config)
  gmail/        — live (leer), send (enviar/responder), archive, read (marcar leído)
  _lib/         — session.js (cifrado de cookie), composio.js (llamadas a Composio)
```

## Seguridad

- Sesión en cookie httpOnly + Secure + SameSite=Lax, cifrada con AES-256-GCM (clave derivada por scrypt de `SESSION_SECRET`).
- Ningún token de Google ni API key llega nunca al frontend.
- Rate limiting en los endpoints que llaman a Composio o envían correo.
- La cuenta de Gmail conectada se verifica contra la que la persona pidió conectar (`GMAIL_GET_PROFILE`) antes de confiar en ella.
