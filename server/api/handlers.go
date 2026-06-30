package api

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/Kruceo/obsidian-s3-sync/server/auth"
	syncdiff "github.com/Kruceo/obsidian-s3-sync/server/sync"
	"github.com/Kruceo/obsidian-s3-sync/server/storage"
)

type Server struct {
	auth    *auth.Service
	store   *storage.Store
	mux     *http.ServeMux
}

func NewServer(a *auth.Service, s *storage.Store) *Server {
	srv := &Server{auth: a, store: s, mux: http.NewServeMux()}
	srv.routes()
	return srv
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func (s *Server) routes() {
	protected := s.auth.Middleware(http.HandlerFunc(s.routeProtected))
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("POST /auth/login", s.handleLogin)
	s.mux.Handle("/", protected)
}

func (s *Server) routeProtected(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	switch {
	case r.Method == http.MethodPost && path == "/sync/manifest":
		s.handleManifest(w, r)
	case r.Method == http.MethodPut && strings.HasPrefix(path, "/files/"):
		s.handlePut(w, r)
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/files/"):
		s.handleGet(w, r)
	case r.Method == http.MethodDelete && strings.HasPrefix(path, "/files/"):
		s.handleDelete(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if !s.auth.Allow(ip) {
		http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
		return
	}

	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	if !s.auth.ValidatePassword(body.Password) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	token, exp, err := s.auth.IssueToken()
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"token":      token,
		"expires_at": exp.Format(time.RFC3339),
	})
}

func (s *Server) handleManifest(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Files   syncdiff.ClientManifest `json:"files"`
		Deleted []string                `json:"deleted"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	// processa deletes explícitos antes do diff
	for _, path := range body.Deleted {
		if err := s.store.Delete(path); err != nil {
			http.Error(w, "storage error", http.StatusInternalServerError)
			return
		}
	}

	diff := syncdiff.Diff(body.Files, s.store.Snapshot())

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(diff)
}

func (s *Server) filePath(r *http.Request) string {
	return strings.TrimPrefix(r.URL.Path, "/files/")
}

func (s *Server) handlePut(w http.ResponseWriter, r *http.Request) {
	path := s.filePath(r)
	if path == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}

	hash := r.Header.Get("X-File-Hash")
	if hash == "" {
		http.Error(w, "X-File-Hash header required", http.StatusBadRequest)
		return
	}

	if err := s.store.Put(path, hash, r.Body); err != nil {
		http.Error(w, "storage error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGet(w http.ResponseWriter, r *http.Request) {
	path := s.filePath(r)
	if path == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}

	f, err := s.store.Get(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", "application/octet-stream")
	io.Copy(w, f)
}

func (s *Server) handleDelete(w http.ResponseWriter, r *http.Request) {
	path := s.filePath(r)
	if path == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}

	if err := s.store.Delete(path); err != nil {
		http.Error(w, "storage error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
