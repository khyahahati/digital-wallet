package service

import (
	"context"
	"fmt"

	"digital-wallet/internal/db"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/shopspring/decimal"
)

// LedgerService orchestrates high-level banking operations using double-entry rules.
type LedgerService struct {
	store *db.Store
}

// NewLedgerService creates a new instance of the ledger manager
func NewLedgerService(store *db.Store) *LedgerService {
	return &LedgerService{store: store}
}

// Deposit moves money from the outside world (Settlement Account) into a user account.
func (s *LedgerService) Deposit(ctx context.Context, accountID uuid.UUID, amountStr string) error {
	amount, err := validatePositiveAmount(amountStr)
	if err != nil {
		return err
	}

	// Convert google/uuid.UUID to pgtype.UUID for sqlc compatibility
	pgAccountID := pgtype.UUID{Bytes: accountID, Valid: true}

	return s.store.ExecTx(ctx, func(q *db.Queries) error {
		// 1. Lock both accounts for update to prevent concurrent read race conditions
		settlement, err := q.GetSettlementAccountForUpdate(ctx)
		if err != nil {
			return fmt.Errorf("settlement account not found: %w", err)
		}

		account, err := q.GetAccountForUpdate(ctx, pgAccountID)
		if err != nil {
			return fmt.Errorf("user account not found: %w", err)
		}

		// 2. Validate currencies match
		if account.Currency != settlement.Currency {
			return ErrCurrencyMismatch
		}

		// Generate transaction ID and parse to pgtype
		txID := uuid.New()
		pgTxID := pgtype.UUID{Bytes: txID, Valid: true}

		// 3. Create entry: Credit user account (money comes in)
		_, err = q.CreateEntry(ctx, db.CreateEntryParams{
			AccountID:     pgAccountID,
			Column2:       decimal.Zero.StringFixed(4), // sqlc numbers fields if not explicitly named in CAST parameters
			Column3:       amount.StringFixed(4),
			TransactionID: pgTxID,
			OperationType: "deposit",
			Description:   pgtype.Text{String: "External deposit", Valid: true},
		})
		if err != nil {
			return fmt.Errorf("failed to create credit entry: %w", err)
		}

		// 4. Create balancing entry: Debit settlement account
		_, err = q.CreateEntry(ctx, db.CreateEntryParams{
			AccountID:     settlement.ID,
			Column2:       amount.StringFixed(4),
			Column3:       decimal.Zero.StringFixed(4),
			TransactionID: pgTxID,
			OperationType: "deposit",
			Description:   pgtype.Text{String: fmt.Sprintf("Deposit to account %s", accountID.String()), Valid: true},
		})
		if err != nil {
			return fmt.Errorf("failed to create debit entry: %w", err)
		}

		// 5. Update cached balances atomically
		err = q.UpdateAccountBalance(ctx, db.UpdateAccountBalanceParams{
			Column1: amount.StringFixed(4),
			ID:      pgAccountID,
		})
		if err != nil {
			return fmt.Errorf("failed to update user balance: %w", err)
		}

		return q.UpdateAccountBalance(ctx, db.UpdateAccountBalanceParams{
			Column1: amount.Neg().StringFixed(4),
			ID:      settlement.ID,
		})
	})
}

// Withdraw moves money out of a user account back to the outside world (Settlement Account).
func (s *LedgerService) Withdraw(ctx context.Context, accountID uuid.UUID, amountStr string) error {
	amount, err := validatePositiveAmount(amountStr)
	if err != nil {
		return err
	}

	pgAccountID := pgtype.UUID{Bytes: accountID, Valid: true}

	return s.store.ExecTx(ctx, func(q *db.Queries) error {
		settlement, err := q.GetSettlementAccountForUpdate(ctx)
		if err != nil {
			return fmt.Errorf("settlement account not found: %w", err)
		}

		account, err := q.GetAccountForUpdate(ctx, pgAccountID)
		if err != nil {
			return fmt.Errorf("user account not found: %w", err)
		}

		if account.Currency != settlement.Currency {
			return ErrCurrencyMismatch
		}

		balanceDec, err := decimal.NewFromString(account.Balance)
		if err != nil {
			return fmt.Errorf("invalid balance format: %w", err)
		}
		if balanceDec.LessThan(amount) {
			return ErrInsufficientFunds
		}

		txID := uuid.New()
		pgTxID := pgtype.UUID{Bytes: txID, Valid: true}

		_, err = q.CreateEntry(ctx, db.CreateEntryParams{
			AccountID:     pgAccountID,
			Column2:       amount.StringFixed(4),
			Column3:       decimal.Zero.StringFixed(4),
			TransactionID: pgTxID,
			OperationType: "withdrawal",
			Description:   pgtype.Text{String: "External withdrawal", Valid: true},
		})
		if err != nil {
			return err
		}

		_, err = q.CreateEntry(ctx, db.CreateEntryParams{
			AccountID:     settlement.ID,
			Column2:       decimal.Zero.StringFixed(4),
			Column3:       amount.StringFixed(4),
			TransactionID: pgTxID,
			OperationType: "withdrawal",
			Description:   pgtype.Text{String: fmt.Sprintf("Withdrawal from account %s", accountID.String()), Valid: true},
		})
		if err != nil {
			return err
		}

		err = q.UpdateAccountBalance(ctx, db.UpdateAccountBalanceParams{
			Column1: amount.Neg().StringFixed(4),
			ID:      pgAccountID,
		})
		if err != nil {
			return err
		}

		return q.UpdateAccountBalance(ctx, db.UpdateAccountBalanceParams{
			Column1: amount.StringFixed(4),
			ID:      settlement.ID,
		})
	})
}

// Transfer moves money directly between two user accounts.
func (s *LedgerService) Transfer(ctx context.Context, fromID, toID uuid.UUID, amountStr string) error {
	amount, err := validatePositiveAmount(amountStr)
	if err != nil {
		return err
	}
	if fromID == toID {
		return ErrSameAccountTransfer
	}

	pgFromID := pgtype.UUID{Bytes: fromID, Valid: true}
	pgToID := pgtype.UUID{Bytes: toID, Valid: true}

	return s.store.ExecTx(ctx, func(q *db.Queries) error {
		fromAcc, err := q.GetAccountForUpdate(ctx, pgFromID)
		if err != nil {
			return fmt.Errorf("sender account not found: %w", err)
		}

		toAcc, err := q.GetAccountForUpdate(ctx, pgToID)
		if err != nil {
			return fmt.Errorf("receiver account not found: %w", err)
		}

		if fromAcc.Currency != toAcc.Currency {
			return ErrCurrencyMismatch
		}

		fromBalance, _ := decimal.NewFromString(fromAcc.Balance)
		if fromBalance.LessThan(amount) {
			return ErrInsufficientFunds
		}

		txID := uuid.New()
		pgTxID := pgtype.UUID{Bytes: txID, Valid: true}

		_, err = q.CreateEntry(ctx, db.CreateEntryParams{
			AccountID:     pgFromID,
			Column2:       amount.StringFixed(4),
			Column3:       decimal.Zero.StringFixed(4),
			TransactionID: pgTxID,
			OperationType: "transfer",
			Description:   pgtype.Text{String: fmt.Sprintf("Transfer to %s", toID.String()), Valid: true},
		})
		if err != nil {
			return err
		}

		_, err = q.CreateEntry(ctx, db.CreateEntryParams{
			AccountID:     pgToID,
			Column2:       decimal.Zero.StringFixed(4),
			Column3:       amount.StringFixed(4),
			TransactionID: pgTxID,
			OperationType: "transfer",
			Description:   pgtype.Text{String: fmt.Sprintf("Transfer from %s", fromID.String()), Valid: true},
		})
		if err != nil {
			return err
		}

		err = q.UpdateAccountBalance(ctx, db.UpdateAccountBalanceParams{
			Column1: amount.Neg().StringFixed(4),
			ID:      pgFromID,
		})
		if err != nil {
			return err
		}

		return q.UpdateAccountBalance(ctx, db.UpdateAccountBalanceParams{
			Column1: amount.StringFixed(4),
			ID:      pgToID,
		})
	})
}

// ListAccounts returns all accounts for the dashboard view.
func (s *LedgerService) ListAccounts(ctx context.Context) ([]db.Account, error) {
	return s.store.ListAccounts(ctx)
}

// ListEntries returns recent ledger entries for the audit log table.
func (s *LedgerService) ListEntries(ctx context.Context, limit int) ([]db.Entry, error) {
	return s.store.ListEntries(ctx, limit)
}

func validatePositiveAmount(amountStr string) (decimal.Decimal, error) {
	amount, err := decimal.NewFromString(amountStr)
	if err != nil {
		return decimal.Zero, ErrInvalidAmount
	}
	if amount.IsNegative() || amount.IsZero() {
		return decimal.Zero, ErrNegativeAmount
	}
	return amount, nil
}

// Store returns the underlying database store wrapper instance
func (s *LedgerService) Store() *db.Store {
	return s.store
}