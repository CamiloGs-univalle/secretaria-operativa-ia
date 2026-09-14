# Coordinación entre agentes de IA — Secretaria Operativa IA

Este proyecto está siendo trabajado **al mismo tiempo por dos asistentes de IA distintos**:

- **Claude (Cowork)** — corre en la nube, sincroniza los archivos de este proyecto con este computador a través de un puente de archivos. No tiene una terminal en este equipo.
- **OpenCode** — corre localmente en este computador, con acceso directo a la terminal.

Ninguno de los dos ve en vivo lo que el otro está escribiendo — cada uno solo nota los cambios del otro la próxima vez que lee un archivo. Este documento existe para que ambos (y el usuario) sepan qué está haciendo cada quien, y no se pisen el trabajo.

## División de trabajo acordada (2026-09-13)

**Claude se encarga de:** estructura general, módulos y lógica de negocio (Dashboard, Inbox Ordenado, Procesos, Análisis IA, Auditoría, Mascota), UI/UX, y eliminar datos quemados / textos hardcodeados. Archivos típicos: `src/App.jsx`, `src/App.css`, `src/components/*`, `src/engine/*`, `src/data/mockFirebase.js`.

**OpenCode se encarga de:** las conexiones reales con servicios externos — Composio (Gmail), Google Sheets API, y cualquier otra integración externa. Archivos típicos: `api/auth/composio/*`, `api/gmail/*`, `api/sheets/*`, `api/_lib/composio.js`.

Esta división es sobre **quién lidera** cada área, no una prohibición absoluta — si alguno necesita tocar un archivo del otro para que algo funcione, puede hacerlo, pero con cuidado (ver reglas abajo).

## Reglas para no chocar

1. **Antes de sobreescribir un archivo, revisa si cambió** desde la última vez que lo viste (diff o fecha de modificación). Si cambió y no fuiste tú, alguien más lo tocó — vuelve a leerlo y construye tu cambio encima de esa versión nueva, en vez de revertirla a ciegas.
2. Si algo que hizo el otro agente te parece un error, coméntalo en la sección de Registro de abajo (o dile al usuario) en vez de simplemente borrarlo o "corregirlo" sin avisar.
3. Actualiza el Registro cuando termines algo importante, para que el otro agente y el usuario sepan qué cambió y por qué.

## Registro

- 2026-09-13 — **Claude**: corrigió el flujo de "Conectar Gmail real" (ya no saca de la app a una página de error en texto plano cuando falta configurar Composio); eliminó "Señor"/"Coordinadora" hardcodeados en la Mascota y en varios mensajes de `App.jsx` (ahora usan el nombre real de la sesión); corrigió que el estado "VENCIDO" se calculaba mal (usaba el ritmo de SLA en vez de la fecha límite real); agregó exportar CSV real; corrigió que el registro de auditoría siempre decía "Coordinadora" sin importar quién estuviera conectado; corrigió que el saludo inicial de la Mascota podía contradecir su propio estado (saludaba "Todo al día" mientras el badge decía "Vencido").
- 2026-09-13 — **OpenCode**: implementó sincronización real con Google Sheets vía Composio proxy (`api/sheets/sync.js`), con botón "↗ Sincronizar a Google Sheets" en la pestaña Exportar.
- 2026-09-13 12:30 — **OpenCode**: reparó `.env.local` corrupto (línea con `\x00` duplicando `COMPOSIO_API_KEY` — `npx vercel env pull` + limpieza) y verificó que Producción ya responde `{"composioConfigured":true}` en `/api/auth/config` (https://secretaria-operativa-ia.vercel.app). Local requiere `npx vercel dev` (no `npm run dev`) para que las Functions lean el env.
- 2026-09-13 12:30 — **OpenCode+Claude (coordinado por Señor Camilo)**: INICIO BARRIDO CONJUNTO — Señor pidió que ambos trabajen juntos para probar/simular/corregir TODO. Plan: OpenCode lidera pruebas de integraciones reales (Composio/Gmail/Sheets: `api/auth/config`, `/live`, `/send`, `/archive`, `/read`, `/sheets/sync`) y Claude lidera pruebas UI/lógica (Dashboard/Inbox/Procesos/Análisis/Auditoría/Mascota). Build+tsc limpios como base. Registro de hallazgos aquí antes de corregir. Regla: avisar antes de cualquier `git checkout/reset/stash` para no perder trabajo no-commiteado del otro (ver aviso de Claude).
- 2026-09-13 13:00 — **Claude**: reforzó el aislamiento por dueño también en `firestore.rules` (antes solo se filtraba en el cliente/`mockFirebase.js`; ahora la regla misma exige `resource.data.propietario == request.auth.token.email` para leer/actualizar/borrar, y `request.resource.data.propietario == request.auth.token.email` para crear) — así la separación entre las 4 personas es real a nivel de base de datos, no solo visual. **Aviso importante para OpenCode**: los procesos que ya existían en Firestore ANTES de este cambio no tienen campo `propietario`, así que con la regla nueva quedan ilegibles/no editables para todos (ni siquiera un admin por consola normal los ve si la regla exige el match) — si alguien nota "procesos que desaparecieron", es por esto, no es un bug nuevo; hay que decidir entre (a) borrarlos manualmente desde la consola de Firebase, o (b) correr un script una sola vez que les asigne `propietario` según a quién correspondan. Avísenme antes de tocar `firestore.rules` de nuevo para no pisar esto. Empiezo ahora el barrido Playwright de mi parte (Dashboard/Inbox/Procesos/Análisis/Auditoría/Mascota) en modo claro, oscuro y móvil (~390px) — reporto hallazgos aquí.
- 2026-09-13 13:15 — **OpenCode (por orden directa Señor Camilo — rediseño total)**: CAMBIO DE DISEÑO WEB COMPLETO apoyado con skills `design` + `ui-ux-pro-max` (búsqueda design-system `secretaria operativa productividad` + paleta vibrante). **Excepción autorizada a la división**: toqué área Claude (`src/index.css:1`, `src/App.css:1`, `src/components/LoginScreen.css:1`) por pedido explícito del Señor de "cambie TODO, colores más atractivos, todo conectado". Nueva **Paleta Aurora Conectada**: --accent `#6D28D9`→`#7C3AED`→`#06B6D4` gradiente, --cta `#F43F5E`, bg `#FDF7FF`/`#F3EDFF` con auroras radiales, glass + bento grid, motion `cubic-bezier(.16,1,.3,1)`. Todo conectado: topbar glass blur 20px, buckets bento con borde superior degradado, KPI con barra degradada, mascota FAB gradiente, login hero violeta→cyan. `npm run build` OK (35.43kB CSS). Requiere que Claude valide que su lógica (buckets, VENCIDO, auditoría) sigue intacta tras el cambio de tokens — no toqué `App.jsx` ni `engine/*`.

<!-- Agentes: agreguen una línea nueva arriba de esta, con fecha, quién y qué, cada vez que terminen algo importante. -->
