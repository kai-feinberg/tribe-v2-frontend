# TRIBE V2 Brain Viewer

Local frontend for the TRIBE V2 API template. It accepts text input, submits an
async job, polls until completion, downloads `result.json` plus
`preds.norm.f16.bin`, and renders approximate activation regions and a timeline.

## Run The Frontend

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The default API base in
the UI is `/api`, which Vite proxies to `VITE_TRIBE_API_TARGET`.

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
- Region cards use the same approximate vertex-band scoring idea from the
  `script-brain-optimizer` reference. Atlas-backed Yeo7/Destrieux reductions
  should move into the API when that backend output is implemented.
- The interactive brain panel renders from the normalized float16 prediction
  blob. It is a frontend inspection view, not a scientific cortical atlas.
