package auth

import (
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/time/rate"
)

type Config struct {
	Password  string
	JWTSecret []byte
}

type limiterEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

type Service struct {
	cfg      Config
	mu       sync.Mutex
	limiters map[string]*limiterEntry
}

func NewService(cfg Config) *Service {
	s := &Service{
		cfg:      cfg,
		limiters: make(map[string]*limiterEntry),
	}
	go s.cleanupLoop()
	return s
}

func (s *Service) limiterFor(ip string) *rate.Limiter {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.limiters[ip]
	if !ok {
		e = &limiterEntry{limiter: rate.NewLimiter(rate.Every(time.Minute/5), 5)}
		s.limiters[ip] = e
	}
	e.lastSeen = time.Now()
	return e.limiter
}

func (s *Service) cleanupLoop() {
	for range time.Tick(5 * time.Minute) {
		s.mu.Lock()
		for ip, e := range s.limiters {
			if time.Since(e.lastSeen) > 10*time.Minute {
				delete(s.limiters, ip)
			}
		}
		s.mu.Unlock()
	}
}

func (s *Service) Allow(ip string) bool {
	return s.limiterFor(ip).Allow()
}

func (s *Service) ValidatePassword(password string) bool {
	return password == s.cfg.Password
}

func (s *Service) IssueToken() (string, time.Time, error) {
	exp := time.Now().Add(24 * time.Hour)
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(exp),
		IssuedAt:  jwt.NewNumericDate(time.Now()),
	})
	signed, err := token.SignedString(s.cfg.JWTSecret)
	return signed, exp, err
}

func (s *Service) ValidateToken(tokenStr string) error {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return s.cfg.JWTSecret, nil
	})
	if err != nil || !token.Valid {
		return errors.New("invalid token")
	}
	return nil
}

// Middleware valida Bearer token em todas as rotas protegidas.
func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if err := s.ValidateToken(strings.TrimPrefix(header, "Bearer ")); err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
