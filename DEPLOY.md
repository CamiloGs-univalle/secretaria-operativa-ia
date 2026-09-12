# Deploy — Secretaria Operativa IA

## Stack final (doc 60)
FRONTEND React+Vite | BACKEND Node + Vercel Functions | DB Firestore | EMAIL Gmail API + Pub/Sub | SHEETS API + Apps Script | IA Gemini + Ollama | DESKTOP Electron | HOSTING Vercel

## Variables de entorno (nunca en frontend — RNF001/002)
```
# backend only
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
FIREBASE_SERVICE_ACCOUNT=
GEMINI_API_KEY=
SHEETS_ID=1kM6NkvKXybPwiBM...
PUBSUB_TOPIC=projects/xxx/topics/gmail
```

## Deploy Vercel
```bash
vercel --prod
# api/* se despliega como Functions automáticamente
# vercel.json ya mapea rewrites a /api
```

## Gmail Watch (push, no polling — doc 34)
```bash
curl -X POST https://your-app.vercel.app/api/gmail/watch \
  -H "Authorization: Bearer $TOKEN"
# Pub/Sub push → /api/gmail/watch (POST) → Queue → Worker
```

## Electron mascota
```bash
cd electron
npm install
npm start        # dev (carga http://localhost:5174)
npm run build    # electron-builder → .exe
# Autostart: app.setLoginItemSettings({openAtLogin:true})
# Tray + notificaciones 08/11/14/17 configurables
```

## Firebase
Colecciones: usuarios, procesos, correos, tareas, seguimientos, incidencias, historial, notificaciones, configuracion, reglas_prioridad, estadisticas, acciones_agente (doc 30)

## Costos (doc 55-56)
Hobby $0 dentro de cuotas: Firestore 50k lecturas/día, Vercel Hobby, Gmail API, Gemini free tier. Prod: evaluar Vercel Pro + Firestore on-demand. Filtro previo evita 2000 llamadas IA → ~100 procesos.

## Idempotencia (RNF012)
`emailId` como clave — re-procesar mismo correo no duplica proceso. Queue + Worker garantiza orden.

## Action Guard (doc 50)
IA propone → Guard valida ¿permitido?¿destinatario válido?¿requiere confirmación? → confirmación → ejecuta. Auditoría en `acciones_agente`.

## Próximos
- Conectar Gemini real en api/ai/understand.js (descomentar fetch)
- Apps Script en Sheets para formatos
- Ollama local para Nivel 3 (cuando haya GPU)
