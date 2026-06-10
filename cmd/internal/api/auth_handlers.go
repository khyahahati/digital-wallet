package api

import (
	"log"
	"encoding/json"
	"net/http"

	"digital-wallet/internal/service"

	"github.com/google/uuid"
)

type registerRequest struct {
	FullName      string `json:"full_name"`
	Email         string `json:"email"`
	BankName      string `json:"bank_name"`
	AccountNumber string `json:"account_number"`
	Password      string `json:"password"`
	BalancePin    string `json:"balance_pin"`
	PaymentPin    string `json:"payment_pin"`
}

type loginStep1Request struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginStep2Request struct {
	UserID   string `json:"user_id"`
	MFAToken string `json:"mfa_token"`
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.respondWithError(w, http.StatusBadRequest, "Invalid JSON payload")
		return
	}

	result, err := s.service.RegisterUser(r.Context(), service.RegisterUserRequest{
		FullName:      req.FullName,
		Email:         req.Email,
		BankName:      req.BankName,
		AccountNumber: req.AccountNumber,
		Password:      req.Password,
		BalancePin:    req.BalancePin,
		PaymentPin:    req.PaymentPin,
	})
	if err != nil {
		s.respondWithError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	// Returns the user ID, secret seed, and QR string link to render the Authenticator profile setup automatically
	s.respondWithJSON(w, http.StatusCreated, result)
}

func (s *Server) handleLoginStep1(w http.ResponseWriter, r *http.Request) {
	var req loginStep1Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.respondWithError(w, http.StatusBadRequest, "Invalid JSON payload")
		return
	}

	userID, err := s.service.AuthenticatePassword(r.Context(), service.LoginUserRequest{
		Email:    req.Email,
		Password: req.Password,
	})
	if err != nil {
		s.respondWithError(w, http.StatusUnauthorized, err.Error())
		return
	}

	// Password passed! Instruct frontend to transition to Step 2 MFA token prompt input card
	s.respondWithJSON(w, http.StatusOK, map[string]string{
		"status":  "MFA_REQUIRED",
		"user_id": userID.String(),
	})
}

func (s *Server) handleLoginStep2(w http.ResponseWriter, r *http.Request) {
	var req loginStep2Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.respondWithError(w, http.StatusBadRequest, "Invalid JSON payload")
		return
	}

	parsedUserID, err := uuid.Parse(req.UserID)
	if err != nil {
		log.Printf("[API ERROR] Step 2 Failed Explicitly Due To: %v\n", err)
		s.respondWithError(w, http.StatusBadRequest, "Invalid User ID formatting configuration")
		return
	}

	token, err := s.service.ConfirmMFAAndIssueSession(r.Context(), service.VerifyMFARequest{
		UserID:    parsedUserID,
		MFAToken:  req.MFAToken,
		JWTSecret: s.jwtSecret,
	})
	if err != nil {
		s.respondWithError(w, http.StatusUnauthorized, err.Error())
		return
	}

	// Step 2 Passed! Hand over the secure JWT token back to browser storage
	s.respondWithJSON(w, http.StatusOK, map[string]string{
		"token": token,
	})
}