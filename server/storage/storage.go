package storage

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sync"
)

// Manifest mapeia path → sha256 hex dos arquivos no servidor.
type Manifest map[string]string

type Store struct {
	root         string
	manifestPath string
	mu           sync.RWMutex
	manifest     Manifest
}

func New(root string) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(root, "vault"), 0o750); err != nil {
		return nil, err
	}
	s := &Store{
		root:         root,
		manifestPath: filepath.Join(root, "manifest.json"),
		manifest:     make(Manifest),
	}
	if err := s.loadManifest(); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	return s, nil
}

func (s *Store) loadManifest() error {
	f, err := os.Open(s.manifestPath)
	if err != nil {
		return err
	}
	defer f.Close()
	return json.NewDecoder(f).Decode(&s.manifest)
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

// Put salva o conteúdo de r em path e atualiza o manifesto com o hash fornecido.
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
	s.manifest[path] = hash
	return s.saveManifest()
}

// Get abre o arquivo para leitura.
func (s *Store) Get(path string) (*os.File, error) {
	return os.Open(filepath.Join(s.root, "vault", filepath.FromSlash(path)))
}

// Delete remove o arquivo e o entrada do manifesto.
func (s *Store) Delete(path string) error {
	dest := filepath.Join(s.root, "vault", filepath.FromSlash(path))
	if err := os.Remove(dest); err != nil && !os.IsNotExist(err) {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.manifest, path)
	return s.saveManifest()
}
