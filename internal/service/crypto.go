package service

import (
	"golang.org/x/crypto/bcrypt"
)

// HashSecret turns a plaintext password or PIN into a secure, non-reversible bcrypt hash string.
func HashSecret(secret string) (string, error) {
	// DefaultCost balances high security with execution speed (uses adaptive rounds)
	bytes, err := bcrypt.GenerateFromPassword([]byte(secret), bcrypt.DefaultCost)
	return string(bytes), err
}

// CheckSecretHash validates if an inputted string matches the secure hash stored on disk.
func CheckSecretHash(secret, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(secret))
	return err == nil
}