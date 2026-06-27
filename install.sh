#!/usr/bin/env bash
set -euo pipefail

REPO="Kruceo/obsidian-s3-sync"
PLUGIN_ID="obsidian-s3-sync"
API="https://api.github.com/repos/${REPO}/releases/latest"

# --- helpers ---
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info()  { printf '\033[34m»\033[0m %s\n' "$*"; }

usage() {
  echo "Uso: $0 <caminho-do-vault>"
  echo "Exemplo: $0 ~/Documents/MeuVault"
  exit 1
}

# --- args ---
[[ $# -lt 1 ]] && usage
VAULT="$1"

if [[ ! -d "${VAULT}/.obsidian" ]]; then
  red "Erro: '${VAULT}' não parece ser um vault do Obsidian (pasta .obsidian não encontrada)."
  exit 1
fi

# --- busca versão mais recente ---
info "Buscando última release em github.com/${REPO}..."
if command -v curl &>/dev/null; then
  RELEASE=$(curl -fsSL "${API}")
else
  red "curl não encontrado. Instale curl e tente novamente."
  exit 1
fi

VERSION=$(echo "${RELEASE}" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"

info "Versão encontrada: ${VERSION}"

# --- instala ---
PLUGIN_DIR="${VAULT}/.obsidian/plugins/${PLUGIN_ID}"
mkdir -p "${PLUGIN_DIR}"

info "Baixando arquivos para ${PLUGIN_DIR}..."
for file in main.js manifest.json styles.css; do
  curl -fsSL "${BASE_URL}/${file}" -o "${PLUGIN_DIR}/${file}"
  echo "  ✓ ${file}"
done

# --- habilita o plugin em community-plugins.json ---
COMMUNITY_FILE="${VAULT}/.obsidian/community-plugins.json"
if [[ -f "${COMMUNITY_FILE}" ]]; then
  if ! grep -q "\"${PLUGIN_ID}\"" "${COMMUNITY_FILE}"; then
    # insere o id antes do fechamento do array
    TMP=$(mktemp)
    sed "s/\]$/,\"${PLUGIN_ID}\"]/" "${COMMUNITY_FILE}" > "${TMP}"
    # caso o array esteja vazio []
    if grep -q '\[\]' "${COMMUNITY_FILE}"; then
      sed "s/\[\]/[\"${PLUGIN_ID}\"]/" "${COMMUNITY_FILE}" > "${TMP}"
    fi
    mv "${TMP}" "${COMMUNITY_FILE}"
    info "Plugin habilitado em community-plugins.json"
  fi
else
  echo "[\"${PLUGIN_ID}\"]" > "${COMMUNITY_FILE}"
  info "community-plugins.json criado e plugin habilitado"
fi

echo ""
green "Instalação concluída! Versão ${VERSION} instalada em:"
green "  ${PLUGIN_DIR}"
echo ""
echo "Reinicie o Obsidian e configure o plugin em Configurações → S3 Sync + Plugins."
