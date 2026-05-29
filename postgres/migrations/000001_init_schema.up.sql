-- 1. Create custom enum for valid financial operations
CREATE TYPE operation_type AS ENUM ('deposit', 'withdrawal', 'transfer');

-- 2. Create Accounts Table
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    balance NUMERIC(19,4) NOT NULL DEFAULT 0.0000,
    currency VARCHAR(3) NOT NULL,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create Entries Ledger Table (The immutable ledger)
CREATE TABLE entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    debit NUMERIC(19,4) NOT NULL DEFAULT 0.0000 CHECK (debit >= 0),
    credit NUMERIC(19,4) NOT NULL DEFAULT 0.0000 CHECK (credit >= 0),
    transaction_id UUID NOT NULL,
    operation_type operation_type NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- CRITICAL GUARDRAIL: An entry can be a debit OR a credit, never both, never neither.
    CONSTRAINT check_single_side CHECK (
        (debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0)
    )
);

-- 4. Indexing for high-performance ledger lookups
CREATE INDEX idx_entries_account_id ON entries(account_id);
CREATE INDEX idx_entries_transaction_id ON entries(transaction_id);

-- 5. Seed the critical Settlement Account (Idempotent)
INSERT INTO accounts (id, name, balance, currency, is_system)
SELECT gen_random_uuid(), 'Settlement Account', 0.0000, 'USD', TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM accounts WHERE is_system = TRUE AND name = 'Settlement Account'
);