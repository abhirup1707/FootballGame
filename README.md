# Football Draft

This app has two deployable parts:

- **Frontend:** React/Vite, hosted on Vercel.
- **Realtime backend:** Express and Socket.IO, which must be hosted on a persistent Node service. Vercel's serverless functions are not suitable for this app's long-lived Socket.IO rooms.

## Run locally

```bash
npm install
npm run dev
```

The frontend runs on Vite and connects to `http://localhost:5000` by default.

## Deploy the backend on Render

1. Push these changes to GitHub.
2. In Render, choose **New > Blueprint** and select this repository. It will read `render.yaml`.
3. Set `CLIENT_ORIGIN` to your Vercel URL, for example `https://football-draft.vercel.app`. Add any custom domain as a comma-separated value too.
4. Deploy and open `https://<your-render-service>.onrender.com/health`; it should return `{"status":"ok"}`.

## Connect Vercel to the backend

1. In Vercel, open **Project Settings > Environment Variables**.
2. Add `VITE_SOCKET_URL` with the Render service URL, for example `https://football-draft-server.onrender.com` (no trailing slash).
3. Apply it to Production (and Preview too if you use preview deployments), then redeploy.

`VITE_SOCKET_URL` is embedded while Vite builds the frontend, so setting it without redeploying will not change the deployed site.
