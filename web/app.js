import React, { useEffect, useState } from "https://esm.sh/react@18";
import { createRoot } from "https://esm.sh/react-dom@18/client";
import htm from "https://esm.sh/htm@3";

const html = htm.bind(React.createElement);

const API_BASE = "http://localhost:8080";

const truncateUUID = (value) => {
  if (!value) return "--";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
};

const isPositiveAmount = (value) => {
  const trimmed = value.trim();
  if (!/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) return false;
  if (/^0+(\.0+)?$/.test(trimmed)) return false;
  return true;
};

const amountClass = (amount) => {
  if (!amount) return "";
  return amount.trim().startsWith("-") ? "amount-negative" : "amount-positive";
};

const formatAmount = (amount) => {
  if (!amount) return "0.0000";
  return amount;
};

const App = () => {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("wallet-theme") || "light";
  });
  const [accounts, setAccounts] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState({ accounts: true, entries: true });
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [formState, setFormState] = useState({
    deposit: { accountId: "", amount: "" },
    withdraw: { accountId: "", amount: "" },
    transfer: { fromAccountId: "", toAccountId: "", amount: "" },
  });
  const [submitting, setSubmitting] = useState({
    deposit: false,
    withdraw: false,
    transfer: false,
  });

  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem("wallet-theme", theme);
  }, [theme]);

  useEffect(() => {
    refreshAll();
  }, []);

  const refreshAll = async () => {
    await Promise.all([refreshAccounts(), refreshEntries()]);
    setLastRefresh(new Date());
  };

  const refreshAccounts = async () => {
    setLoading((prev) => ({ ...prev, accounts: true }));
    try {
      const response = await fetch(`${API_BASE}/accounts`);
      if (!response.ok) throw new Error("Failed to fetch accounts");
      const data = await response.json();
      setAccounts(Array.isArray(data) ? data : []);
    } catch (error) {
      setFormError("Unable to load accounts from the ledger service.");
    } finally {
      setLoading((prev) => ({ ...prev, accounts: false }));
    }
  };

  const refreshEntries = async () => {
    setLoading((prev) => ({ ...prev, entries: true }));
    try {
      const response = await fetch(`${API_BASE}/entries`);
      if (!response.ok) throw new Error("Failed to fetch entries");
      const data = await response.json();
      setEntries(Array.isArray(data) ? data : []);
    } catch (error) {
      setFormError("Unable to load transaction history from the ledger service.");
    } finally {
      setLoading((prev) => ({ ...prev, entries: false }));
    }
  };

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const updateForm = (section, field, value) => {
    setFormState((prev) => ({
      ...prev,
      [section]: { ...prev[section], [field]: value },
    }));
  };

  const submitAction = async (section, path, payload) => {
    setFormError("");
    setSubmitting((prev) => ({ ...prev, [section]: true }));
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let message = "Transaction failed.";
        try {
          const data = await response.json();
          if (data && data.error) message = data.error;
        } catch (error) {
          message = "Transaction failed.";
        }
        setFormError(message);
        return;
      }

      showToast("Transaction confirmed.");
      await refreshAll();
    } catch (error) {
      setFormError("Unable to reach the ledger service.");
    } finally {
      setSubmitting((prev) => ({ ...prev, [section]: false }));
    }
  };

  const handleDeposit = async (event) => {
    event.preventDefault();
    const { accountId, amount } = formState.deposit;
    if (!isPositiveAmount(amount)) {
      setFormError("Deposit amount must be a positive number.");
      return;
    }
    await submitAction("deposit", "/accounts/deposit", {
      account_id: accountId.trim(),
      amount: amount.trim(),
    });
    setFormState((prev) => ({ ...prev, deposit: { accountId: "", amount: "" } }));
  };

  const handleWithdraw = async (event) => {
    event.preventDefault();
    const { accountId, amount } = formState.withdraw;
    if (!isPositiveAmount(amount)) {
      setFormError("Withdrawal amount must be a positive number.");
      return;
    }
    await submitAction("withdraw", "/accounts/withdraw", {
      account_id: accountId.trim(),
      amount: amount.trim(),
    });
    setFormState((prev) => ({ ...prev, withdraw: { accountId: "", amount: "" } }));
  };

  const handleTransfer = async (event) => {
    event.preventDefault();
    const { fromAccountId, toAccountId, amount } = formState.transfer;
    if (fromAccountId.trim() === toAccountId.trim()) {
      setFormError("Transfer accounts must be different.");
      return;
    }
    if (!isPositiveAmount(amount)) {
      setFormError("Transfer amount must be a positive number.");
      return;
    }
    await submitAction("transfer", "/accounts/transfer", {
      from_account_id: fromAccountId.trim(),
      to_account_id: toAccountId.trim(),
      amount: amount.trim(),
    });
    setFormState((prev) => ({
      ...prev,
      transfer: { fromAccountId: "", toAccountId: "", amount: "" },
    }));
  };

  return html`
    <div class="app">
      ${toast ? html`<div class="toast">${toast}</div>` : null}
      <header class="topbar">
        <div class="brand">
          <h1>Digital Banking Wallet</h1>
          <p>
            Real-time ledger operations with precision-safe transfers and a
            complete audit trail.
          </p>
        </div>
        <button
          type="button"
          class="theme-toggle"
          onClick=${() => setTheme(theme === "light" ? "dark" : "light")}
        >
          ${theme === "light" ? "Dark Mode" : "Light Mode"}
        </button>
      </header>

      <section class="hero">
        <div class="hero-card">
          <h3>Active Accounts</h3>
          <p>${accounts.length}</p>
        </div>
        <div class="hero-card">
          <h3>Ledger Status</h3>
          <p>${loading.accounts || loading.entries ? "Syncing" : "Live"}</p>
        </div>
        <div class="hero-card">
          <h3>Last Refresh</h3>
          <p>
            ${lastRefresh
              ? lastRefresh.toLocaleTimeString()
              : "Awaiting sync"}
          </p>
        </div>
      </section>

      <section class="section">
        <h2>Account View Grid</h2>
        <div class="grid">
          ${loading.accounts
            ? html`<div class="account-card">Loading accounts...</div>`
            : accounts.length
            ? accounts.map(
                (account) => html`
                  <div key=${account.id} class="account-card">
                    <div class="account-header">
                      <h3>${account.name || "Unnamed Account"}</h3>
                      ${account.is_system
                        ? html`<span class="badge">System</span>`
                        : html`<span class="badge">User</span>`}
                    </div>
                    <div class="account-id">${truncateUUID(account.id)}</div>
                    <div
                      class=${`balance ${
                        account.balance?.startsWith("-")
                          ? "negative"
                          : "positive"
                      }`}
                    >
                      ${formatAmount(account.balance)} ${account.currency}
                    </div>
                  </div>
                `
              )
            : html`<div class="account-card">No accounts available.</div>`}
        </div>
      </section>

      <section class="section">
        <h2>Action Panels</h2>
        ${formError ? html`<div class="error-box">${formError}</div>` : null}
        <div class="form-grid" style=${{ marginTop: "16px" }}>
          <form class="form-card" onSubmit=${handleDeposit}>
            <h3>Deposit</h3>
            <div class="field">
              <label for="deposit-account">Account ID</label>
              <input
                id="deposit-account"
                value=${formState.deposit.accountId}
                onChange=${(event) =>
                  updateForm("deposit", "accountId", event.target.value)}
                placeholder="UUID"
                required
              />
            </div>
            <div class="field">
              <label for="deposit-amount">Amount</label>
              <input
                id="deposit-amount"
                value=${formState.deposit.amount}
                onChange=${(event) =>
                  updateForm("deposit", "amount", event.target.value)}
                placeholder="0.00"
                required
              />
            </div>
            <div class="form-actions">
              <span class="muted">POST /accounts/deposit</span>
              <button
                class="primary-button"
                type="submit"
                disabled=${submitting.deposit}
              >
                Send
              </button>
            </div>
          </form>

          <form class="form-card" onSubmit=${handleWithdraw}>
            <h3>Withdraw</h3>
            <div class="field">
              <label for="withdraw-account">Account ID</label>
              <input
                id="withdraw-account"
                value=${formState.withdraw.accountId}
                onChange=${(event) =>
                  updateForm("withdraw", "accountId", event.target.value)}
                placeholder="UUID"
                required
              />
            </div>
            <div class="field">
              <label for="withdraw-amount">Amount</label>
              <input
                id="withdraw-amount"
                value=${formState.withdraw.amount}
                onChange=${(event) =>
                  updateForm("withdraw", "amount", event.target.value)}
                placeholder="0.00"
                required
              />
            </div>
            <div class="form-actions">
              <span class="muted">POST /accounts/withdraw</span>
              <button
                class="primary-button"
                type="submit"
                disabled=${submitting.withdraw}
              >
                Send
              </button>
            </div>
          </form>

          <form class="form-card" onSubmit=${handleTransfer}>
            <h3>Transfer</h3>
            <div class="field">
              <label for="transfer-from">From Account ID</label>
              <input
                id="transfer-from"
                value=${formState.transfer.fromAccountId}
                onChange=${(event) =>
                  updateForm("transfer", "fromAccountId", event.target.value)}
                placeholder="UUID"
                required
              />
            </div>
            <div class="field">
              <label for="transfer-to">To Account ID</label>
              <input
                id="transfer-to"
                value=${formState.transfer.toAccountId}
                onChange=${(event) =>
                  updateForm("transfer", "toAccountId", event.target.value)}
                placeholder="UUID"
                required
              />
            </div>
            <div class="field">
              <label for="transfer-amount">Amount</label>
              <input
                id="transfer-amount"
                value=${formState.transfer.amount}
                onChange=${(event) =>
                  updateForm("transfer", "amount", event.target.value)}
                placeholder="0.00"
                required
              />
            </div>
            <div class="form-actions">
              <span class="muted">POST /accounts/transfer</span>
              <button
                class="primary-button"
                type="submit"
                disabled=${submitting.transfer}
              >
                Send
              </button>
            </div>
          </form>
        </div>
      </section>

      <section class="section">
        <h2>Transaction History Statement</h2>
        <div class="table-card">
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Transaction ID</th>
                  <th>Account ID</th>
                  <th>Operation</th>
                  <th>Amount</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                ${loading.entries
                  ? html`
                      <tr>
                        <td colSpan="5">Loading entries...</td>
                      </tr>
                    `
                  : entries.length
                  ? entries.map(
                      (entry) => html`
                        <tr key=${entry.id}>
                          <td>${truncateUUID(entry.transaction_id)}</td>
                          <td>${truncateUUID(entry.account_id)}</td>
                          <td>${entry.operation_type}</td>
                          <td class=${amountClass(entry.amount)}>
                            ${formatAmount(entry.amount)}
                          </td>
                          <td>${entry.description || "--"}</td>
                        </tr>
                      `
                    )
                  : html`
                      <tr>
                        <td colSpan="5">No transactions recorded yet.</td>
                      </tr>
                    `}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  `;
};

const root = createRoot(document.getElementById("root"));
root.render(React.createElement(App));
