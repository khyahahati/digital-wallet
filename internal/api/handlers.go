package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"digital-wallet/internal/db"
	"digital-wallet/internal/service"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Define request structures for JSON parsing
type depositRequest struct {
	AccountID string `json:"account_id"`
	Amount    string `json:"amount"`
}

type withdrawRequest struct {
	AccountID string `json:"account_id"`
	Amount    string `json:"amount"`
}

type transferRequest struct {
	FromAccountID string `json:"from_account_id"`
	ToAccountID   string `json:"to_account_id"`
	Amount        string `json:"amount"`
}

type accountResponse struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Balance   string `json:"balance"`
	Currency  string `json:"currency"`
	IsSystem  bool   `json:"is_system"`
	CreatedAt string `json:"created_at"`
}

type entryResponse struct {
	ID            string `json:"id"`
	AccountID     string `json:"account_id"`
	TransactionID string `json:"transaction_id"`
	OperationType string `json:"operation_type"`
	Amount        string `json:"amount"`
	Description   string `json:"description"`
	CreatedAt     string `json:"created_at"`
}

// handleDeposit manages POST /accounts/deposit
func (s *Server) handleDeposit(w http.ResponseWriter, r *http.Request) {
	var req depositRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.respondWithError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	accID, err := uuid.Parse(req.AccountID)
	if err != nil {
		s.respondWithError(w, http.StatusBadRequest, "Invalid account UUID format")
		return
	}

	if err := s.service.Deposit(r.Context(), accID, req.Amount); err != nil {
		s.handleDomainError(w, err)
		return
	}

	s.respondWithJSON(w, http.StatusOK, map[string]string{"message": "Deposit processed successfully"})
}

// handleWithdraw manages POST /accounts/withdraw
func (s *Server) handleWithdraw(w http.ResponseWriter, r *http.Request) {
	var req withdrawRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.respondWithError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	accID, err := uuid.Parse(req.AccountID)
	if err != nil {
		s.respondWithError(w, http.StatusBadRequest, "Invalid account UUID format")
		return
	}

	if err := s.service.Withdraw(r.Context(), accID, req.Amount); err != nil {
		s.handleDomainError(w, err)
		return
	}

	s.respondWithJSON(w, http.StatusOK, map[string]string{"message": "Withdrawal processed successfully"})
}

// handleTransfer manages POST /accounts/transfer
func (s *Server) handleTransfer(w http.ResponseWriter, r *http.Request) {
	var req transferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.respondWithError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	fromID, err := uuid.Parse(req.FromAccountID)
	toID, err2 := uuid.Parse(req.ToAccountID)
	if err != nil || err2 != nil {
		s.respondWithError(w, http.StatusBadRequest, "Invalid sender or receiver UUID format")
		return
	}

	if err := s.service.Transfer(r.Context(), fromID, toID, req.Amount); err != nil {
		s.handleDomainError(w, err)
		return
	}

	s.respondWithJSON(w, http.StatusOK, map[string]string{"message": "Transfer processed successfully"})
}

// handleListAccounts manages GET /accounts
func (s *Server) handleListAccounts(w http.ResponseWriter, r *http.Request) {
	accounts, err := s.service.ListAccounts(r.Context())
	if err != nil {
		s.respondWithError(w, http.StatusInternalServerError, "Failed to load accounts")
		return
	}

	response := make([]accountResponse, 0, len(accounts))
	for _, account := range accounts {
		response = append(response, accountResponse{
			ID:        pgUUIDToString(account.ID),
			Name:      account.Name,
			Balance:   account.Balance,
			Currency:  account.Currency,
			IsSystem:  account.IsSystem,
			CreatedAt: formatTime(account.CreatedAt),
		})
	}

	s.respondWithJSON(w, http.StatusOK, response)
}

// handleListEntries manages GET /entries
func (s *Server) handleListEntries(w http.ResponseWriter, r *http.Request) {
	entries, err := s.service.ListEntries(r.Context(), 50)
	if err != nil {
		s.respondWithError(w, http.StatusInternalServerError, "Failed to load transaction history")
		return
	}

	response := make([]entryResponse, 0, len(entries))
	for _, entry := range entries {
		description := ""
		if entry.Description.Valid {
			description = entry.Description.String
		}
		response = append(response, entryResponse{
			ID:            pgUUIDToString(entry.ID),
			AccountID:     pgUUIDToString(entry.AccountID),
			TransactionID: pgUUIDToString(entry.TransactionID),
			OperationType: entry.OperationType,
			Amount:        entryAmount(entry),
			Description:   description,
			CreatedAt:     formatTime(entry.CreatedAt),
		})
	}

	s.respondWithJSON(w, http.StatusOK, response)
}

// Helper to translate core business errors to accurate HTTP status codes
func (s *Server) handleDomainError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrInsufficientFunds):
		s.respondWithError(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, service.ErrCurrencyMismatch), errors.Is(err, service.ErrSameAccountTransfer):
		s.respondWithError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, service.ErrNegativeAmount), errors.Is(err, service.ErrInvalidAmount):
		s.respondWithError(w, http.StatusBadRequest, err.Error())
	default:
		s.respondWithError(w, http.StatusInternalServerError, "An internal transaction failure occurred")
	}
}

func pgUUIDToString(id pgtype.UUID) string {
	if !id.Valid {
		return ""
	}
	return uuid.UUID(id.Bytes).String()
}

func formatTime(ts pgtype.Timestamptz) string {
	if !ts.Valid {
		return ""
	}
	return ts.Time.UTC().Format(time.RFC3339)
}

func entryAmount(entry db.Entry) string {
	if !isZeroAmount(entry.Credit) {
		return entry.Credit
	}
	if isZeroAmount(entry.Debit) {
		return "0.0000"
	}
	return "-" + entry.Debit
}

func isZeroAmount(value string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return true
	}
	if strings.HasPrefix(trimmed, "-") {
		trimmed = strings.TrimPrefix(trimmed, "-")
	}
	for _, ch := range trimmed {
		if ch == '.' {
			continue
		}
		if ch != '0' {
			return false
		}
	}
	return true
}