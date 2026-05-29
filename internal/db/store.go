package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store provides all functions to execute DB queries and transactions
type Store struct {
	*Queries
	db *pgxpool.Pool
}

// NewStore creates a new Store instance using a pgx connection pool
func NewStore(db *pgxpool.Pool) *Store {
	return &Store{
		Queries: New(db),
		db:      db,
	}
}

// ExecTx executes a function within a strict Serializable database transaction.
// It automatically catches serialization failures (SQLSTATE 40001) and retries them.
func (store *Store) ExecTx(ctx context.Context, fn func(q *Queries) error) error {
	const maxAttempts = 10
	var lastErr error

	for attempt := 0; attempt < maxAttempts; attempt++ {
		lastErr = store.execTxOnce(ctx, fn)
		if lastErr == nil {
			return nil // Transaction succeeded!
		}

		// If it's NOT a concurrency/serialization error, fail immediately (don't retry)
		if !isSerializationError(lastErr) {
			return lastErr
		}

		// If it is a serialization error, wait before trying again (unless it's the last attempt)
		if attempt < maxAttempts-1 {
			if waitErr := sleepWithContext(ctx, retryWait(attempt)); waitErr != nil {
				return waitErr
			}
		}
	}

	return fmt.Errorf("transaction failed after %d attempts due to serialization conflicts: %w", maxAttempts, lastErr)
}

// execTxOnce performs a single transaction attempt
func (store *Store) execTxOnce(ctx context.Context, fn func(q *Queries) error) error {
	// Start transaction with explicit Serializable isolation level
	tx, err := store.db.BeginTx(ctx, pgx.TxOptions{
		IsoLevel: pgx.Serializable,
	})
	if err != nil {
		return err
	}

	// Defer a rollback. If the function returns an error or panics, this safely cancels the tx.
	defer tx.Rollback(ctx)

	// Create a type-safe query runner bound to this specific transaction instance
	q := store.Queries.WithTx(tx)

	// Execute the business logic passed into this transaction block
	if err := fn(q); err != nil {
		return err
	}

	// If no errors occurred, commit the transaction to disk
	return tx.Commit(ctx)
}

// isSerializationError checks if a database error is a serialization failure (SQLSTATE 40001)
func isSerializationError(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "40001"
	}
	return false
}

// retryWait calculates exponential backoff timing: 50ms, 100ms, 200ms... up to 1 second maximum
func retryWait(attempt int) time.Duration {
	base := 50 * time.Millisecond
	for i := 0; i < attempt; i++ {
		base *= 2
		if base >= time.Second {
			return time.Second
		}
	}
	return base
}

// sleepWithContext pauses execution safely while respecting context cancellations (like client disconnects)
func sleepWithContext(ctx context.Context, d time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(d):
		return nil
	}
}

// ListAccounts returns all accounts ordered with system accounts first.
func (store *Store) ListAccounts(ctx context.Context) ([]Account, error) {
	rows, err := store.db.Query(ctx, `
		SELECT id, name, balance, currency, is_system, created_at
		FROM accounts
		ORDER BY is_system DESC, name ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	accounts := []Account{}
	for rows.Next() {
		var account Account
		if err := rows.Scan(
			&account.ID,
			&account.Name,
			&account.Balance,
			&account.Currency,
			&account.IsSystem,
			&account.CreatedAt,
		); err != nil {
			return nil, err
		}
		accounts = append(accounts, account)
	}

	return accounts, rows.Err()
}

// ListEntries returns a descending list of ledger entries for the audit log.
func (store *Store) ListEntries(ctx context.Context, limit int) ([]Entry, error) {
	if limit <= 0 {
		limit = 50
	}

	rows, err := store.db.Query(ctx, `
		SELECT id, account_id, debit, credit, transaction_id, operation_type, description, created_at
		FROM entries
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := []Entry{}
	for rows.Next() {
		var entry Entry
		if err := rows.Scan(
			&entry.ID,
			&entry.AccountID,
			&entry.Debit,
			&entry.Credit,
			&entry.TransactionID,
			&entry.OperationType,
			&entry.Description,
			&entry.CreatedAt,
		); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}

	return entries, rows.Err()
}