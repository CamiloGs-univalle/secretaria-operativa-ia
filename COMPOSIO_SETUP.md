# Conectar Gmail real por persona — vía Composio

Este proyecto ya trae listo el código para que **cualquier persona** (no solo
una cuenta fija) entre con su nombre y correo y conecte su propio Gmail real,
sin que nadie tenga que compartir contraseñas ni tokens. La conexión la
hospeda [Composio](https://composio.dev) — nosotros solo guardamos, en una
cookie cifrada, el identificador de la cuenta ya conectada.

Mientras no se complete este setup, la app sigue funcionando normal en
**modo demostración** (cualquiera puede entrar con su nombre/correo, sin
conectar nada — los datos que ve son los de ejemplo/snapshot de siempre).

## 1. Ya está configurado
- `COMPOSIO_API_KEY` — ya existe en Vercel (se usa también para el envío de
  correo de respaldo en `api/gmail/send.js`).

## 2. Falta configurar (una sola vez)

### a) Crear un "Auth Config" de Gmail en el dashboard de Composio
1. Entra a tu cuenta de Composio → **Toolkits** → busca **Gmail**.
2. Crea un **Auth Config** para Gmail (OAuth). Composio te da un
   `auth_config_id`.
3. Copia ese id — es la variable `COMPOSIO_GMAIL_AUTH_CONFIG_ID` de abajo.

### b) Variables de entorno nuevas en Vercel (Project Settings → Environment Variables)
| Variable | Valor | Para qué |
|---|---|---|
| `COMPOSIO_GMAIL_AUTH_CONFIG_ID` | el id del paso anterior | identifica qué tipo de conexión (Gmail) se está pidiendo |
| `SESSION_SECRET` | una cadena larga y aleatoria (ej. `openssl rand -hex 32`) | cifra la cookie de sesión (AES-256-GCM) — sin esto se usa un valor de desarrollo inseguro |
| `APP_URL` | la URL pública del despliegue (ej. `https://tu-app.vercel.app`) | para construir la URL de callback que Composio necesita |

Después de agregarlas, vuelve a desplegar (Vercel → Redeploy) para que los
serverless functions las lean.

## 3. Cómo se conecta una persona, en la práctica
1. En la pantalla de inicio, escribe su nombre y su correo.
2. Presiona **"Conectar mi Gmail real"** → la app la manda a
   `/api/auth/composio/start?email=...&name=...`, que a su vez la redirige a
   la pantalla de consentimiento hospedada por Composio.
3. Composio redirige de vuelta a `/api/auth/composio/callback`, que guarda
   una cookie de sesión cifrada con su `connectedAccountId`.
4. Desde ahí, `/api/gmail/live`, `/api/gmail/send` y `/api/gmail/archive`
   usan automáticamente **su** cuenta conectada (no la cuenta fija de antes).
5. Si cancela o algo falla, vuelve a la pantalla de inicio sin romper nada —
   puede intentar de nuevo o seguir en modo demostración.

## 4. Importante — verificar nombres exactos de acción
La documentación pública de Composio cambia de versión seguido y en esta
sesión no fue posible confirmar cada nombre de campo con una llamada real
(no hay credenciales de prueba disponibles aquí). El código usa, a modo de
mejor esfuerzo:
- `POST /api/v3.1/connected_accounts/link` con `{ user_id, auth_config_id, callback_url }` → esperado: `{ redirect_url }`
- `GET /api/v3.1/connected_accounts/{id}` → estado de la conexión
- `POST /api/v2/actions/execute` con `{ toolkit:'gmail', action, params, connectedAccountId }` (mismo estilo que ya usaba `send.js` para el envío de respaldo)
- Acciones usadas: `GMAIL_FETCH_EMAILS`, `GMAIL_SEND_EMAIL`, `GMAIL_REMOVE_LABEL`

**Antes de dar esto por definitivo**, entra al dashboard de Composio →
sección **"API Playground"** de cada acción de Gmail y compara los nombres
de campo exactos que espera tu cuenta/plan. Si algo no calza, ajusta
`api/_lib/composio.js` — ahí está todo centralizado, no hace falta tocar
las rutas ni el frontend.

## 5. Nada se rompe si esto no está listo
Cada punto de integración (`live.js`, `send.js`, `archive.js`) intenta
primero la conexión real de la persona (si existe), y si falla por
cualquier razón, **sigue exactamente con el comportamiento de siempre**
(la cuenta fija por `GOOGLE_REFRESH_TOKEN`, o el snapshot local). Por eso es
seguro desplegar este cambio incluso antes de terminar este setup.
