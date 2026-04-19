# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos de desarrollo

```bash
npm run dev    # Inicia el servidor con hot-reload (node --watch)
npm start      # Inicia el servidor en producción
```

No hay test suite todavía. El testing se hace manualmente contra credenciales CHPP reales (ver roadmap).

Para probar el flujo OAuth localmente: arranca el servidor, abre `http://localhost:3000/auth/login` en el browser y completa la autorización en Hattrick.

# HT Lab — Backend

Herramienta de análisis para managers de Hattrick (hattrick.org), aprobada como software CHPP oficial.
Consume la API CHPP de Hattrick vía OAuth 1.0a y genera insights de gestión de equipo y estadio.

## Stack

- **Runtime**: Node.js ESM (`"type": "module"` en package.json)
- **Framework**: Express 4
- **Auth**: OAuth 1.0a (CHPP) + JWT en HttpOnly cookie
- **XML parsing**: fast-xml-parser (CHPP devuelve siempre XML)
- **Cache**: node-cache en memoria (TTL configurable por tipo de dato)
- **Deploy target**: Railway (backend) + Vercel/Netlify (frontend React, repo separado)

## Estructura del proyecto

```
src/
  config/index.js         — env vars tipadas; lanza si falta alguna requerida
  services/chpp.js        — OAuth 1.0a puro: getRequestToken, getAccessToken, chppRequest
  services/stadium.js     — modelo de datos + engine de análisis de estadio + ROI
  routes/auth.js          — GET /auth/login → /auth/callback → /auth/me, POST /auth/logout
  routes/stadium.js       — GET /api/stadium/analysis
  middleware/auth.js      — requireAuth / optionalAuth (verifica JWT del cookie)
  utils/cache.js          — instancia compartida de node-cache
```

## Endpoints disponibles

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/health` | No | Health check para uptime monitors |
| GET | `/auth/login` | No | Inicia el flujo OAuth — redirige a Hattrick |
| GET | `/auth/callback` | No | Callback OAuth — emite JWT en cookie |
| GET | `/auth/me` | Sí | Info básica del usuario autenticado |
| POST | `/auth/logout` | No | Limpia la cookie de sesión |
| GET | `/api/stadium/analysis` | Sí | Análisis completo de estadio + ROI |

### Parámetros de `/api/stadium/analysis`

Query params opcionales:
- `fanMood` (int 1–10, default 6) — mood actual del fan club
- `matchesPerSeason` (int 7–14, default 8) — partidos en casa esperados

### Respuesta de `/api/stadium/analysis`

```json
{
  "ok": true,
  "data": {
    "arena": {
      "arenaId": "...", "arenaName": "...", "teamId": "...", "teamName": "...",
      "capacity": { "terraces": 0, "basic": 0, "roofed": 0, "vip": 0 },
      "totalCapacity": 0,
      "weeklyMaintenance": 0
    },
    "fans": { "count": 0, "mood": 6 },
    "attendance": { "expected": 0, "fillRate": 0.0, "matchesPerSeason": 8 },
    "financials": {
      "currentWeeklyGrossIncome": 0,
      "currentWeeklyMaintenance": 0,
      "currentWeeklyNetIncome": 0,
      "currentSeasonNetIncome": 0
    },
    "recommendation": {
      "optimalCapacity": 0,
      "recommendedSeats": {
        "terraces":  { "seats": 0, "ticketPrice": 7,  "weeklyMaintenance": 0, "buildCostIfNew": 0 },
        "basic":     { "seats": 0, "ticketPrice": 10, "weeklyMaintenance": 0, "buildCostIfNew": 0 },
        "roofed":    { "seats": 0, "ticketPrice": 19, "weeklyMaintenance": 0, "buildCostIfNew": 0 },
        "vip":       { "seats": 0, "ticketPrice": 35, "weeklyMaintenance": 0, "buildCostIfNew": 0 }
      },
      "roi": {
        "expansionNeeded": true,
        "deltaSeats": 0,
        "buildCost": 0,
        "weeklyIncomeGain": 0,
        "seasonIncomeGain": 0,
        "paybackWeeks": 0,
        "newWeeklyMaintenance": 0
      },
      "verdict": { "status": "expand|optimal|watch|oversized", "message": "..." }
    },
    "meta": { "modelVersion": "1.0.0", "generatedAt": "..." }
  }
}
```

## Modelo de datos del stadium engine

Constantes calibradas con datos de la wiki y comunidad de Hattrick:

| Tipo | Precio ticket | Mant./asiento/sem | Build cost/asiento | Mix recomendado |
|------|--------------|-------------------|--------------------|-----------------|
| Terraces | €7 | €0.50 | €45 | 62% |
| Basic | €10 | €0.70 | €75 | 20% |
| Roofed | €19 | €1.00 | €90 | 12% |
| VIP | €35 | €2.50 | €300 | 6% |

Costo fijo por conversión: **€10.000** (más €6/asiento si se reduce).

### Fórmula de asistencia esperada

```js
moodFactor = 0.4 + (fanMood / 10) * 1.2   // rango: 0.4 (mood=1) → 1.6 (mood=10)
expectedAttendance = fans * moodFactor * 13.5
```

Calibrado para que 2.500 fans con mood 6 ≈ 40.000 asistentes (validado con datos de comunidad).
El multiplicador 13.5 es el parámetro más importante a ajustar con datos reales de usuarios CHPP.

### Fórmula de ROI

```js
optimalCapacity  = expectedAttendance * 1.10
buildCost        = 10_000 + Σ(newSeats[tipo] * buildCostPerSeat[tipo])
weeklyNetGain    = weeklyIncome(optCap) - weeklyMaintenance(optCap)
                 - weeklyIncome(curCap) + weeklyMaintenance(curCap)
paybackWeeks     = buildCost / weeklyNetGain   // en partidos de local
```

## Variables de entorno requeridas

Ver `.env.example`. Las críticas son:

```
CHPP_CONSUMER_KEY       — de hattrick.org/en/community/CHPP/checkAccess.aspx
CHPP_CONSUMER_SECRET    — ídem
JWT_SECRET              — string largo aleatorio (mínimo 32 chars en prod)
CHPP_CALLBACK_URL       — debe coincidir exactamente con lo registrado en CHPP
FRONTEND_URL            — para CORS y redirect post-auth
```

## Decisiones de arquitectura importantes

### Tokens CHPP en el JWT (decisión de MVP)
El `accessToken` y `accessTokenSecret` de CHPP viajan dentro del JWT firmado en la cookie HttpOnly.
Ventaja: no requiere DB para el MVP. 
Limitación: no se pueden revocar sesiones individualmente.
**TODO**: cuando se agregue PostgreSQL, guardar tokens cifrados en DB y poner solo `sessionId` en el JWT.

### `pendingTokens` en memoria
Durante el baile OAuth 1.0a se necesita guardar el `oauthTokenSecret` temporalmente entre
`/auth/login` y `/auth/callback`. Actualmente es un `Map` en memoria con limpieza a los 10 min.
**TODO**: reemplazar por Redis si se escala a múltiples instancias en Railway.

### Cache en memoria
`node-cache` con TTL de 4 horas para datos de arena (`stadium:{teamId}`).
CHPP no actualiza datos de arena en tiempo real — no tiene sentido llamar en cada request.

### OAuth 1.0a (no 2.0)
CHPP usa OAuth **1.0a** con HMAC-SHA1. La librería es `oauth-1.0a`.
El flujo tiene 3 pasos: request_token → authorize (redirect) → access_token.
Los endpoints oficiales son:
- `https://chpp.hattrick.org/oauth/request_token.ashx`
- `https://chpp.hattrick.org/oauth/authorize.aspx`
- `https://chpp.hattrick.org/oauth/access_token.ashx`
- `https://chpp.hattrick.org/chppxml.ashx` (todos los datos)

## Roadmap acordado

### Inmediato (MVP)
- [x] Flujo OAuth 1.0a completo
- [x] Endpoint `/api/stadium/analysis` con modelo de ROI
- [ ] Endpoint `/api/fans` — datos de fans sin depender de parámetros del frontend
- [ ] Tests de integración con credenciales CHPP reales

### Próxima iteración
- [ ] PostgreSQL en Railway — usuarios, sesiones, historial de análisis
- [ ] Endpoint `/api/team` — datos generales del equipo
- [ ] Endpoint `/api/season` — simulación de temporada (Season Result Estimation)
- [ ] Endpoint `/api/players` — Best XI y squad weakness detection

### Futuro
- [ ] Fan growth prediction
- [ ] Transfer market insights
- [ ] Youth development modeling

## Convenciones de código

- ESM puro: siempre `import/export`, nunca `require`
- Async/await, nunca callbacks
- Errores: dejar que propaguen hasta el handler global de Express; loguear con `console.error('[contexto]', err.message)`
- Números que llegan al cliente: siempre `Math.round()` antes de serializar
- Cache keys: formato `entidad:id` (ej: `stadium:123456`)
- No hay ORM todavía — cuando se agregue DB, usar `postgres` (driver nativo) o `drizzle-orm`
