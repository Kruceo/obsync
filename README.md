# Obsidian Sync

Monorepo com plugin Obsidian + servidor de sync HTTP.

```
plugin/   → plugin Obsidian (TypeScript + esbuild)
server/   → servidor de sync (Go)
```

## Instalação rápida do plugin

**macOS / Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/Kruceo/obsidian-s3-sync/master/plugin/install.sh | bash -s -- ~/Documents/MeuVault
```

**Windows (PowerShell)**
```powershell
irm https://raw.githubusercontent.com/Kruceo/obsidian-s3-sync/master/plugin/install.ps1 | iex -Args "C:\Users\Você\Documents\MeuVault"
```

## Rodar o servidor

```bash
cd server
SYNC_PASSWORD=suasenha JWT_SECRET=segredo go run .
```

Variáveis de ambiente:

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `SYNC_PASSWORD` | obrigatório | Senha de acesso |
| `JWT_SECRET` | gerado aleatório | Secret para assinar tokens JWT |
| `PORT` | `8080` | Porta HTTP |
| `DATA_DIR` | `~/.obsidian-sync` | Onde os arquivos são armazenados |

## Desenvolvimento

```bash
# Plugin
cd plugin && npm install && npm run dev

# Servidor
cd server && go run .
```

## Release

```bash
git tag 1.0.0
git push origin 1.0.0
```

O CI publica automaticamente o plugin (`main.js`, `manifest.json`, `styles.css`) e os binários do servidor para Linux, macOS e Windows.
