package sync

import "github.com/Kruceo/obsidian-s3-sync/server/storage"

// ClientFile represents a local file as reported by the client.
type ClientFile struct {
	Hash       string `json:"hash"`
	ModifiedAt int64  `json:"modifiedAt"` // unix ms — local mtime
}

type ClientManifest map[string]ClientFile

type DiffResult struct {
	Push   []string `json:"push"`   // client should upload these
	Pull   []string `json:"pull"`   // client should download these
	Delete []string `json:"delete"` // client should delete these locally
}

// Diff compares the client manifest against the server state and returns
// what each side needs to do to converge. Conflict resolution: newest wins.
func Diff(client ClientManifest, server storage.Manifest) DiffResult {
	result := DiffResult{
		Push:   []string{},
		Pull:   []string{},
		Delete: []string{},
	}

	for path, entry := range server {
		if entry.Deleted {
			if _, exists := client[path]; exists {
				result.Delete = append(result.Delete, path)
			}
			continue
		}

		clientFile, exists := client[path]
		if !exists {
			result.Pull = append(result.Pull, path)
			continue
		}
		if clientFile.Hash != entry.Hash {
			// Both sides have the file but differ — newest wins.
			if clientFile.ModifiedAt > entry.UpdatedAt {
				result.Push = append(result.Push, path)
			} else {
				result.Pull = append(result.Pull, path)
			}
		}
	}

	// Files the client has that the server doesn't know about → push.
	for path := range client {
		if _, exists := server[path]; !exists {
			result.Push = append(result.Push, path)
		}
	}

	return result
}
