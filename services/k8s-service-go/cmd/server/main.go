package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/junginho0901/kubeast/services/k8s-service-go/internal/cache"
	"github.com/junginho0901/kubeast/services/k8s-service-go/internal/config"
	"github.com/junginho0901/kubeast/services/k8s-service-go/internal/handler"
	"github.com/junginho0901/kubeast/services/k8s-service-go/internal/k8s"
	"github.com/junginho0901/kubeast/services/k8s-service-go/internal/routes"
	"github.com/junginho0901/kubeast/services/k8s-service-go/internal/ws"
	"github.com/junginho0901/kubeast/services/pkg/audit"
	"github.com/junginho0901/kubeast/services/pkg/auth"
	"github.com/junginho0901/kubeast/services/pkg/logger"
)

func main() {
	// Load configuration
	cfg := config.Load()

	// Setup structured logger
	logger.Setup(cfg.AppName, cfg.Debug)

	slog.Info("starting k8s-service-go", "port", cfg.Port, "debug", cfg.Debug)

	// Init Redis cache
	redisCache := cache.New(cfg.RedisHost, cfg.RedisPort, cfg.RedisDB)

	// Init shared Postgres pool (audit log) with a short timeout so that
	// a misconfigured DB does not block k8s-service start-up indefinitely.
	// On failure we fall back to the slog-backed audit store and continue.
	bootCtx, bootCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer bootCancel()

	var auditStore audit.Writer
	pgPool, pgErr := pgxpool.New(bootCtx, cfg.DatabaseURLForPgx())
	if pgErr == nil {
		pgErr = pgPool.Ping(bootCtx)
	}
	if pgErr != nil {
		slog.Warn("audit: Postgres unavailable, falling back to slog writer", "error", pgErr)
		auditStore = audit.NewSlogStore(audit.ServiceK8s)
	} else {
		defer pgPool.Close()
		store := audit.NewPostgresStore(pgPool, audit.ServiceK8s)
		if err := store.EnsureSchema(bootCtx); err != nil {
			slog.Warn("audit: schema migration failed, falling back to slog writer", "error", err)
			pgPool.Close()
			auditStore = audit.NewSlogStore(audit.ServiceK8s)
		} else {
			auditStore = store
			slog.Info("audit: Postgres writer ready")
		}
	}

	// Init Kubernetes service
	k8sSvc, err := k8s.NewService(cfg.KubeconfigPath, cfg.InCluster, cfg.KubeconfigWatch, redisCache)
	if err != nil {
		slog.Error("failed to initialize k8s service", "err", err)
		os.Exit(1)
	}

	// Start kubeconfig hot-reload watcher (docker mode).
	if cfg.KubeconfigWatch {
		watcherCtx, cancelWatcher := context.WithCancel(context.Background())
		defer cancelWatcher()
		go k8sSvc.WatchKubeconfig(watcherCtx)
	}

	// Init JWT validator
	jwtValidator := auth.NewJWTValidator(auth.JWKSConfig{
		JWKSURL:  cfg.AuthJWKSURL,
		Issuer:   cfg.JWTIssuer,
		Audience: cfg.JWTAudience,
	})

	// Init handler
	h := handler.New(k8sSvc, cfg, auditStore)

	// Init WebSocket multiplexer
	wsMux := ws.NewMultiplexer(k8sSvc)

	// Setup router
	r := chi.NewRouter()

	// Global middleware
	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.RealIP)
	r.Use(chimiddleware.Recoverer)
	// Note: no global timeout middleware - it kills WebSocket connections.
	// Individual handler timeouts are handled via context or http.Server settings.
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.AllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Public routes
	r.Get("/", h.HealthRoot)
	r.Get("/health", h.HealthCheck)

	// Protected API routes — domain-specific registrations live in
	// internal/routes/. main.go retains middleware wiring only so it
	// stays small and stable across feature work.
	r.Group(func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return jwtValidator.MiddlewareWithCookie(cfg.AuthCookieName, next)
		})

		routes.Register(r, h, wsMux)
	})

	// Create HTTP server
	// WriteTimeout=0 to support long-lived WebSocket connections
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0,
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown
	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		slog.Info("server listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	<-done
	slog.Info("shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("server shutdown error", "err", err)
	}

	slog.Info("server stopped")
}
