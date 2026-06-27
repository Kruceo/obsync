# S3 Sync + Plugins

Plugin para [Obsidian](https://obsidian.md) que sincroniza seu vault via S3/MinIO e mantém seus plugins community sincronizados entre dispositivos.

## Funcionalidades

- **Sync do vault** via S3 ou MinIO self-hosted (estratégia last-write-wins com cópia de conflito)
- **Sync de plugins**: ao abrir o vault em outro dispositivo, detecta plugins faltando e oferece instalá-los automaticamente
- **Sync de configurações** de plugins (`data.json`) opcionalmente

## Instalação rápida

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/Kruceo/obsidian-s3-sync/master/install.sh | bash -s -- ~/Documents/MeuVault
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/Kruceo/obsidian-s3-sync/master/install.ps1 | iex -Args "C:\Users\Você\Documents\MeuVault"
```

O script:
1. Busca a última release no GitHub
2. Baixa `main.js`, `manifest.json` e `styles.css` para `.obsidian/plugins/obsidian-s3-sync/`
3. Habilita o plugin em `community-plugins.json`

Reinicie o Obsidian após a instalação.

## Instalação manual

1. Baixe os arquivos da [última release](https://github.com/Kruceo/obsidian-s3-sync/releases/latest): `main.js`, `manifest.json`, `styles.css`
2. Crie a pasta `.obsidian/plugins/obsidian-s3-sync/` dentro do seu vault
3. Copie os 3 arquivos para essa pasta
4. No Obsidian: **Configurações → Plugins community → Recarregar** e habilite **S3 Sync + Plugins**

## Configuração

Acesse **Configurações → S3 Sync + Plugins** e preencha:

| Campo | Descrição |
|-------|-----------|
| Endpoint | URL do S3 ou MinIO (ex: `http://localhost:9000`) |
| Bucket | Nome do bucket |
| Access Key | Chave de acesso |
| Secret Key | Chave secreta |
| Region | Região (ex: `us-east-1`) |
| Force Path Style | Ativar para MinIO self-hosted |

## MinIO local (desenvolvimento)

Para rodar um MinIO local:

```bash
docker-compose up -d
```

Credenciais padrão: `minioadmin` / `minioadmin` — endpoint: `http://localhost:9000`.

Copie `.env.example` para `.env` se quiser customizar:

```bash
cp .env.example .env
```

## Desenvolvimento

```bash
npm install
npm run dev      # watch mode
npm run build    # build de produção
```

## Release

Para publicar uma nova versão, crie uma tag no formato `X.Y.Z`:

```bash
git tag 1.0.0
git push origin 1.0.0
```

O CI cria a release automaticamente com os artefatos necessários.
