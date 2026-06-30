package sync

import "github.com/Kruceo/obsidian-s3-sync/server/storage"

type ClientManifest map[string]string // path → sha256

type DiffResult struct {
	Push   []string `json:"push"`   // cliente deve enviar esses arquivos
	Pull   []string `json:"pull"`   // cliente deve baixar esses arquivos
	Delete []string `json:"delete"` // cliente deve deletar localmente
}

// Diff compara o manifesto do cliente com o estado atual do servidor.
func Diff(client ClientManifest, server storage.Manifest) DiffResult {
	result := DiffResult{
		Push:   []string{},
		Pull:   []string{},
		Delete: []string{},
	}

	// Arquivos que o servidor tem mas o cliente não enviou → cliente deve baixar ou deletar
	for path, serverHash := range server {
		clientHash, exists := client[path]
		if !exists {
			// Servidor tem, cliente não tem → pull
			result.Pull = append(result.Pull, path)
		} else if clientHash != serverHash {
			// Hashes divergem → servidor é fonte da verdade, cliente baixa
			result.Pull = append(result.Pull, path)
		}
		_ = serverHash
	}

	// Arquivos que o cliente tem mas o servidor não → push
	for path, clientHash := range client {
		if _, exists := server[path]; !exists {
			result.Push = append(result.Push, path)
		}
		_ = clientHash
	}

	return result
}
