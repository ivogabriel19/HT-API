# Hattrick CHPP API Integration Guide

## Overview

Hattrick exposes data via the **CHPP API** (Community-provided Hattrick Program Partners).
- Protocol: **OAuth 1.0a** (not 2.0)
- Response format: **XML**, always wrapped in `<HattrickData>`
- Base URL: `https://chpp.hattrick.org`

---

## OAuth 1.0a Flow

### Endpoints
| Step | URL |
|------|-----|
| Request token | `https://chpp.hattrick.org/oauth/request_token.ashx` |
| User authorization | `https://chpp.hattrick.org/oauth/authorize.aspx` |
| Access token | `https://chpp.hattrick.org/oauth/access_token.ashx` |
| API calls | `https://chpp.hattrick.org/chppxml.ashx` |

### Dance (3 steps)

```
1. Backend → GET request_token (signed with consumer key/secret)
             → Hattrick returns oauth_token + oauth_token_secret

2. Redirect user → https://chpp.hattrick.org/oauth/authorize.aspx?oauth_token=...
                 → User approves on Hattrick
                 → Hattrick redirects to your callback: /auth/callback?oauth_token=...&oauth_verifier=...

3. Backend → GET access_token (signed with consumer key/secret + request token/secret + verifier)
           → Hattrick returns final access_token + access_token_secret
           → Store these — they don't expire
```

### npm package

Use the `oauth` package (not `oauth-1.0a`). It wraps the full dance with a callback-based API:

```typescript
import { OAuth } from "oauth"

const consumer = new OAuth(
  "https://chpp.hattrick.org/oauth/request_token.ashx",
  "https://chpp.hattrick.org/oauth/access_token.ashx",
  CONSUMER_KEY,
  CONSUMER_SECRET,
  "1.0A",
  CALLBACK_URL,   // registered in your CHPP app settings
  "HMAC-SHA1"
)

// Step 1
consumer.getOAuthRequestToken((err, token, tokenSecret) => { ... })

// Step 3
consumer.getOAuthAccessToken(token, tokenSecret, verifier, (err, accessToken, accessTokenSecret) => { ... })

// API call
consumer.get(url, accessToken, accessTokenSecret, (err, data) => { ... })
```

### Token storage (no database)

Sign the access token + secret into a **JWT cookie** (httpOnly, 30 days):

```typescript
// After step 3:
const jwt = sign({ accessToken, accessTokenSecret }, JWT_SECRET, { expiresIn: "30d" })
res.cookie("ht_token", jwt, { httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000 })

// On every protected request:
const { accessToken, accessTokenSecret } = verify(cookieValue, JWT_SECRET)
```

Store the request token secret temporarily during the dance (step 1 → step 3):

```typescript
const tempJwt = sign({ requestTokenSecret }, JWT_SECRET, { expiresIn: "10m" })
res.cookie("ht_request_secret", tempJwt, { httpOnly: true, maxAge: 10 * 60 * 1000 })
```

---

## Making API Calls

All data comes from `GET https://chpp.hattrick.org/chppxml.ashx` with a `file` query param:

```typescript
const query = new URLSearchParams({ file: "players", ...extraParams }).toString()
const url = `https://chpp.hattrick.org/chppxml.ashx?${query}`
consumer.get(url, accessToken, accessTokenSecret, callback)
```

### Available files (common)
| `file=` | Returns |
|---------|---------|
| `players` | Current team's full player roster |
| `teamdetails` | Team info, arena, league, rankings |
| `matchlist` | Upcoming and recent matches |
| `worlddetails` | Countries, leagues |

---

## XML Parsing

Use `fast-xml-parser` with `ignoreAttributes: false` to preserve XML attributes:

```typescript
import { XMLParser } from "fast-xml-parser"

const parser = new XMLParser({ ignoreAttributes: false })
const parsed = parser.parse(xmlString)
```

### Critical: attribute + text nodes

When an XML element has both a value AND attributes, fast-xml-parser wraps it:

```xml
<NumberOfVictories Available="True">2</NumberOfVictories>
```
Becomes:
```json
{ "NumberOfVictories": { "#text": 2, "@_Available": "True" } }
```

Access with: `team.NumberOfVictories?.["#text"] ?? team.NumberOfVictories`

---

## Actual XML Structure (verified against live CHPP API)

### `teamdetails` → `HattrickData.Team`

```
HattrickData
  Team
    TeamID, TeamName, ShortTeamName
    Arena       { ArenaID, ArenaName }
    League      { LeagueID, LeagueName }
    Region      { RegionID, RegionName }
    LeagueLevelUnit { LeagueLevelUnitID, LeagueLevelUnitName, LeagueLevel }
    PowerRating { GlobalRanking, LeagueRanking, RegionRanking, PowerRating }
    NumberOfVictories   { "#text": N, "@_Available": "True" }
    NumberOfUndefeated  { "#text": N, "@_Available": "True" }
    TeamRank            { "#text": N, "@_Available": "True" }
    Cup         { StillInCup, CupID, CupName }
    BotStatus   { IsBot }
    YouthTeamID
```

**Not present in API v1.9:** `LogoURL`, `Country`, `Fanclub`, `FoundedDate`

### `players` → `HattrickData.Team.PlayerList.Player[]`

```
HattrickData
  Team
    TeamID, TeamName
    PlayerList
      Player[]
        PlayerID, PlayerName        ← single full name, no FirstName/LastName split
        Age, AgeDays
        TSI
        PlayerForm, Experience, Leadership, Stamina
        Salary
        CountryID                   ← nationality (for chemistry)
        Specialty                   ← 0=none, 1=speed, 2=technical, 3=powerful, 4=unpredictable, 5=head
        InjuryLevel                 ← -1 = healthy
        StaminaSkill
        KeeperSkill
        PlaymakerSkill
        ScorerSkill
        PassingSkill
        WingerSkill
        DefenderSkill
        SetPiecesSkill
        IsAbroad                    ← 1 if playing in foreign league
        NationalTeamID, Caps, CapsU20
        Cards, CareerGoals, CareerHattricks
```

**Not present:** `FirstName`, `LastName`, `ArrivalDate`, `TeamID` (on individual players)

---

## Gotchas

| Issue | Fix |
|-------|-----|
| `Teams.Team` path for teamdetails | Actual path is just `Team` — `HattrickData.Team`, no `Teams` wrapper |
| `FirstName`/`LastName` on players | API returns `PlayerName` as a single field |
| `ArrivalDate` for newest player | Not available — use highest `PlayerID` as proxy |
| TeamID on players for chemistry | Not present — skip; use `CountryID` + `Age` diff only |
| `NumberOfVictories` is object | Has `{ "#text": N }` when element has XML attributes |
| CORS with SSR frontend | Backend needs `credentials: true`; SSR fetches must forward `Cookie` header manually |

---

## Environment Variables

```env
CHPP_CONSUMER_KEY=...
CHPP_CONSUMER_SECRET=...
CHPP_CALLBACK_URL=http://localhost:3000/auth/callback   # must match registered URL in CHPP dashboard
JWT_SECRET=...
FRONTEND_URL=http://localhost:4321
PORT=3000
```

The callback URL must be **pre-registered** in your CHPP app at:
`https://www.hattrick.org/en/community/CHPP/checkAccess.aspx`

---

## SSR Frontend Cookie Forwarding

If using a server-rendered frontend (Astro, Next.js, etc.), the browser cookie won't be automatically included in server-side fetch calls. Forward it manually:

```typescript
// Astro example
const cookie = Astro.request.headers.get("cookie") ?? ""
const res = await fetch("http://localhost:3000/api/team/summary", {
  headers: { Cookie: cookie },
})
if (res.status === 401) return Astro.redirect("/login")
```

---

## Route Structure (Express)

```
GET  /auth/login       → get request token, set temp cookie, redirect to Hattrick
GET  /auth/callback    → exchange tokens, set ht_token cookie, redirect to frontend
POST /auth/logout      → clear ht_token cookie
GET  /auth/status      → { authenticated: boolean }

GET  /api/team         → requireAuth → teamdetails file
GET  /api/team/summary → requireAuth → teamdetails + players (parallel fetch)
GET  /api/player       → requireAuth → players file
GET  /api/player/analysis   → requireAuth → players + position rating analysis
GET  /api/player/lineup     → requireAuth → optimal XI for given formation
```

All `/api/*` routes protected by middleware that reads + verifies the `ht_token` JWT cookie.
