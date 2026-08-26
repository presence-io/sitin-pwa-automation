# sitin relay server

A ~150-line, zero-dependency realtime backend for the `relay` adapter: a path-
addressed JSON tree with SSE subscribe and open CORS. Same semantics as Firebase
RTDB, but self-hosted — no GFW throttling, no origin whitelist. Ideal for China
(run it on a domestic VPS).

## Run

```sh
node server.js                 # listens on :8787
# or
docker build -t sitin-relay .
docker run -p 8787:8787 -e RELAY_DATA_FILE=/data/db.json -v $PWD/data:/data sitin-relay
```

Put it behind TLS (Caddy/nginx) so browsers can reach it over `https://`.

### Env

- `PORT` — default `8787`
- `RELAY_DATA_FILE` — optional JSON file for persistence (in-memory otherwise)
- `RELAY_TOKEN` — optional; if set, every request must carry `?token=<value>`

## Point the injection at it

```html
<script src="https://presence-io.github.io/sitin-pwa-automation/autobot.js"
        data-project="your-project"
        data-backend="relay"
        data-backend-config='{"url":"https://relay.example.com"}'></script>
```

(Or set `localStorage.autobot_backend="relay"` and
`localStorage.autobot_backend_config='{"url":"https://relay.example.com"}'` to
switch backends without touching the host page.)

## HTTP API

| Method | Path | Meaning |
|---|---|---|
| GET | `/data/<path>` | value at `<path>` (404 if missing) |
| PUT | `/data/<path>` | set value (JSON body) |
| PATCH | `/data/<path>` | shallow-merge object into value |
| DELETE | `/data/<path>` | remove |
| GET | `/watch/<path>` | SSE; a message on every change at/under/over `<path>` |
| GET | `/health` | `ok` |
