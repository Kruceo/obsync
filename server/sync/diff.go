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

	for path, entry := range server {
		if entry.Deleted {
			// servidor deletou → se cliente ainda tem, manda deletar
			if _, exists := client[path]; exists {
				result.Delete = append(result.Delete, path)
			}
			continue
		}

		clientHash, exists := client[path]
		if !exists {
			result.Pull = append(result.Pull, path)
		} else if clientHash != entry.Hash {
			result.Push = append(result.Push, path)
		}
	}

	// arquivos que o cliente tem mas o servidor não conhece → push
	for path := range client {
		if _, exists := server[path]; !exists {
			result.Push = append(result.Push, path)
		}
	}

	return result
}
