# HT Lab — Backend Contract (Frontend → Backend)

Este documento es la fuente de verdad para que el backend sepa qué necesita implementar para que el flujo **front → back → CHPP** funcione completamente.

Si algo no coincide con `FRONTEND_CONTRACT.md`, ese archivo manda para los endpoints ya existentes. Este archivo extiende ese contrato con los endpoints nuevos que el frontend requiere.

---

## Estado actual del frontend

El frontend es una app Astro estática con un único componente React: un **simulador de temporada** completamente autocontenido, sin llamadas a ningún backend. Todos sus datos son hardcodeados:

| Dato | Valor hardcodeado | Fuente real requerida |
|------|------------------|-----------------------|
| `fans` | `890` | CHPP vía `/api/stadium/analysis` (ya existe) |
| `capacity` | `12200` | CHPP vía `/api/stadium/analysis` (ya existe) |
| `teamPower` | `715` | CHPP — **endpoint nuevo requerido** |
| `division` | `6` | CHPP — **endpoint nuevo requerido** |
| `leagueTeams` | `[827, 836, 713, 542, 530, 526, 543]` | CHPP — **endpoint nuevo requerido** |
| Precios de tickets | `terraces:10, basic:20, roofed:30, vip:50` | Ya en `/api/stadium/analysis` (`recommendedSeats[x].ticketPrice`) |
| Mix de asientos | `terraces:0.4, basic:0.3, roofed:0.2, vip:0.1` | Computable desde capacity breakdown en `/api/stadium/analysis` |

---

## Responsabilidades: qué se queda en el front vs qué va al back

### Frontend (solo display + navegación)

- Páginas de auth: redirect a `/auth/login`, página de error con `?reason=`
- Dashboard protegido: llama `/auth/me` server-side para validar sesión
- Inputs del usuario: `expectation` (1–8), `fanMood` (1–10), `matchesPerSeason` (7–14), overrides de precios opcionales
- Botón "Simular" → llama al backend → muestra resultados
- Renderizado de charts (asistencia por partido, fans por partido) y tabla de partidos
- Mostrar datos del estadio real (arena, financials, recommendation) desde `/api/stadium/analysis`

### Backend (todo procesamiento y datos)

- OAuth/CHPP y manejo de sesiones (ya implementado)
- Datos reales del estadio, fans y financials (ya implementado en `/api/stadium/analysis`)
- **Datos del equipo** (teamPower, división) — nuevo
- **Datos de rivales de la liga** (7 equipos con power rating) — nuevo
- **Motor de simulación de temporada** — nuevo (actualmente vive en `src/lib/simulation.ts` del front; debe migrar al back)

---

## Endpoints existentes a consumir (ya implementados)

Referencia: `FRONTEND_CONTRACT.md`. El frontend los llamará así:

```ts
// src/lib/api.ts — cliente base (SSR: reenvía cookie; CSR: credentials:include)
const BASE = import.meta.env.API_URL ?? 'http://localhost:3000'

async function apiFetch(path: string, request?: Request, init?: RequestInit) {
  const headers: Record<string, string> = {}
  if (request) {
    // SSR: reenviar cookie del browser al backend
    const cookie = request.headers.get('cookie') ?? ''
    if (cookie) headers['Cookie'] = cookie
  }
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers,
    ...init,
  })
  if (res.status === 401) throw new AuthError()
  return res.json()
}
```

---

## Endpoints nuevos requeridos

### `GET /api/team`

**Requiere autenticación** (cookie `htlab_session`).

Datos básicos del equipo, incluyendo una métrica de poder de juego y la división actual. El `teamId` se obtiene del JWT de sesión.

**CHPP sources sugeridas:**
- `teamdetails` → teamName, leagueId, division (LeagueLevel)
- `players` o `teamdetails` extended → calcular `teamPower` como promedio ponderado de skills del XI titular estimado, o usar el `MatchRating` promedio de la temporada si CHPP lo expone

**Response `200`:**
```json
{
  "ok": true,
  "data": {
    "teamId":    "string",
    "teamName":  "string",
    "leagueId":  "string",
    "division":  6,
    "teamPower": 715
  }
}
```

> **Nota sobre `teamPower`:** Debe ser un número comparable a los `teamPower` de los rivales (misma escala). La escala que usa el simulador va aproximadamente de 300 (equipos débiles) a 1500 (élite). Si CHPP no expone un rating directo, calcularlo como la suma de los 5 skills principales del XI más fuerte (skill × 5 niveles posibles), o usar el método que mejor aproxime la fuerza relativa en liga. Lo importante es que la escala sea consistente entre el equipo propio y los rivales.

**Response `401`:**
```json
{ "ok": false, "error": "Not authenticated" }
```

**Cache sugerido:** 1 hora por `teamId`.

---

### `GET /api/league/opponents`

**Requiere autenticación** (cookie `htlab_session`).

Los 7 equipos rivales de la liga actual con sus ratings de poder, para armar el fixture de la simulación. El `leagueId` se obtiene del JWT.

**CHPP sources sugeridas:**
- `leaguedetails` → lista de equipos en la liga del usuario
- Para cada rival: mismo cálculo de `teamPower` que en `/api/team`
- Filtrar el equipo propio de la lista

**Response `200`:**
```json
{
  "ok": true,
  "data": {
    "leagueId": "string",
    "season":   "string",
    "teams": [
      { "teamId": "string", "teamName": "string", "power": 827 },
      { "teamId": "string", "teamName": "string", "power": 836 },
      { "teamId": "string", "teamName": "string", "power": 713 },
      { "teamId": "string", "teamName": "string", "power": 542 },
      { "teamId": "string", "teamName": "string", "power": 530 },
      { "teamId": "string", "teamName": "string", "power": 526 },
      { "teamId": "string", "teamName": "string", "power": 543 }
    ]
  }
}
```

> Siempre 7 rivales (liga Hattrick standard de 8 equipos). Si la liga tiene más equipos, devolver los 7 más cercanos en poder al equipo del usuario, o los primeros 7 alfabéticamente — lo que sea más simple de implementar.

**Response `401`:**
```json
{ "ok": false, "error": "Not authenticated" }
```

**Cache sugerido:** 24 horas por `leagueId` + `season`. Los rivales no cambian durante la temporada.

---

### `POST /api/simulator/season`

**Requiere autenticación** (cookie `htlab_session`).

Corre la simulación de temporada completa usando datos reales de CHPP para el equipo del usuario. Reemplaza toda la lógica que actualmente vive en `src/lib/simulation.ts` del frontend.

El backend obtiene internamente: `fans`, `capacity`, `teamPower`, `division`, `leagueTeams` y los precios/mix base desde CHPP. El frontend solo pasa parámetros configurables por el usuario.

**Request body:**
```json
{
  "fanMood":          6,
  "matchesPerSeason": 8,
  "expectation":      2,
  "prices": {
    "terraces": 7,
    "basic":    10,
    "roofed":   19,
    "vip":      35
  }
}
```

| Campo | Tipo | Rango | Default | Descripción |
|-------|------|-------|---------|-------------|
| `fanMood` | int | 1–10 | `6` | Humor inicial del fanclub |
| `matchesPerSeason` | int | 7–14 | `8` | Partidos en casa por temporada |
| `expectation` | int | 1–8 | `2` | Expectativa del usuario (1=último, 8=campeón) |
| `prices` | object | — | `recommendedSeats[x].ticketPrice` | Precios de ticket por sección. Si no se pasan, usa los precios recomendados del análisis de estadio |

> **`prices` default:** Los precios base de CHPP son `terraces:7, basic:10, roofed:19, vip:35` (los mismos que devuelve `recommendedSeats[x].ticketPrice` en `/api/stadium/analysis`). Si el frontend no envía `prices`, usar esos valores.

**Response `200`:**
```json
{
  "ok": true,
  "data": {
    "inputs": {
      "fans":             890,
      "capacity":         12200,
      "teamPower":        715,
      "division":         6,
      "leagueTeams":      [827, 836, 713, 542, 530, 526, 543],
      "fanMood":          6,
      "matchesPerSeason": 8,
      "expectation":      2,
      "prices":           { "terraces": 7, "basic": 10, "roofed": 19, "vip": 35 },
      "mix":              { "terraces": 0.4, "basic": 0.3, "roofed": 0.2, "vip": 0.1 }
    },
    "result": {
      "finalFans":     950,
      "totalRevenue":  210000,
      "avgAttendance": 8500,
      "occupancy":     0.696,
      "matches": [
        {
          "match":      1,
          "opponent":   827,
          "result":     "win",
          "position":   2,
          "mood":       7,
          "attendance": 9100,
          "revenue":    91000,
          "fans":       905
        }
      ]
    },
    "meta": {
      "modelVersion": "1.0.0",
      "generatedAt":  "ISO 8601 string"
    }
  }
}
```

> `matches` tiene exactamente 14 entradas (7 rivales × 2 partidos). Cada rival aparece dos veces.

**Response `401`:**
```json
{ "ok": false, "error": "Not authenticated" }
```

**Response `400`** (parámetros inválidos):
```json
{ "ok": false, "error": "string describing invalid param" }
```

**Response `500`:**
```json
{ "ok": false, "error": "string" }
```

> **No cachear** esta respuesta. Cada call genera un resultado distinto (simulación con aleatoriedad). El frontend decide cuándo simular.

---

## Especificación completa del motor de simulación

El backend debe implementar esta lógica exactamente (migrada desde `src/lib/simulation.ts`):

### Fixture

```
14 partidos: cada uno de los 7 rivales aparece 2 veces.
Orden: rival[0], rival[1], ..., rival[6], rival[0], rival[1], ..., rival[6]
```

### Motor de partido (`simulateMatch`)

```
diff = teamPower - opponentPower

diff > 150  → resultado = "win"  (100%)
diff < -150 → resultado = "loss" (100%)
diff > 50   → "win" 70%, "draw" 30%
diff < -50  → "win" 30%, "loss" 70%
else        → "win" 33%, "draw" 33%, "loss" 33%
```

Usa `Math.random()` (o equivalente). Cada call a `POST /api/simulator/season` produce un resultado potencialmente distinto.

### Tracking de tabla (`updateTable`)

```
Puntos: win=3, draw=1, loss=0
Equipos: el usuario + 7 rivales = 8 equipos totales

Rivales acumulan puntos de forma simplificada:
  - En cada partido donde el usuario juega vs rivalX:
      si usuario gana → rivalX pierde (rival suma 0)
      si empate → ambos suman 1
      si usuario pierde → rivalX gana (rival suma 3)
  - Partidos rival vs rival (los que no involucran al usuario):
      No se simulan; los rivales acumulan un promedio fijo de 1.5 pts/partido
      (equivale a ~50% winrate, simplificación aceptable)

Posición del usuario = rank del usuario en la tabla después de cada partido (1=primero, 8=último)
```

### Humor (`updateMood`)

```
expectedPos = 9 - expectation   // expectation=8 → expectedPos=1, expectation=1 → expectedPos=8

if currentPos <= expectedPos - 2  → mood = min(mood + 1, 10)   // mejor de lo esperado
if currentPos >= expectedPos + 2  → mood = max(mood - 1, 1)    // peor de lo esperado
else                              → mood sin cambio
```

### Asistencia (`calcAttendance`)

```
base         = random(20, 25)           // uniform int entre 20 y 25 inclusive
moodFactor   = 0.8 + mood * 0.04       // rango: 0.84 (mood=1) → 1.2 (mood=10)
posFactor    = 1 + (8 - position) * 0.02
attendance   = fans * base / 1000 * moodFactor * posFactor * matchesPerSeason
attendance   = floor(min(attendance, capacity))
```

> **Nota:** El frontend actual usa `fans * base * moodFactor * posFactor` sin dividir. Esto produce números extremadamente grandes. La división `/1000` es la corrección necesaria para que la asistencia sea un número razonable dado que `fans ≈ 890` y `base ≈ 20-25`. Revisar contra datos reales de CHPP y ajustar el factor de escala si es necesario para que `fillRate` sea plausible.

### Revenue (`calcRevenue`)

```
weightedPrice = mix.terraces * prices.terraces
              + mix.basic    * prices.basic
              + mix.roofed   * prices.roofed
              + mix.vip      * prices.vip

revenue = attendance * weightedPrice
```

### Mix de asientos

```
Calculado desde los datos reales de capacidad del estadio:

total = arena.capacity.terraces + arena.capacity.basic + arena.capacity.roofed + arena.capacity.vip

mix.terraces = arena.capacity.terraces / total
mix.basic    = arena.capacity.basic    / total
mix.roofed   = arena.capacity.roofed   / total
mix.vip      = arena.capacity.vip      / total
```

Si `total === 0` (estadio sin datos de CHPP), usar defaults: `terraces:0.5, basic:0.3, roofed:0.15, vip:0.05`.

### Fan growth (`updateFans`)

```
expectedPos  = 9 - expectation
diff         = expectedPos - currentPos   // positivo si mejor de lo esperado
growth       = diff * 0.01               // ej: 2 puestos mejor → +2%

divisionCap  = 50000 / division          // div1→50k, div2→25k, ..., div6→8333
saturation   = 1 - fans / divisionCap    // frena crecimiento cerca del techo

newFans      = round(fans + fans * growth * saturation)
newFans      = max(newFans, 1)           // mínimo 1 fan
```

---

## Mix de asientos — cálculo en el frontend

El frontend calcula el `mix` una vez al recibir los datos de `/api/stadium/analysis`, antes de enviarlo al simulador. Si el backend prefiere calcularlo internamente con los datos de CHPP que ya tiene, es equivalente y preferible para no duplicar lógica.

---

## Resumen de nuevos endpoints

| Endpoint | Auth | Cache | Descripción |
|----------|------|-------|-------------|
| `GET /api/team` | Cookie | 1h/teamId | teamPower, division, info básica |
| `GET /api/league/opponents` | Cookie | 24h/leagueId+season | 7 rivales con power ratings |
| `POST /api/simulator/season` | Cookie | No cachear | Simulación completa de temporada |

---

## Variables de entorno requeridas en el frontend

| Var | Descripción |
|-----|-------------|
| `API_URL` | URL del backend (ej: `http://localhost:3000` en dev, URL de Railway en prod) |

El frontend usará `import.meta.env.API_URL` en SSR y `import.meta.env.PUBLIC_API_URL` para client-side si fuera necesario.

---

## Cambios requeridos en el frontend (para referencia del backend)

Una vez implementados los endpoints, el frontend hará los siguientes cambios:

1. **Astro en modo SSR** (`output: 'server'` con adapter de Node o Railway)
2. **`src/lib/api.ts`** — cliente API centralizado con reenvío de cookie en SSR
3. **`src/pages/auth/login.astro`** — botón que redirige a `GET /auth/login`
4. **`src/pages/auth/error.astro`** — muestra error según `?reason=`
5. **`src/pages/dashboard.astro`** — página protegida: llama `/auth/me` server-side, redirige a login si 401
6. **`Simulator.tsx` refactorizado** — llama `POST /api/simulator/season`, recibe el resultado, solo renderiza
7. **Eliminar `src/lib/simulation.ts`** — toda esa lógica migra al backend

---

## Prioridad de implementación sugerida

### Fase 1 — Flujo base (todo existe en el backend ya)
1. Frontend en SSR + `src/lib/api.ts`
2. Páginas auth (login, error, dashboard protegido con `/auth/me`)
3. Dashboard muestra datos de `/api/stadium/analysis` (estadio real, financials, recommendation)

**Resultado:** El usuario puede loguearse con Hattrick y ver su análisis de estadio real.

### Fase 2 — Simulador con datos reales
1. `GET /api/team` → teamPower + division
2. `GET /api/league/opponents` → 7 rivales con ratings
3. `POST /api/simulator/season` → motor de simulación
4. Frontend conecta el simulador al backend

**Resultado:** El simulador usa datos reales de CHPP en lugar de valores hardcodeados.
