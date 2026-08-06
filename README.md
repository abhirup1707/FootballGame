# Footyverse ⚽

A real-time **1v1 online football draft game**. Create or join a private room, take turns drafting a starting XI from a pool of legends, lock your formation, and battle it out live — pass to the three nearest teammates, predict your opponent's passes, and finish moves with a hidden-corner shootout.

## Features

- **Live draft** — 22 turns of 4-player packs across ATT / MID / DEF / GK categories
- **Formation builder** — field your drafted XI and lock it in before kick-off
- **Real-time 1v1 match** — possession-based passing on a live pitch via Socket.IO
- **Pass-and-predict system** — the ball carrier picks one of the three closest teammates; the defender predicts the pass to intercept
- **5 passes = a shot** — complete a move, then attacker and defender secretly pick LEFT / CENTRE / RIGHT (match = save)
- **7-second move timer** — no choice in time? A random option is auto-picked
- **Time & goal-limit modes** — first to N goals, or a timed match (90–180s)
- **Penalty shootout** — sudden-death decider when scores are level
- **Rematch support** — replay against the same opponent
- **Reconnect protection** — players have 60s to rejoin a room before being removed

## Tech stack

- **Frontend:** React 19, Vite, Framer Motion
- **Backend:** Node.js, Express, Socket.IO (rooms and match state live in memory)
- **Deployment:** Vite on Vercel, persistent Node server on Render

## Run locally

```bash
npm install
npm run dev
```

`npm run dev` starts both the Vite dev server and the Socket.IO backend with one command:

- Frontend: http://localhost:5173
- Backend: http://localhost:5000 (health check: `GET /health` → `{"status":"ok"}`)

Open http://localhost:5173 in two browser windows to play against yourself, or share a room link with a friend.

## How to play

1. **Enter the arena** — type a manager name and create a room, or join via a shared match link.
2. **Draft your XI** — take turns choosing unique legends from four-player packs. Fill all 11 slots.
3. **Set your formation** — place each player in their category (ATT / MID / DEF / GK) and press Ready.
4. **Build up play** — the ball carrier picks one of the three nearest teammates. The defender predicts the pass.
5. **Take your shot** — after five clean passes, both players secretly choose a corner. Match the side to save.
6. **Win the match** — first to the goal limit, or most goals when time runs out. Level? Penalty shootout decides it.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run client + server together (concurrently) |
| `npm run client` | Vite dev server only |
| `npm run server` | Socket.IO server only (nodemon) |
| `npm run build` | Production build of the frontend |
| `npm run start` | Start the backend server |

## Project structure

```
├── src/
│   ├── components/     # Lobby, Draft, Formation, Match, PenaltyShootout, etc.
│   ├── socket.js       # Socket.IO client singleton (reads VITE_SOCKET_URL)
│   ├── App.jsx         # App shell / screen routing
│   └── main.jsx        # React entry point
├── server/
│   ├── server.js       # Express + Socket.IO game server (rooms, draft, match logic)
│   └── package.json
├── render.yaml         # Render blueprint for the backend
└── package.json        # Root scripts + frontend deps
```

## Deploy the backend on Render

1. Push the repo to GitHub.
2. In Render, choose **New > Blueprint** and select this repository — it reads `render.yaml`.
3. Set `CLIENT_ORIGIN` to your frontend URL (e.g. `https://football-draft.vercel.app`). Add custom domains as comma-separated values.
4. Deploy, then check `https://<your-render-service>.onrender.com/health` returns `{"status":"ok"}`.

## Connect Vercel to the backend

1. In Vercel, open **Project Settings > Environment Variables**.
2. Add `VITE_SOCKET_URL` with your Render service URL (e.g. `https://football-draft-server.onrender.com`, no trailing slash).
3. Redeploy. `VITE_SOCKET_URL` is embedded at build time, so a redeploy is required for changes to take effect.

## Environment variables

| Variable | Where | Default | Purpose |
| --- | --- | --- | --- |
| `VITE_SOCKET_URL` | Frontend build | `http://localhost:5000` | Socket.IO backend URL |
| `CLIENT_ORIGIN` | Backend | `*` | Allowed CORS origins (comma-separated) |
| `PORT` | Backend | `5000` | Backend listen port |
