CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    bank_name VARCHAR(255) NOT NULL,
    account_number VARCHAR(100) UNIQUE NOT NULL, -- External mock bank account number
    
    -- Cryptographic Security Storage (We store only hashes, never plain text!)
    password_hash VARCHAR(255) NOT NULL,        -- Master portal login password
    balance_pin_hash VARCHAR(255) NOT NULL,     -- 4-digit inner-app balance viewing PIN
    payment_pin_hash VARCHAR(255) NOT NULL,     -- 6-digit transaction movement PIN
    
    -- MFA / TOTP Configuration
    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret VARCHAR(128),                    -- Encrypted seed for Google Authenticator app
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Alter our existing accounts ledger table to connect it directly to an authenticated profile
ALTER TABLE accounts ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;