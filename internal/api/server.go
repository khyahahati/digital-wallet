package api

import (
	"encoding/json"
	"net/http"

	"digital-wallet/internal/service"
)

// Server coordinates the API router and mounts the core Ledger service
type Server struct {
	router  *http.ServeMux
	service *service.LedgerService
}

// NewServer builds a new HTTP multiplexer and registers routes
func NewServer(service *service.LedgerService) *Server {
	s := &Server{
		router:  http.NewServeMux(),
		service: service,
	}
	s.routes()
	return s
}

// Register the API endpoints explicitly using Go 1.22+ method matching
func (s *Server) routes() {
	s.router.HandleFunc("POST /accounts/deposit", s.handleDeposit)
	s.router.HandleFunc("POST /accounts/withdraw", s.handleWithdraw)
	s.router.HandleFunc("POST /accounts/transfer", s.handleTransfer)
	s.router.HandleFunc("GET /accounts", s.handleListAccounts)
	s.router.HandleFunc("GET /entries", s.handleListEntries)
}

// enableCORS is a middleware that injects the required headers to allow React to communicate with Go
func (s *Server) enableCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Allow requests from your local React dev server
		w.Header().Set("Access-Control-Allow-Origin", "http://localhost:3000")
		// Allow standard REST methods and JSON headers
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		// Handle preflight OPTIONS requests immediately before they hit our actual routes
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		// Pass the request down to the actual endpoint handler
		next.ServeHTTP(w, r)
	})
}

// Start listens and serves on a specified network port address with CORS middleware active
func (s *Server) Start(addr string) error {
	// Wrap our router with the CORS middleware
	corsRouter := s.enableCORS(s.router)
	return http.ListenAndServe(addr, corsRouter)
}

// Helper: Standardized JSON success response utility
func (s *Server) respondWithJSON(w http.ResponseWriter, code int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(payload)
}

// Helper: Standardized JSON error response utility
func (s *Server) respondWithError(w http.ResponseWriter, code int, message string) {
	s.respondWithJSON(w, code, map[string]string{"error": message})
}