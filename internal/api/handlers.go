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

type secureTransferRequest struct {
	ToAccountID string `json:"to_account_id"`
	Amount      string `json:"amount"`
	PaymentPin  string `json:"payment_pin"` // Your new required 6-digit pin input
}

func (s *Server) handleTransfer(w http.ResponseWriter, r *http.Request) {
	// 1. Extract the securely authenticated UserID from the session middleware context
	authUserID, ok := r.Context().Value("authenticated_user_id").(uuid.UUID)
	if !ok {
		s.respondWithError(w, http.StatusUnauthorized, "User session state unreadable")
		return
	}

	var req secureTransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.respondWithError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	// 2. Client-side protection boundary: Ensure payment pin is structurally 6 digits
	if len(req.PaymentPin) != 6 {
		s.respondWithError(w, http.StatusBadRequest, "Payment authorization PIN must be exactly 6 digits")
		return
	}

	toAccountUUID, err := uuid.Parse(req.ToAccountID)
	if err != nil {
		s.respondWithError(w, http.StatusBadRequest, "Invalid destination account ID formatting")
		return
	}

	// 3. Security Check: Validate the user's 6-digit payment PIN before processing any math
	if err := s.service.ValidatePaymentPin(r.Context(), authUserID, req.PaymentPin); err != nil {
		s.respondWithError(w, http.StatusUnauthorized, err.Error())
		return
	}

	// 4. Resolve the sender's internal ledger account ID using their authenticated UserID
	var fromAccountID uuid.UUID
	err = s.service.Store().Pool().QueryRow(r.Context(), 
		"SELECT id FROM accounts WHERE user_id = $1;", authUserID,
	).Scan(&fromAccountID)
	if err != nil {
		s.respondWithError(w, http.StatusInternalServerError, "Unable to resolve your primary wallet account linkage")
		return
	}

	// 5. Fire off our bulletproof, tested, serializable double-entry ledger transfer engine!
	if err := s.service.Transfer(r.Context(), fromAccountID, toAccountUUID, req.Amount); err != nil {
		s.handleDomainError(w, err)
		return
	}

	s.respondWithJSON(w, http.StatusOK, map[string]string{"message": "Transfer processed successfully in INR"})
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

type balanceCheckRequest struct {
	BalancePin string `json:"balance_pin"` // Your new required 4-digit pin input
}

type statementRow struct {
	Sr            int    `json:"sr"`
	Date          string `json:"date"`
	TransactionID string `json:"transaction_id"`
	AccountName   string `json:"account_name"`
	Amount        string `json:"amount"`
	Type          string `json:"type"` // "credit" or "debit"
}

func (s *Server) handleGetBalance(w http.ResponseWriter, r *http.Request) {
	authUserID, ok := r.Context().Value("authenticated_user_id").(uuid.UUID)
	if !ok {
		s.respondWithError(w, http.StatusUnauthorized, "User session state unreadable")
		return
	}

	var req balanceCheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.respondWithError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	// 1. Enforce 4-digit pin structure validation
	if len(req.BalancePin) != 4 {
		s.respondWithError(w, http.StatusBadRequest, "Balance PIN must be exactly 4 digits")
		return
	}

	// 2. Cryptographically verify the 4-digit PIN
	if err := s.service.ValidateBalancePin(r.Context(), authUserID, req.BalancePin); err != nil {
		s.respondWithError(w, http.StatusUnauthorized, err.Error())
		return
	}

	// 3. Fetch the account information if PIN is correct
	var name, balance, currency string
	err := s.service.Store().Pool().QueryRow(r.Context(),
		"SELECT name, balance, currency FROM accounts WHERE user_id = $1;", authUserID,
	).Scan(&name, &balance, &currency)
	if err != nil {
		s.respondWithError(w, http.StatusInternalServerError, "Account records unreadable")
		return
	}

	s.respondWithJSON(w, http.StatusOK, map[string]string{
		"account_name": name,
		"balance":      balance,
		"currency":     currency,
	})
}

func (s *Server) handleGetStatement(w http.ResponseWriter, r *http.Request) {
	authUserID, ok := r.Context().Value("authenticated_user_id").(uuid.UUID)
	if !ok {
		s.respondWithError(w, http.StatusUnauthorized, "User session state unreadable")
		return
	}

	// 1. Resolve the user's primary wallet ledger account ID
	var accountID uuid.UUID
	err := s.service.Store().Pool().QueryRow(r.Context(),
		"SELECT id FROM accounts WHERE user_id = $1;", authUserID,
	).Scan(&accountID)
	if err != nil {
		s.respondWithError(w, http.StatusInternalServerError, "Account linkage untraceable")
		return
	}

	// 2. Query the exact historical records for this account, sorted by date, capped strictly to the latest 20 rows
	rows, err := s.service.Store().Pool().Query(r.Context(), `
		SELECT e.created_at, e.tx_id, a.name, e.amount
		FROM entries e
		JOIN accounts a ON e.account_id = a.id
		WHERE e.tx_id IN (SELECT tx_id FROM entries WHERE account_id = $1)
		  AND e.account_id != $1
		ORDER BY e.created_at DESC
		LIMIT 20;`,
		accountID,
	)
	if err != nil {
		s.respondWithError(w, http.StatusInternalServerError, "Failed to retrieve transaction statements")
		return
	}
	defer rows.Close()

	statement := []statementRow{}
	sr := 1

	for rows.Next() {
		var createdAt time.Time
		var txID uuid.UUID
		var counterpartyName string
		var rawAmount string

		if err := rows.Scan(&createdAt, &txID, &counterpartyName, &rawAmount); err != nil {
			continue
		}

		// 3. Mathematical type mapping: If amount starts with "-", it's a debit (red), else credit (green)
		txType := "credit"
		if strings.HasPrefix(rawAmount, "-") {
			txType = "debit"
		}

		statement = append(statement, statementRow{
			Sr:            sr,
			Date:          createdAt.Format("02 Jan 2006 15:04"),
			TransactionID: txID.String(),
			AccountName:   counterpartyName,
			Amount:        rawAmount,
			Type:          txType,
		})
		sr++
	}

	s.respondWithJSON(w, http.StatusOK, statement)
}