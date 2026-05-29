package service

import "errors"

var (
	ErrInsufficientFunds   = errors.New("insufficient funds to complete operation")
	ErrCurrencyMismatch    = errors.New("cannot perform transaction between accounts with different currencies")
	ErrSameAccountTransfer = errors.New("cannot transfer money to the same account")
	ErrNegativeAmount      = errors.New("transaction amount must be greater than zero")
	ErrInvalidAmount       = errors.New("invalid amount format")
)