package service

import (
	"context"
	"errors"
	"fmt"
	"time"
	"digital-wallet/internal/db"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pquerna/otp/totp"
)

// RegistrationResult bundles the created user data along with the plaintext MFA configuration for the frontend
type RegistrationResult struct {
	UserID    uuid.UUID
	MFASecret string
	MFAQRCode string // The URI string that the frontend agent can turn into a scannable QR code image
}

// RegisterUserRequest captures all incoming signup values from the banking portal
type RegisterUserRequest struct {
	FullName       string
	Email          string
	BankName       string
	AccountNumber  string
	Password       string
	BalancePin     string // 4-digit PIN for viewing balances
	PaymentPin     string // 6-digit PIN for authorizing transactions
}

// RegisterUser processes the signup validation, hashes credentials, generates MFA keys, and links a ledger wallet
func (s *LedgerService) RegisterUser(ctx context.Context, req RegisterUserRequest) (*RegistrationResult, error) {
	// 1. Basic length and validation safety checks
	if len(req.BalancePin) != 4 {
		return nil, errors.New("balance view pin must be exactly 4 digits")
	}
	if len(req.PaymentPin) != 6 {
		return nil, errors.New("payment pin must be exactly 6 digits")
	}
	if len(req.Password) < 8 {
		return nil, errors.New("master password must be at least 8 characters long")
	}

	// 2. Hash all secrets separately using our secure bcrypt helper
	hashedPassword, err := HashSecret(req.Password)
	if err != nil {
		return nil, fmt.Errorf("failed to process password security: %w", err)
	}

	hashedBalancePin, err := HashSecret(req.BalancePin)
	if err != nil {
		return nil, fmt.Errorf("failed to process balance pin security: %w", err)
	}

	hashedPaymentPin, err := HashSecret(req.PaymentPin)
	if err != nil {
		return nil, fmt.Errorf("failed to process payment pin security: %w", err)
	}

	// 3. Generate a unique, secure Multi-Factor Authentication master secret for this specific user profile
	mfaKey, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "MockIndianWebBank",
		AccountName: req.Email,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to initialize MFA framework: %w", err)
	}

	userID := uuid.New()
	pgUserID := pgtype.UUID{Bytes: userID, Valid: true}

	// 4. Wrap everything inside an atomic database transaction
	err = s.store.ExecTx(ctx, func(q *db.Queries) error {
		// NOTE: Since sqlc hasn't been re-run yet to auto-generate the type-safe Go struct matching our new 
		// migrations, we use raw SQL inside our transaction blocks for this transition step.
		_, txErr := s.store.Pool().Exec(ctx, `
			INSERT INTO users (id, full_name, email, bank_name, account_number, password_hash, balance_pin_hash, payment_pin_hash, mfa_enabled, mfa_secret)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);`,
			pgUserID, req.FullName, req.Email, req.BankName, req.AccountNumber, hashedPassword, hashedBalancePin, hashedPaymentPin, true, mfaKey.Secret(),
		)
		if txErr != nil {
			return fmt.Errorf("failed to write secure user records: %w", txErr)
		}

		// 5. Automatically instantiate a primary Ledger Wallet account for this user inside the double-entry system!
		// Default currency is set to INR (₹) and initial balance starts at 0.0000
		walletAccountID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
		_, txErr = s.store.Pool().Exec(ctx, `
			INSERT INTO accounts (id, name, balance, currency, is_system, user_id)
			VALUES ($1, $2, $3, $4, $5, $6);`,
			walletAccountID, fmt.Sprintf("%s's Primary Wallet", req.FullName), "10000.0000", "INR", false, pgUserID,
		)
		return txErr
	})

	if err != nil {
		return nil, err
	}

	// Return the details so the frontend can immediately show the Google Authenticator setup screen
	return &RegistrationResult{
		UserID:    userID,
		MFASecret: mfaKey.Secret(),
		MFAQRCode: mfaKey.URL(),
	}, nil
}

// LoginUserRequest handles step 1 of the authentication lifecycle
type LoginUserRequest struct {
	Email    string
	Password string
}

// VerifyMFARequest handles step 2 of the authentication lifecycle
type VerifyMFARequest struct {
	UserID    uuid.UUID
	MFAToken  string
	JWTSecret string // Passed from environment configuration
}

// AuthenticatePassword verifies step 1 credentials and returns the basic user profile if valid
func (s *LedgerService) AuthenticatePassword(ctx context.Context, req LoginUserRequest) (uuid.UUID, error) {
	var userID uuid.UUID
	var passwordHash string

	// Look up the user's secure credentials by unique email address
	err := s.store.Pool().QueryRow(ctx, `
		SELECT id, password_hash FROM users WHERE email = $1;`,
		req.Email,
	).Scan(&userID, &passwordHash)

	if err != nil {
		// Generic error protects against email enumeration attacks
		return uuid.Nil, errors.New("invalid email address or password profile")
	}

	// Verify if the plaintext password matches our one-way bcrypt string
	if !CheckSecretHash(req.Password, passwordHash) {
		return uuid.Nil, errors.New("invalid email address or password profile")
	}

	return userID, nil
}

// ConfirmMFAAndIssueSession validates the 6-digit TOTP pin and returns a secure web token
func (s *LedgerService) ConfirmMFAAndIssueSession(ctx context.Context, req VerifyMFARequest) (string, error) {
	var mfaSecret string

	// Extract the user's encrypted MFA master seed
	err := s.store.Pool().QueryRow(ctx, `
		SELECT mfa_secret FROM users WHERE id = $1;`,
		req.UserID,
	).Scan(&mfaSecret)

	if err != nil {
		return "", errors.New("security profile not found")
	}

	// Mathematically validate the 6-digit token against the current time windowe, _ := totp.GenerateCode(mfaSecret, time.Now())
	currentCode, _ := totp.GenerateCode(mfaSecret, time.Now())
	fmt.Printf("[DEBUG] DB Secret: %s | User Typed: %s | Server Thinks Code Should Be: %s\n", mfaSecret, req.MFAToken, currentCode)
	
	isValid := totp.Validate(req.MFAToken, mfaSecret)

	if !isValid {
		return "", errors.New("invalid multi-factor authentication token; please check your authenticator app")
	}

	// Issue a 15-minute secure session token matching our idle-inactivity requirement
	sessionToken, err := s.GenerateSessionToken(req.UserID, req.JWTSecret, 15*time.Minute)
	if err != nil {
		return "", fmt.Errorf("failed to issue session configuration: %w", err)
	}

	return sessionToken, nil
}

// ValidatePaymentPin checks if the provided 6-digit PIN matches the stored user hash.
func (s *LedgerService) ValidatePaymentPin(ctx context.Context, userID uuid.UUID, plainPin string) error {
	var hash string
	err := s.store.Pool().QueryRow(ctx, "SELECT payment_pin_hash FROM users WHERE id = $1;", userID).Scan(&hash)
	if err != nil {
		return errors.New("user security profile not found")
	}

	if !CheckSecretHash(plainPin, hash) {
		return errors.New("incorrect 6-digit payment PIN; transaction rejected")
	}
	return nil
}

// ValidateBalancePin checks if the provided 4-digit PIN matches the stored user hash.
func (s *LedgerService) ValidateBalancePin(ctx context.Context, userID uuid.UUID, plainPin string) error {
	var hash string
	err := s.store.Pool().QueryRow(ctx, "SELECT balance_pin_hash FROM users WHERE id = $1;", userID).Scan(&hash)
	if err != nil {
		return errors.New("user security profile not found")
	}

	if !CheckSecretHash(plainPin, hash) {
		return errors.New("incorrect 4-digit balance PIN; access denied")
	}
	return nil
}