-- name: GetAccount :one
SELECT * FROM accounts
WHERE id = $1 LIMIT 1;

-- name: GetAccountForUpdate :one
SELECT * FROM accounts
WHERE id = $1 LIMIT 1
FOR UPDATE;

-- name: GetSettlementAccountForUpdate :one
SELECT * FROM accounts
WHERE is_system = TRUE AND name = 'Settlement Account'
LIMIT 1
FOR UPDATE;

-- name: UpdateAccountBalance :exec
UPDATE accounts
SET balance = balance + CAST($1 AS NUMERIC(19,4))
WHERE id = $2;

-- name: CreateEntry :one
INSERT INTO entries (
    account_id, debit, credit, transaction_id, operation_type, description
) VALUES (
    $1, CAST($2 AS NUMERIC(19,4)), CAST($3 AS NUMERIC(19,4)), $4, $5, $6
)
RETURNING *;

-- name: GetAccountBalance :one
SELECT CAST(
    (COALESCE(SUM(credit), 0::NUMERIC) - COALESCE(SUM(debit), 0::NUMERIC))
    AS NUMERIC(19,4)) AS calculated_balance
FROM entries
WHERE account_id = $1;