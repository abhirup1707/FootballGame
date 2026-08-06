# Footyverse — Architecture Plan (FC Mobile / eFootball level)

Target: turn the current 1v1 live-draft web game into an FC Mobile / eFootball-style game with
persistent teams, daily packs, quests, seasonal cards, stat-based OVR advantages, and
matchmaking — while staying a web game.

Current data already models seasonal cards: `src/data/players.js` stores separate `id` records
for the same player across seasons/clubs (e.g. Barcelona Messi 2011-12 vs 2014-15). The plan
formalizes that into a proper card + ownership system.

---

## 1. Target product model

| FC Mobile concept | Footyverse equivalent |
|---|---|
| Your club / team | Persistent squad (11 starters + bench) saved per account |
| Packs + coins/gems | Daily free pack, coin packs, gem packs, quest reward packs |
| Quests / objectives | Daily + weekly quests → cards, coins, gems, XP |
| Seasonal cards | Same player, different season/club = different card |
| OVR + stat advantages | Per-match stat-based resolution; OVR gap shifts odds |
| Matchmaking + friendlies | OVR-band matchmaking queue + existing private rooms |

Decisions locked in with the owner:
- Identity: **username + password** login (argon2 hashing, session tokens).
- Persistence: **PostgreSQL** in production (Render), **SQLite** for local dev.
- Scope: everything — accounts, teams, packs, quests, season cards, OVR advantages, enhanced engine.

---

## 2. Data model

```
users            id, username (unique), password_hash (argon2), coins, gems, xp, level,
                 last_claimed_daily, streak, created_at
sessions         id, user_id, token_hash, created_at, expires_at

cards            id, name, season, club, position, category(ATT/MID/DEF/GK),
                 stats {pace, shooting, passing, dribbling, defending, physicality},
                 base_rating, tier(base/inform/prime/icon), image
owned_cards      id, user_id, card_id, rating, xp, is_in_xi, slot, acquired_from, acquired_at
formations       id, user_id, name, slots (11 positions → owned_cards ids)

pack_types       id, name, cost_type(coins/gems), cost, odds jsonb, contents
pack_claims      id, user_id, pack_type_id, card_ids[], opened_at

quests           id, key, type, requirement, reward jsonb, reset_daily
quest_progress   id, user_id, quest_id, progress, claimed_at

matches          id, mode(friendly/ranked), user_ids, team_ratings, result,
                 goals, coins_awarded, xp_awarded, created_at
```

Why two tables for players: `cards` is the static catalog (unique seasonal card), `owned_cards`
is a player's instance of it. The same catalog card can exist in many accounts, each with its own
rating/XP and XI slot. `pack_claims` records what a pack produced (auditable economy).

---

## 3. Card & OVR system

- **Card identity** = `name` + `season` + `club`. Barcelona Messi 2011-12 and PSG Messi 2020-21
  are distinct cards with distinct stat spreads.
- **Stats**: replace the single `rating` with six stats (EAFC-style):
  `pace`, `shooting`, `passing`, `dribbling`, `defending`, `physicality`.
  **OVR = weighted average** — attackers weight SHO/DRI/PAC, defenders weight DEF/PHY.
- **Tiers**: `base` → `inform` → `prime` → `icon`, each a multiplier on base stats.
  Featured seasonal cards rotate per season.
- **Seeding**: keep `src/data/*.json` as the source of truth for the catalog; a seed script
  imports them into `cards` on first run.

---

## 4. Backend architecture

Current `server/server.js` is a single in-memory file, and **the client sends the player list to
the server for draft validation** — that must become server-authoritative once ownership exists.

New structure:

```
server/
  index.js            app bootstrap + listen
  db.js               connection pool (pg prod / better-sqlite3 dev) via Drizzle ORM
  migrations/         versioned schema migrations
  seed.js             loads src/data JSONs into cards
  auth.js             register/login/logout, argon2, session tokens
  routes/
    auth.js           POST /auth/register, /auth/login, /auth/logout
    team.js           GET/PUT /team, GET /inventory, PUT /formations
    packs.js          GET /packs, POST /packs/:id/open  (atomic)
    quests.js         GET /quests, POST /quests/:id/claim
    profile.js        GET /me  (coins, gems, xp, level, streak)
  socket/
    server.js         connection + auth-on-socket, private rooms
    room.js           room lifecycle, rematch, reconnect timers
    match.js          possession / pass / corner / penalty engine (refactored out)
    matchmaking.js    queue → pair by OVR band → auto-create room
  logic/
    packs.js          odds resolution (guaranteed-rarity rules)
    quests.js         quest progress evaluation on match finish
    rewards.js        coin/xp formulas (win/loss, OVR gap)
    ovr.js            stat-based match resolution helpers
```

- **DB access**: Drizzle ORM (tiny, typed, one schema for both Postgres and SQLite). Local dev
  uses a SQLite file; Render runs Postgres with the same queries.
- **Auth**: argon2 + hashed session tokens. Socket connections authenticate by token so match
  results credit the right account.

---

## 5. Match engine enhancements

Keep the existing loop (possession → pass → 5 passes = shot → hidden-corner → penalty shootout).
Replace binary outcome checks with stat-driven resolution:

- **Pass success**: base ~90%, reduced by defender DEF on the receiver; OVR gap between passer and
  interceptor shifts the defender's read chance (35% → ~25%–55%).
- **Interception**: a predicted pass is intercepted only if the defender's DEF ≥ carrier's DRI
  threshold — a 95-DRI carrier shrugs off a weak read.
- **Shot**: hidden corner stays, but outcome odds move with shooter SHO vs keeper DIF
  (base 50% ± OVR delta × ~2.5%).
- **Possession battles**: carrier DRI/PAC vs defender DEF at kickoff and after saves.
- **Stamina**: simple fatigue from each pass/shot; PHY determines drain, so bench/subs matter.
- **Modes**: "Ultimate Team" (owned XI, matchmaking) plus the current Fantasy Draft as a casual
  private-room mode.

---

## 6. Daily loop & economy

- **Daily free pack**: one claim per UTC day (`last_claimed_daily`); streak rewards.
- **Time-gated packs**: "Rare+ — opens in 4h"; instant coin/gem packs with seeded odds.
- **Quests** (daily reset + weekly): "Win 3 matches", "Score 5 goals with a forward",
  "Open 1 pack" → coins, gems, guaranteed card packs. Progress events fire server-side on
  `matchFinished`.
- **Currencies**: coins (match + quests), gems (premium, quests/streaks), XP → level
  (level-up grants a free pack).
- **Guardrails**: pack odds and quest progress are server-validated; clients are never trusted.

---

## 7. Frontend architecture

`App.jsx` currently switches between two screens (Lobby / Draft). Replace with a light screen
state machine (no router library needed):

```
App
 ├─ Auth        login / register
 ├─ Home/Hub    team view, OVR, coins/gems bar, daily claim, nav
 ├─ Team        view squad, set formation from owned_cards
 ├─ Packs       pack store + opening animation (reuse AnimatedPack.jsx)
 ├─ Quests      daily/weekly list + claim buttons
 ├─ Lobby       existing screen + "Matchmake" + private rooms
 ├─ Match       existing Match.jsx, wired to the owned team
 └─ Result      win/loss, rewards, rematch / return
```

- New: `AuthGate.jsx`, `Hub.jsx`, `TeamScreen.jsx`, `PackScreen.jsx`, `QuestScreen.jsx`,
  `ResultScreen.jsx`; `api.js` (REST) alongside `socket.js`.
- An auth context holds the session token; every socket emit carries it so the server knows who
  is playing.
- Reuse: `SquadBoard.jsx` (team view), `AnimatedPack.jsx` (pack opening), `Match.jsx` (engine),
  `PenaltyShootout.jsx`.

---

## 8. Security notes

- Move the player pool **server-side**. Today the client hands `players[]` to
  `requestDraftPack`; with owned cards the roster must come from the DB, never the client.
- Server-authoritative: pack opens, quest claims, rewards, match results.
- Rate-limit auth and pack endpoints.

---

## 9. Deployment

- `render.yaml`: add a PostgreSQL service and a one-shot migrate/seed job.
  `CLIENT_ORIGIN` → Vercel URL.
- `VITE_SOCKET_URL` unchanged; add `DATABASE_URL` (Render) and a SQLite path (local dev).
- Vercel frontend + `/health` check unchanged.

---

## 10. Phased roadmap

1. **Phase 1 — Foundation**: username+password accounts, sessions, `users`/`cards`/
   `owned_cards` tables, register/login screens, Home/Team screens, move the player pool
   server-side. Match engine untouched. *(The hard structural step.)*
2. **Phase 2 — Economy**: packs + opening animation, daily claim, quests, coins/gems/XP,
   Result screen, rewards on match finish.
3. **Phase 3 — Gameplay**: six-stat card model + season/tier system, stat-driven OVR
   advantages in the engine, stamina, bench/subs.
4. **Phase 4 — Matchmaking + seasons**: OVR-band queue, weekly seasonal card rotation, streaks.
