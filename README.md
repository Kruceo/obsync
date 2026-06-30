# Obsync

Self-hosted sync plugin for Obsidian. Keeps your vault in sync across devices via a lightweight Go server — no cloud accounts required.

```
plugin/   → Obsidian plugin (TypeScript)
server/   → sync server (Go)
```

## Install the plugin

### Via BRAT (recommended)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from the Obsidian community plugins
2. In BRAT settings, add: `Kruceo/obsync`
3. Enable **Obsync** in Settings → Community plugins

### Manual

**macOS / Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/Kruceo/obsync/master/plugin/install.sh | bash -s -- /path/to/your/vault
```

**Windows (PowerShell)**
```powershell
irm https://raw.githubusercontent.com/Kruceo/obsync/master/plugin/install.ps1 | iex -Args "C:\path\to\your\vault"
```

## Run the server

### Docker (recommended)

```bash
docker run -d \
  --name obsync \
  -e SYNC_PASSWORD=yourpassword \
  -e JWT_SECRET=yoursecret \
  -p 4377:4377 \
  -v obsync_data:/data \
  ghcr.io/kruceo/obsync:latest
```

### docker-compose

```yaml
services:
  obsync:
    image: ghcr.io/kruceo/obsync:latest
    restart: unless-stopped
    ports:
      - "4377:4377"
    environment:
      SYNC_PASSWORD: yourpassword
      JWT_SECRET: yoursecret
    volumes:
      - obsync_data:/data

volumes:
  obsync_data:
```

### From source

```bash
cd server
SYNC_PASSWORD=yourpassword go run .
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SYNC_PASSWORD` | **required** | Password used by the plugin to authenticate |
| `JWT_SECRET` | random (ephemeral) | Secret for signing JWT tokens — set this to persist sessions across restarts |
| `PORT` | `4377` | HTTP port |
| `DATA_DIR` | `~/.obsidian-sync` | Directory where vault files are stored |
| `TRASH_TTL_DAYS` | `30` | How long deleted files are kept before being purged |

## Configure the plugin

In Obsidian → Settings → Obsync:

- **Server URL** — e.g. `http://192.168.1.100:4377`
- **Password** — must match `SYNC_PASSWORD` on the server

The plugin syncs automatically on startup and 20 seconds after any create, modify, rename, or delete event.

## Development

```bash
# Plugin
cd plugin && npm install && npm run dev

# Server
cd server && go run .
```

## Release

```bash
git tag 1.0.0        # plugin release (must match manifest.json version)
git push origin 1.0.0

git tag server-1.0.0  # server release
git push origin server-1.0.0
```

CI publishes plugin artifacts (`main.js`, `manifest.json`, `styles.css`) and server binaries for Linux, macOS, and Windows (amd64 + arm64).
