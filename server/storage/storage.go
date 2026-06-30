package storage

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Entry struct {
	Hash      string `json:"hash,omitempty"`
	UpdatedAt int64  `json:"updatedAt,omitempty"` // unix ms — when last uploaded
	Deleted   bool   `json:"deleted,omitempty"`
	DeletedAt int64  `json:"deletedAt,omitempty"` // unix ms
}

// Manifest mapeia path → Entry.
type Manifest map[string]Entry

type Store struct {
	root         string
	trashDir     string
	manifestPath string
	trashTTL     time.Duration
	mu           sync.RWMutex
	manifest     Manifest
}

func New(root string, trashTTL time.Duration) (*Store, error) {
	trashDir := filepath.Join(root, "trash")
	for _, dir := range []string{filepath.Join(root, "vault"), trashDir} {
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return nil, err
		}
	}
	s := &Store{
		root:         root,
		trashDir:     trashDir,
		manifestPath: filepath.Join(root, "manifest.json"),
		trashTTL:     trashTTL,
		manifest:     make(Manifest),
	}
	if err := s.loadManifest(); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	go s.cleanupLoop()
	return s, nil
}

func (s *Store) loadManifest() error {
	f, err := os.Open(s.manifestPath)
	if err != nil {
		return err
	}
	defer f.Close()

	// suporta manifesto legado (map[string]string)
	raw := make(map[string]json.RawMessage)
	if err := json.NewDecoder(f).Decode(&raw); err != nil {
		return err
	}
	for path, v := range raw {
		var entry Entry
		// tenta deserializar como Entry
		if err := json.Unmarshal(v, &entry); err != nil {
			// fallback: era string simples (hash)
			var hash string
			if err2 := json.Unmarshal(v, &hash); err2 == nil {
				entry = Entry{Hash: hash}
			}
		}
		s.manifest[path] = entry
	}
	return nil
}

func (s *Store) saveManifest() error {
	tmp := s.manifestPath + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if err := json.NewEncoder(f).Encode(s.manifest); err != nil {
		f.Close()
		return err
	}
	f.Close()
	return os.Rename(tmp, s.manifestPath)
}

// Snapshot retorna cópia do manifesto atual.
func (s *Store) Snapshot() Manifest {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cp := make(Manifest, len(s.manifest))
	for k, v := range s.manifest {
		cp[k] = v
	}
	return cp
}

// Put salva o conteúdo de r em path e atualiza o manifesto.
func (s *Store) Put(path, hash string, r io.Reader) error {
	dest := filepath.Join(s.root, "vault", filepath.FromSlash(path))
	if err := os.MkdirAll(filepath.Dir(dest), 0o750); err != nil {
		return err
	}
	tmp := dest + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		return err
	}
	f.Close()
	if err := os.Rename(tmp, dest); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.manifest[path] = Entry{Hash: hash, UpdatedAt: time.Now().UnixMilli()}
	return s.saveManifest()
}

// Get abre o arquivo para leitura.
func (s *Store) Get(path string) (*os.File, error) {
	return os.Open(filepath.Join(s.root, "vault", filepath.FromSlash(path)))
}

// Delete move o arquivo para a lixeira e marca o manifesto como deleted.
func (s *Store) Delete(path string) error {
	src := filepath.Join(s.root, "vault", filepath.FromSlash(path))

	// move para lixeira com timestamp para evitar colisões
	safePath := strings.ReplaceAll(path, string(os.PathSeparator), "_")
	safePath = strings.ReplaceAll(safePath, "/", "_")
	trashName := fmt.Sprintf("%d-%s", time.Now().UnixMilli(), safePath)
	trashDest := filepath.Join(s.trashDir, trashName)

	if err := os.Rename(src, trashDest); err != nil && !os.IsNotExist(err) {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.manifest[path] = Entry{Deleted: true, DeletedAt: time.Now().UnixMilli()}
	return s.saveManifest()
}

// cleanupLoop apaga entradas da lixeira mais velhas que trashTTL.
func (s *Store) cleanupLoop() {
	for range time.Tick(6 * time.Hour) {
		s.purgeTrash()
	}
}

func (s *Store) purgeTrash() {
	entries, err := os.ReadDir(s.trashDir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-s.trashTTL).UnixMilli()
	for _, e := range entries {
		// nome: <unixMs>-<safepath>
		var ts int64
		fmt.Sscanf(e.Name(), "%d-", &ts)
		if ts > 0 && ts < cutoff {
			path := filepath.Join(s.trashDir, e.Name())
			if err := os.Remove(path); err == nil {
				log.Printf("trash: purged %s", e.Name())
			}
		}
	}

	// remove entradas deleted do manifesto cujo DeletedAt já passou do TTL
	s.mu.Lock()
	defer s.mu.Unlock()
	changed := false
	for path, entry := range s.manifest {
		if entry.Deleted && entry.DeletedAt < cutoff {
			delete(s.manifest, path)
			changed = true
		}
	}
	if changed {
		s.saveManifest()
	}
}
