package service

import (
	"context"
	"fmt"
	"log"
	"os"
	"sync"
	"testing"

	"digital-wallet/internal/db"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/shopspring/decimal"
)

// init runs automatically before the test suite starts
func init() {
	// Looks for a .env file in your project root folder
	err := godotenv.Load("../../.env")
	if err != nil {
		log.Println("Warning: No .env file found, falling back to system environment variables")
	}
}

func TestLedgerService_ConcurrentTransfers(t *testing.T) {
	ctx := context.Background()

	// Pull variables directly from your .env file dynamically
	dbUser := os.Getenv("POSTGRES_USER")
	dbPassword := os.Getenv("POSTGRES_PASSWORD")
	dbName := os.Getenv("POSTGRES_DB")

	// Fallback safety defaults if your .env keys are named differently
	if dbUser == "" { dbUser = "postgres" }
	if dbName == "" { dbName = "postgres" }

	// Construct the connection string safely using environment variables
	connStr := fmt.Sprintf("postgresql://%s:%s@localhost:5432/%s?sslmode=disable", dbUser, dbPassword, dbName)

	pool, err := pgxpool.New(ctx, connStr)
	if err != nil {
		t.Fatalf("failed to connect to test database: %v", err)
	}
	defer pool.Close()

	store := db.NewStore(pool)
	svc := NewLedgerService(store)

	queries := db.New(pool)
	fromID := uuid.New()
	toID := uuid.New()

	_, err = pool.Exec(ctx, "INSERT INTO accounts (id, name, balance, currency, is_system) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10);",
		pgtype.UUID{Bytes: fromID, Valid: true}, "Sender Alice", "100.0000", "USD", false,
		pgtype.UUID{Bytes: toID, Valid: true}, "Receiver Bob", "100.0000", "USD", false,
	)
	if err != nil {
		t.Fatalf("failed to seed test accounts: %v", err)
	}

	numConcurrent := 5
	amountPerTransfer := "10.0000"

	var wg sync.WaitGroup
	errs := make(chan error, numConcurrent)

	for i := 0; i < numConcurrent; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := svc.Transfer(ctx, fromID, toID, amountPerTransfer)
			if err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)

	for err := range errs {
		if err != nil {
			t.Errorf("concurrent transfer failed: %v", err)
		}
	}

	accFrom, err := queries.GetAccount(ctx, pgtype.UUID{Bytes: fromID, Valid: true})
	if err != nil {
		t.Fatalf("failed to fetch sender: %v", err)
	}

	accTo, err := queries.GetAccount(ctx, pgtype.UUID{Bytes: toID, Valid: true})
	if err != nil {
		t.Fatalf("failed to fetch receiver: %v", err)
	}

	expectedFrom := "50.0000"
	expectedTo := "150.0000"

	balFrom, _ := decimal.NewFromString(accFrom.Balance)
	balTo, _ := decimal.NewFromString(accTo.Balance)

	if !balFrom.Equal(decimal.RequireFromString(expectedFrom)) {
		t.Errorf("Sender balance mismatch! expected %s, got %s", expectedFrom, accFrom.Balance)
	}
	if !balTo.Equal(decimal.RequireFromString(expectedTo)) {
		t.Errorf("Receiver balance mismatch! expected %s, got %s", expectedTo, accTo.Balance)
	}
}