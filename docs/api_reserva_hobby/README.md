# APIs en reserva — Hobby limit 12 funciones

Señor Camilo: aquí se preserva **todo lo que usted hizo** sin perder nada.

**Motivo:** Vercel Hobby permite máx. **12 Serverless Functions** por deploy.
Con el nuevo login Google (5 auth routes + 3 gmail + 1 processes = 9 + composio) más `agent/command`, `ai/understand` y `sheets/sync` = **13 → deploy fallaba `No more than 12...`**.

**Solución sin perder:** Se movieron 3 APIs no críticas del MVP1 a esta carpeta `docs/api_reserva_hobby/` —
siguen en el repo, con historial Git intacto, pero no cuentan para el deploy.

- `command.js` — `POST /api/agent/command` mascota → backend (intenciones doc 22) — ahora resuelto en `src/engine/mascotaEngine.js` (frontend) para ser más ágil.
- `understand.js` — `POST /api/ai/understand` IA estructurada — ahora en `src/engine/emailEngine.js` (pipeline 15 preguntas) — se reactivará cuando se conecte Gemini real.
- `sheets-sync.js` — `POST /api/sheets/sync` — se reactivará en MVP2 con Sheets API.

**Para reactivar (Pro plan o cuando se libere una función):**
```bash
cp docs/api_reserva_hobby/command.js api/agent/command.js
cp docs/api_reserva_hobby/understand.js api/ai/understand.js
cp docs/api_reserva_hobby/sheets-sync.js api/sheets/sync.js
git add api/agent/command.js api/ai/understand.js api/sheets/sync.js
```

Nada se borró — todo preservado Señor.
