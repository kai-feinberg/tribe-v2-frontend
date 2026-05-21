# TRIBE V2 Brain Viewer

Local frontend for the TRIBE V2 API template. It accepts text input, submits an
async job, polls until completion, downloads `result.json` plus
`preds.norm.f16.bin`, and renders cognitive-domain cards, interpretive proxy
axes, a timeline, and an interactive brain viewer.

## Start Everything Locally

Use two terminals.

One-command path:

```bash
cd /Users/kai/Desktop/projects/explorations/tribe-v2-brain-viewer
pnpm dev-tunnel
```

This opens the SSH tunnel, waits for the API health check, then starts Vite.
Use `/api` as the API base URL in the UI.

Manual two-terminal path:

Terminal 1 keeps the private VPS API tunnel open:

```bash
ssh -N -i ~/.ssh/hetzner_tribev2 -L 8000:localhost:8000 root@204.168.145.117
```

Terminal 2 runs the frontend:

```bash
cd /Users/kai/Desktop/projects/explorations/tribe-v2-brain-viewer
pnpm install
pnpm dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The default API base in
the UI is `/api`, which Vite proxies to `http://127.0.0.1:8000` through the SSH
tunnel.

Quick checks:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:5173/api/metadata
```

## Run The Frontend

```bash
pnpm install
cp .env.example .env
pnpm dev
```

The default API proxy target is `http://127.0.0.1:8000`. Override it with
`VITE_TRIBE_API_TARGET` if needed.

## Start The API On The VPS

```bash
ssh -i ~/.ssh/hetzner_tribev2 root@204.168.145.117
cd /opt/tribev2-api
docker compose up -d
docker compose logs -f api
```

In a second terminal on your Mac, keep a private tunnel open:

```bash
ssh -i ~/.ssh/hetzner_tribev2 -L 8000:localhost:8000 root@204.168.145.117
```

Then the frontend can call `/api`, proxied to `http://127.0.0.1:8000`.

## Notes

- V1 has no bearer auth on the API, but the UI already has a bearer token field
  so the request path will not need to change later.
- Region cards prefer API-provided Destrieux atlas cognitive domains and
  interpretive proxy axes. If an older API response lacks those fields, the UI
  falls back to approximate frontend vertex-band scoring.
- Yeo7 network reductions are not integrated yet. They remain a future API
  output, separate from the Destrieux domains already shown here.
- The interactive brain panel renders from the normalized float16 prediction
  blob. It is a frontend inspection view, not a scientific cortical atlas.
