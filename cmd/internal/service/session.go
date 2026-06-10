package service

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Define core errors for session mapping
var (
	ErrExpiredSession = errors.New("banking session has expired; please log in again")
	ErrInvalidSession = errors.New("invalid session token signature detected")
)

// TokenClaims outlines the structural identity data embedded inside our secure session tokens
type TokenClaims struct {
	UserID uuid.UUID `json:"user_id"`
	jwt.RegisteredClaims
}

// GenerateSessionToken constructs a signed cryptographic token valid for a set inactivity window
func (s *LedgerService) GenerateSessionToken(userID uuid.UUID, secretKey string, duration time.Duration) (string, error) {
	claims := TokenClaims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(duration)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	// Create token using the highly secure HS256 signing algorithm
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	
	// Sign the token with our application's private secret key
	signedToken, err := token.SignedString([]byte(secretKey))
	if err != nil {
		return "", fmt.Errorf("failed to sign secure web session: %w", err)
	}

	return signedToken, nil
}

// VerifySessionToken parses an incoming browser token and extracts the authenticated User ID
func (s *LedgerService) VerifySessionToken(tokenStr string, secretKey string) (uuid.UUID, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &TokenClaims{}, func(token *jwt.Token) (interface{}, error) {
		// Enforce that the signing method matches what we expect
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(secretKey), nil
	})

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return uuid.Nil, ErrExpiredSession
		}
		return uuid.Nil, ErrInvalidSession
	}

	// Extract the verified claims out of the cryptographically validated token wrapper
	if claims, ok := token.Claims.(*TokenClaims); ok && token.Valid {
		return claims.UserID, nil
	}

	return uuid.Nil, ErrInvalidSession
}