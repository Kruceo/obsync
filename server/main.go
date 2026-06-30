package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/Kruceo/obsidian-s3-sync/server/api"
	"github.com/Kruceo/obsidian-s3-sync/server/auth"
	"github.com/Kruceo/obsidian-s3-sync/server/storage"
)

func main() {
	password := os.Getenv("SYNC_PASSWORD")
	if password == "" {
		log.Fatal("SYNC_PASSWORD env var is required")
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		// gera um secret aleatório se não foi fornecido (não persiste entre reinícios)
		b := make([]byte, 32)
		rand.Read(b)
		jwtSecret = hex.EncodeToString(b)
		log.Println("JWT_SECRET not set — generated ephemeral secret (tokens will be invalidated on restart)")
	}

	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		home, _ := os.UserHomeDir()
		dataDir = filepath.Join(home, ".obsidian-sync")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	trashTTLDays := 30
	if v := os.Getenv("TRASH_TTL_DAYS"); v != "" {
		if _, err := fmt.Sscanf(v, "%d", &trashTTLDays); err != nil {
			log.Printf("invalid TRASH_TTL_DAYS %q, using default 30", v)
		}
	}

	store, err := storage.New(dataDir, time.Duration(trashTTLDays)*24*time.Hour)
	if err != nil {
		log.Fatalf("storage init: %v", err)
	}

	authSvc := auth.NewService(auth.Config{
		Password:  password,
		JWTSecret: []byte(jwtSecret),
	})

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      api.NewServer(authSvc, store),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Printf("obsidian-sync listening on :%s — data at %s", port, dataDir)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}
