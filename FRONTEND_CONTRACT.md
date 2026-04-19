# HT Lab — API Contract (Backend → Frontend)

Este documento es la fuente de verdad para que el frontend sepa exactamente qué esperar de este backend.
Si algo no coincide, el backend manda.

---

## Base URL

| Entorno | URL |
|---------|-----|
| Dev | `http://localhost:3000` |
| Prod | `https://<railway-app>.up.railway.app` |

---

## Autenticación

El backend usa una **cookie HttpOnly** llamada `htlab_session`.

- El frontend **nunca** puede leerla desde JS (es HttpOnly).
- Todas las llamadas a rutas protegidas deben enviarse con `credentials: 'include'` para que el browser adjunte la cookie automáticamente.
- Si usás un frontend SSR (Astro, Next.js, etc.), tenés que reenviar el header `Cookie` manualmente en los fetches server-side:

```ts
const cookie = request.headers.get('cookie') ?? ''
const res = await fetch('http://localhost:3000/api/stadium/analysis', {
  headers: { Cookie: cookie },
})
if (res.status === 401) redirect('/auth/login')
```

### Contenido del JWT (no accesible desde el frontend)

El JWT firmado dentro de la cookie contiene:
```
userId            — string  (UserID de CHPP, o TeamID como fallback)
teamId            — string  (TeamID de CHPP)
teamName          — string
leagueId          — string
accessToken       — string  (token CHPP, no expira)
accessTokenSecret — string
```

Duración de la sesión: **7 días** desde el último login.

---

## Flujo OAuth (login)

```
1. Frontend redirige al usuario a GET /auth/login
   → El backend obtiene un request token de CHPP y redirige al usuario a hattrick.org

2. El usuario autoriza en hattrick.org
   → Hattrick redirige a GET /auth/callback?oauth_token=...&oauth_verifier=...

3. El backend intercambia los tokens, setea la cookie htlab_session y redirige a:
   → ${FRONTEND_URL}/dashboard        (éxito)
   → ${FRONTEND_URL}/auth/error?reason=<código>  (error)
```

### Códigos de error de OAuth

| `reason` | Causa |
|----------|-------|
| `request_token_failed` | No se pudo obtener el request token de CHPP |
| `missing_params` | El callback llegó sin `oauth_token` o `oauth_verifier` |
| `unknown_token` | El `oauth_token` del callback no coincide con ningún login pendiente (token expirado o sesión perdida) |
| `access_token_failed` | CHPP rechazó el intercambio de tokens (usuario denegó acceso, o error de CHPP) |

---

## Endpoints

### `GET /health`

Sin autenticación. Health check.

**Response `200`:**
```json
{ "ok": true, "ts": "2025-01-01T00:00:00.000Z" }
```

---

### `GET /auth/login`

Sin autenticación. Inicia el flujo OAuth — el backend **redirige** al usuario a hattrick.org. No retorna JSON.

---

### `GET /auth/callback`

Sin autenticación. Callback de Hattrick — el backend lo maneja internamente. El frontend no lo llama directamente.
Al terminar redirige a `/dashboard` o a `/auth/error?reason=...`.

---

### `GET /auth/me`

**Requiere autenticación** (cookie `htlab_session`).

**Response `200`:**
```json
{
  "userId":   "string",
  "teamId":   "string",
  "teamName": "string",
  "leagueId": "string"
}
```

**Response `401`:**
```json
{ "ok": false, "error": "Not authenticated" }
```

---

### `POST /auth/logout`

Sin autenticación requerida. Limpia la cookie de sesión.

**Response `200`:**
```json
{ "ok": true }
```

---

### `GET /api/stadium/analysis`

**Requiere autenticación** (cookie `htlab_session`).

**Query params opcionales:**

| Param | Tipo | Rango | Default | Descripción |
|-------|------|-------|---------|-------------|
| `fanMood` | int | 1–10 | `6` | Mood actual del fanclub |
| `matchesPerSeason` | int | 7–14 | `8` | Partidos en casa estimados por temporada |

El conteo de fans se lee directamente de la API CHPP (no se puede pasar como parámetro).

**Response `200`:**
```json
{
  "ok": true,
  "data": {
    "arena": {
      "arenaId":           "string",
      "arenaName":         "string",
      "teamId":            "string | number",
      "teamName":          "string",
      "leagueId":          "string | number",
      "capacity": {
        "terraces": 0,
        "basic":    0,
        "roofed":   0,
        "vip":      0
      },
      "totalCapacity":     0,
      "weeklyMaintenance": 0,
      "lastUpdated":       "ISO 8601 string"
    },
    "fans": {
      "count": 0,
      "mood":  6
    },
    "attendance": {
      "expected":        0,
      "fillRate":        0.000,
      "matchesPerSeason": 8
    },
    "financials": {
      "currentWeeklyGrossIncome": 0,
      "currentWeeklyMaintenance": 0,
      "currentWeeklyNetIncome":   0,
      "currentSeasonNetIncome":   0
    },
    "recommendation": {
      "optimalCapacity": 0,
      "recommendedSeats": {
        "terraces": { "seats": 0, "ticketPrice": 7,  "weeklyMaintenance": 0, "buildCostIfNew": 0 },
        "basic":    { "seats": 0, "ticketPrice": 10, "weeklyMaintenance": 0, "buildCostIfNew": 0 },
        "roofed":   { "seats": 0, "ticketPrice": 19, "weeklyMaintenance": 0, "buildCostIfNew": 0 },
        "vip":      { "seats": 0, "ticketPrice": 35, "weeklyMaintenance": 0, "buildCostIfNew": 0 }
      },
      "roi": {
        "expansionNeeded": true,
        "deltaSeats":          0,
        "buildCost":           0,
        "weeklyIncomeGain":    0,
        "seasonIncomeGain":    0,
        "paybackWeeks":        0,
        "newWeeklyMaintenance": 0
      },
      "verdict": {
        "status":  "expand | optimal | watch | oversized",
        "message": "string"
      }
    },
    "meta": {
      "modelVersion": "1.0.0",
      "generatedAt":  "ISO 8601 string"
    }
  }
}
```

#### Notas sobre el campo `roi`

- Cuando `expansionNeeded` es `false` (estadio sobredimensionado u óptimo), solo están presentes `expansionNeeded` y `deltaSeats: 0`. Los demás campos no existen.
- `paybackWeeks` puede ser `null` si el gain semanal es ≤ 0 (expansión no rentable).

#### Valores del campo `verdict.status`

| Status | Significado |
|--------|-------------|
| `expand` | Expandir — el ROI se amortiza en ≤ 20 partidos en casa |
| `optimal` | Capacidad dentro del ±5% del óptimo calculado |
| `watch` | Capacidad baja pero ROI no justifica expansión todavía |
| `oversized` | Estadio más grande de lo que la base de fans puede llenar |

#### Cache

Esta respuesta está cacheada **4 horas** por `teamId`. Requests sucesivos durante ese período devuelven el mismo `generatedAt`.

**Response `401`:**
```json
{ "ok": false, "error": "Not authenticated" }
```

**Response `500`:**
```json
{ "ok": false, "error": "string (mensaje de error)" }
```

---

## Formato de errores de autenticación

Cuando una ruta protegida recibe una cookie inválida o expirada, además del `401` limpia la cookie automáticamente. El frontend debe redirigir al usuario a `/auth/login`.

```json
{ "ok": false, "error": "Session expired — please log in again" }
```

---

## CORS

El backend acepta requests **solo** desde `FRONTEND_URL` (configurado por env var).
Todas las llamadas deben incluir `credentials: 'include'`:

```ts
fetch('http://localhost:3000/api/stadium/analysis', {
  credentials: 'include',
})
```

Sin `credentials: 'include'`, el browser no envía la cookie y el backend responde `401`.

---

## Variables de entorno que afectan al frontend

| Var | Efecto en el frontend |
|-----|-----------------------|
| `FRONTEND_URL` | El backend redirige a esta URL después del login/error |
| `CHPP_CALLBACK_URL` | Debe apuntar a la URL del backend, no del frontend (`/auth/callback`) |

---

## Roadmap de endpoints (próximas iteraciones)

Endpoints planificados pero **aún no implementados**:

| Ruta | Descripción |
|------|-------------|
| `GET /api/fans` | Datos del fanclub directamente de CHPP (sin parámetros del frontend) |
| `GET /api/team` | Datos generales del equipo (teamdetails) |
| `GET /api/team/summary` | teamdetails + players en paralelo |
| `GET /api/player` | Roster completo con skills |
| `GET /api/player/analysis` | Rating por posición para cada jugador |
| `GET /api/player/lineup` | XI óptimo para una formación dada |
