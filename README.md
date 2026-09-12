# Secretaria Operativa IA — Centro de Control de Correo y Tareas
**MVP 1 — Gmail → IA → Firebase → Web** | React + Vite | Sept 2026

## Propósito
Transformar Gmail de la coordinadora en agenda inteligente: cada correo se interpreta como trabajo (no como tarea suelta), se agrupa en PROCESOS, se prioriza y se recomienda qué hacer primero.

## Arquitectura MVP 1 (según doc 61)
```
Gmail (mock) → Email Ingestor → Normalizador → Rules/Thread Engine → Context Builder
→ Relevance Engine → Intent Engine → Responsibility Engine → Process Matcher
→ AI Understanding (rule-based + Gemini-ready) → Fechas/Respuestas/Incidencias
→ Priority Engine → Action Engine → Firebase Mock (localStorage) → Web Dashboard + Sheets + Mascota
```
- **Frontend:** React + Vite + CSS puro (design system premium oscuro)
- **Motor IA:** `src/engine/emailEngine.js` — pipeline 15 preguntas, clasificación A-J, detección relevancia, turno, fechas naturales, entidades, checklist respuesta, prioridad y confianza
- **Firebase:** `src/data/mockFirebase.js` — colecciones `procesos, correos, tareas, historial` con `load/save` en localStorage (idempotente, no duplica)
- **Sheets:** vista tabular exportable
- **Mascota:** widget lateral con instrucciones naturales en español

## Cómo correr
```bash
cd secretaria-operativa-ia
npm install
npm run dev    # http://localhost:5174
npm run build  # producción
npm run preview -- --port 5174 --host 127.0.0.1
```
Build verificado: `272 kB` gzip 83kB — 19 módulos.

## Funcionalidades implementadas (RF-001 a RF-027)
- [x] Lectura correo (ID, hilo, remitente, asunto, cuerpo, adjuntos, etiquetas) — `correosMock`
- [x] Clasificación 10 tipos: Informativo, Solicitud, Seguimiento, Respuesta, Confirmación, Finalización, Incidencia, Reprogramación, Urgente, No relevante
- [x] Relevancia + ¿es para ella? (TO vs CC) + turno (quién tiene la pelota)
- [x] Agrupación correos → PROCESO ÚNICO (threadId matching, similitud semántica básica)
- [x] Estructura proceso completa (22 campos doc 9)
- [x] Estados + especiales (NUEVO→CERRADO, BLOQUEADO/VENCIDO/REPROGRAMADO/CON_INCIDENCIA)
- [x] Prioridades 🔴 Crítica 🟠 Alta 🟡 Media 🟢 Baja ⚪ Informativa + score 0-100 + factores (urgencia, fecha límite, bloqueo, tiempo transcurrido)
- [x] Motor recomendación “Haz estas 3 primero” con motivo explicable
- [x] Plan diario automático 08:00-14:00 con bloque libre
- [x] Tracking tiempo objetivo/transcurrido/restante/retraso
- [x] Detección incidencias y reprogramaciones
- [x] Detección posible finalización (no cierra auto, pide confirmación)
- [x] Dashboard (kpis, reco, plan, indicadores), Vista procesos con filtros (prioridad, estado, área, búsqueda), Historial línea temporal
- [x] Google Sheets (tabla + export), Auditoría + Action Guard, Confianza IA 95/80/60
- [x] Mascota con estados 🟢🟡🟠🔴, recordatorio 3h, instrucciones naturales: “ya quedó listo”, “mandar a Carlos”, “déjalo para mañana”, “hazle seguimiento lunes”, “es urgente”

## Próximos pasos (MVP 2-4)
MVP2: Sheets sync real (Google Sheets API + Apps Script), vencimientos, incidencias avanzadas
MVP3: Electron mascota real (tray, notificaciones nativas, autostart)
MVP4: Gmail API real + Pub/Sub Watch, Gemini API con JSON estructurado, cola SQS-like

## Estructura carpetas (doc 59)
```
src/
  engine/emailEngine.js
  data/mockFirebase.js
  App.jsx + App.css
  index.css + main.jsx
api/ (preparado para Vercel Functions)
  gmail/ ai/ processes/ tasks/ sheets/ notifications/ agent/
```

## Nota de costos
MVP 1 corre 100% local sin costo. Producción usaría Firestore free tier (50k lecturas), Vercel Hobby, Gmail Pub/Sub, Gemini free tier — todo dentro de cuotas con filtros previos (2000 correos → ~300 relevantes → ~100 procesos).
