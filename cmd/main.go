package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"digital-wallet/internal/api"
	"digital-wallet/internal/db"
	"digital-wallet/internal/service"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

func main() {
	// 1. Load the environment variables from the .env file
	err := godotenv.Load()
	if err != nil {
		log.Println("Warning: No .env file found, relying on system environment variables")
	}

	// 2. Safely read database credentials
	dbUser := os.Getenv("POSTGRES_USER")
	dbPassword := os.Getenv("POSTGRES_PASSWORD")
	dbName := os.Getenv("POSTGRES_DB")
	dbHost := "postgres-db"
	apiPort := os.Getenv("API_PORT")

	// Set sensible defaults if keys are missing from the env file
	if dbUser == "" { dbUser = "postgres" }
	if dbName == "" { dbName = "postgres" }
	if apiPort == "" { apiPort = "8080" }

	// 3. Assemble the connection string
	connStr := fmt.Sprintf("postgresql://%s:%s@%s:5432/%s?sslmode=disable", dbUser, dbPassword, dbHost, dbName)
	ctx := context.Background()

	// 4. Initialize the concurrent pgx connection pool
	log.Println("Connecting to the wallet database pool...")
	pool, err := pgxpool.New(ctx, connStr)
	if err != nil {
		log.Fatalf("Critical Error: Unable to establish database connection pool: %v\n", err)
	}
	defer pool.Close()

	// Quick ping sanity check to verify credentials work right now
	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("Critical Error: Database authentication failed during ping: %v\n", err)
	}
	log.Println("Database connection pool established successfully!")

	// 5. Wire the architecture layers together (Dependency Injection)
	store := db.NewStore(pool)                 // Instantiates query layer + transactions
	ledgerService := service.NewLedgerService(store) // Instantiates domain banking logic
	server := api.NewServer(ledgerService)    // Instantiates HTTP JSON router

	// 6. Launch the live HTTP API engine
	serverAddr := fmt.Sprintf(":%s", apiPort)
	log.Printf("Digital Wallet server starting up smoothly on port %s...\n", apiPort)
	log.Printf("Ready to process transactions at http://localhost:%s\n", apiPort)
	
	if err := server.Start(serverAddr); err != nil {
		log.Fatalf("Critical Error: Web server crashed while listening: %v\n", err)
	}
}