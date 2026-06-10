package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"digital-wallet/internal/service"
)

// Server coordinates the API router, mounts the core ledger, and carries configuration state
type Server struct {
	router    *http.ServeMux
	service   *service.LedgerService
	jwtSecret string
}

// NewServer builds a new HTTP multiplexer and registers routes
func NewServer(service *service.LedgerService) *Server {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "fallback-insecure-dev-key-change-me"
	}

	s := &Server{
		router:    http.NewServeMux(),
		service:   service,
		jwtSecret: secret,
	}
	s.routes()
	return s
}

// Register the API endpoints explicitly using Go 1.22+ method matching
func (s *Server) routes() {
	// Public Authentication Routes
	s.router.HandleFunc("POST /auth/register", s.handleRegister)
	s.router.HandleFunc("POST /auth/login/step1", s.handleLoginStep1)
	s.router.HandleFunc("POST /auth/login/step2", s.handleLoginStep2)

	// Protected Banking Operations (Wrapped in our secure Session Authenticator)
	s.router.Handle("POST /accounts/transfer", s.requireSession(http.HandlerFunc(s.handleTransfer)))
	s.router.Handle("POST /accounts/balance", s.requireSession(http.HandlerFunc(s.handleGetBalance))) 
	s.router.Handle("GET /accounts/statement", s.requireSession(http.HandlerFunc(s.handleGetStatement))) 	
	
	// Note: The agent's new GET endpoints for balance cards and history will be mounted here as well
}

// requireSession middleware blocks unauthenticated browser access instantly
func (s *Server) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Extract token from standard HTTP Authorization header: "Bearer <TOKEN>"
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			s.respondWithError(w, http.StatusUnauthorized, "Authentication session token required")
			return
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			s.respondWithError(w, http.StatusUnauthorized, "Authorization format must be 'Bearer <token>'")
			return
		}

		// Cryptographically verify the session token
		userID, err := s.service.VerifySessionToken(parts[1], s.jwtSecret)
		if err != nil {
			s.respondWithError(w, http.StatusUnauthorized, err.Error())
			return
		}

		// Inject the verified UserID context into the execution request chain
		ctx := context.WithValue(r.Context(), "authenticated_user_id", userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) enableCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "http://localhost:3000")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) Start(addr string) error {
	corsRouter := s.enableCORS(s.router)
	return http.ListenAndServe(addr, corsRouter)
}

func (s *Server) respondWithJSON(w http.ResponseWriter, code int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(payload)
}

func (s *Server) respondWithError(w http.ResponseWriter, code int, message string) {
	s.respondWithJSON(w, code, map[string]string{"error": message})
}

