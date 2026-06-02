import React, { useEffect, useMemo, useState } from "https://esm.sh/react@18";
import { createRoot } from "https://esm.sh/react-dom@18/client";
import htm from "https://esm.sh/htm@3";

const html = htm.bind(React.createElement);

const API_BASE = "http://localhost:8080";
const TOKEN_KEY = "wallet-session-token";
const USER_KEY = "wallet-user-profile";
const THEME_KEY = "wallet-theme";

const readStoredUser = () => {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
};

const formatDate = (value) => {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "--";
  return date.toLocaleString();
};

const formatAmount = (value) => {
  if (!value) return "0";
  return value;
};

const formatCurrency = (value) => {
  if (!value) return "INR";
  return value.toUpperCase();
};

const formatRupee = (value) => `₹${formatAmount(value)}`;

const isPositiveAmount = (value) => {
  const trimmed = value.trim();
  if (!/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) return false;
  if (/^0+(\.0+)?$/.test(trimmed)) return false;
  return true;
};

const isExactDigits = (value, length) => {
  return new RegExp(`^\\d{${length}}$`).test(value.trim());
};

const isAlphanumericPassword = (value) => {
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9]+$/.test(trimmed)) return false;
  return /[a-zA-Z]/.test(trimmed) && /\d/.test(trimmed);
};

const isValidEmail = (value) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
};

const App = () => {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem(THEME_KEY) || "light";
  });
  const [sessionToken, setSessionToken] = useState(() => {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  });
  const [userProfile, setUserProfile] = useState(() => readStoredUser());
  const [authTab, setAuthTab] = useState("login");
  const [loginStep, setLoginStep] = useState(1);
  const [signupStep, setSignupStep] = useState(1);
  const [isMfaSetupVisible, setIsMfaSetupVisible] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [registerResult, setRegisterResult] = useState(null);
  const [loginUserId, setLoginUserId] = useState("");
  const [toast, setToast] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [statementLoading, setStatementLoading] = useState(false);
  const [balanceError, setBalanceError] = useState("");
  const [statementError, setStatementError] = useState("");
  const [transferError, setTransferError] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);
  const [balanceData, setBalanceData] = useState(null);
  const [statement, setStatement] = useState([]);
  const [balancePinInput, setBalancePinInput] = useState("");
  const [balancePinStashed, setBalancePinStashed] = useState("");
  const [paymentForm, setPaymentForm] = useState({
    destinationUserId: "",
    amount: "",
    paymentPin: "",
  });
  const [signupForm, setSignupForm] = useState({
    fullName: "",
    email: "",
    bankName: "",
    accountNumber: "",
    password: "",
    confirmPassword: "",
    balancePin: "",
    paymentPin: "",
  });
  const [loginForm, setLoginForm] = useState({
    email: "",
    password: "",
    otp: "",
  });

  const isAuthenticated = Boolean(sessionToken);
  const displayName = useMemo(() => {
    const name = userProfile?.full_name || userProfile?.name || "";
    if (!name) return "Customer";
    return name.trim().split(" ")[0] || "Customer";
  }, [userProfile]);

  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!isAuthenticated) return;
    refreshStatement();
  }, [isAuthenticated]);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const storeSession = (token, profile) => {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(profile || {}));
    setSessionToken(token);
    setUserProfile(profile || null);
  };

  const clearSession = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    setSessionToken("");
    setUserProfile(null);
    setBalanceData(null);
    setStatement([]);
    setBalancePinInput("");
    setBalancePinStashed("");
  };

  const parseError = async (response) => {
    try {
      const data = await response.json();
      if (data && data.error) return data.error;
    } catch (error) {
      return "Request failed.";
    }
    return "Request failed.";
  };

  const postJson = async (path, payload, token) => {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : null),
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json();
  };

  const getJson = async (path, token) => {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json();
  };

  const refreshStatement = async () => {
    if (!sessionToken) return;
    setStatementLoading(true);
    setStatementError("");
    try {
      const data = await getJson("/accounts/statement", sessionToken);
      const list = Array.isArray(data) ? data : [];
      setStatement(list.slice(0, 20));
    } catch (error) {
      setStatementError(error.message || "Unable to load statement.");
    } finally {
      setStatementLoading(false);
    }
  };

  const refreshBalance = async (pinValue) => {
    if (!sessionToken) return;
    setBalanceLoading(true);
    setBalanceError("");
    try {
      const data = await postJson(
        "/accounts/balance",
        { balance_pin: pinValue.trim() },
        sessionToken
      );
      setBalanceData(data || null);
      setBalancePinStashed(pinValue.trim());
    } catch (error) {
      setBalanceError(error.message || "Unable to reveal balance.");
      setBalanceData(null);
    } finally {
      setBalanceLoading(false);
    }
  };

  const handleSignup = async (event) => {
    event.preventDefault();
    setAuthError("");
    setRegisterResult(null);
    if (!isValidEmail(signupForm.email)) {
      setAuthError("Enter a valid email address.");
      return;
    }
    if (!isAlphanumericPassword(signupForm.password)) {
      setAuthError("Password must be alphanumeric with letters and numbers.");
      return;
    }
    if (signupForm.password.trim() !== signupForm.confirmPassword.trim()) {
      setAuthError("Password and confirm password must match exactly.");
      return;
    }
    if (!isExactDigits(signupForm.balancePin, 4)) {
      setAuthError("Balance PIN must be exactly 4 digits.");
      return;
    }
    if (!isExactDigits(signupForm.paymentPin, 6)) {
      setAuthError("Payment PIN must be exactly 6 digits.");
      return;
    }
    setAuthLoading(true);
    try {
      const data = await postJson("/auth/register", {
        full_name: signupForm.fullName.trim(),
        email: signupForm.email.trim(),
        bank_name: signupForm.bankName.trim(),
        account_number: signupForm.accountNumber.trim(),
        password: signupForm.password.trim(),
        balance_pin: signupForm.balancePin.trim(),
        payment_pin: signupForm.paymentPin.trim(),
      });
      setRegisterResult({
        secret: data?.mfa_secret || data?.mfa_secret_seed || data?.secret || "",
        mfaQRCode: data?.mfaQRCode || data?.mfa_qr_code || data?.mfa_qr || data?.qrCode || "",
        MFAQRCode: data?.MFAQRCode || "",
      });
      setIsMfaSetupVisible(true);
    } catch (error) {
      setAuthError(error.message || "Unable to register.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLoginStep1 = async (event) => {
    event.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      const data = await postJson("/auth/login/step1", {
        email: loginForm.email.trim(),
        password: loginForm.password.trim(),
      });
      if (data?.status === "MFA_REQUIRED") {
        setLoginStep(2);
        setLoginUserId(data?.user_id || "");
        return;
      }
      if (data?.token) {
        storeSession(data.token, data?.user || null);
      } else {
        setAuthError("Unexpected response from login.");
      }
    } catch (error) {
      setAuthError(error.message || "Unable to login.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLoginStep2 = async (event) => {
    event.preventDefault();
    setAuthError("");
    if (!isExactDigits(loginForm.otp, 6)) {
      setAuthError("Enter the 6-digit authenticator code.");
      return;
    }
    setAuthLoading(true);
    try {
      const data = await postJson("/auth/login/step2", {
        user_id: loginUserId,
        mfa_token: loginForm.otp.trim(),
      });
      if (data?.token) {
        storeSession(data.token, data?.user || null);
        setLoginStep(1);
        setLoginUserId("");
        setLoginForm((prev) => ({ ...prev, otp: "" }));
      } else {
        setAuthError("Login token missing from response.");
      }
    } catch (error) {
      setAuthError(error.message || "Unable to verify MFA.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleBalanceReveal = async (event) => {
    event.preventDefault();
    setBalanceError("");
    if (!isExactDigits(balancePinInput, 4)) {
      setBalanceError("Balance PIN must be exactly 4 digits.");
      return;
    }
    await refreshBalance(balancePinInput);
    setBalancePinInput("");
  };

  const handleTransfer = async (event) => {
    event.preventDefault();
    setTransferError("");
    if (!isPositiveAmount(paymentForm.amount)) {
      setTransferError("Amount must be a positive value.");
      return;
    }
    if (!isExactDigits(paymentForm.paymentPin, 6)) {
      setTransferError("Payment PIN must be exactly 6 digits.");
      return;
    }
    setTransferLoading(true);
    try {
      await postJson(
        "/accounts/transfer",
        {
          destination_user_id: paymentForm.destinationUserId.trim(),
          amount: paymentForm.amount.trim(),
          payment_pin: paymentForm.paymentPin.trim(),
        },
        sessionToken
      );
      showToast("Transfer completed successfully.");
      setPaymentForm({ destinationUserId: "", amount: "", paymentPin: "" });
      await Promise.all([
        refreshStatement(),
        balancePinStashed ? refreshBalance(balancePinStashed) : null,
      ]);
    } catch (error) {
      setTransferError(error.message || "Unable to complete transfer.");
    } finally {
      setTransferLoading(false);
    }
  };

  const statementRows = statement.map((entry, index) => {
    const isCredit = entry?.type === "credit";
    const amountValue = entry?.amount || "0";
    const displayAmount = isCredit
      ? formatRupee(amountValue)
      : `-${formatRupee(amountValue)}`;
    return html`
      <tr key=${entry?.id || `${entry?.transaction_id}-${index}`}>
        <td>${index + 1}</td>
        <td>${formatDate(entry?.date || entry?.created_at || entry?.timestamp)}</td>
        <td class="mono">${entry?.transaction_id || "--"}</td>
        <td>${entry?.account_name || entry?.account || "--"}</td>
        <td>${entry?.type || "--"}</td>
        <td class=${isCredit ? "amount-positive" : "amount-negative"}>
          ${displayAmount}
        </td>
      </tr>
    `;
  });

  if (!isAuthenticated) {
    const isStep1Valid =
      signupForm.fullName.trim().length > 0 && isValidEmail(signupForm.email);
    const isStep2Valid =
      signupForm.bankName.trim().length > 0 &&
      signupForm.accountNumber.trim().length > 0 &&
      signupForm.password.trim().length > 0 &&
      signupForm.confirmPassword.trim().length > 0 &&
      signupForm.password.trim() === signupForm.confirmPassword.trim();
    const isStep3Valid =
      isExactDigits(signupForm.balancePin, 4) &&
      isExactDigits(signupForm.paymentPin, 6);

    return html`
      <div class="app auth-screen">
        ${toast ? html`<div class="toast">${toast}</div>` : null}
        <header class="topbar">
          <div class="brand">
            <p class="eyebrow">Secure Wallet Portal</p>
            <h1>Digital Banking Wallet</h1>
            <p>Multi-factor protected access to your INR accounts.</p>
          </div>
          <button
            type="button"
            class="theme-toggle"
            onClick=${() => setTheme(theme === "light" ? "dark" : "light")}
          >
            ${theme === "light" ? "Dark Mode" : "Light Mode"}
          </button>
        </header>

        <section class="auth-panel">
          <div class="auth-tabs">
            <button
              class=${`tab-button ${authTab === "login" ? "active" : ""}`}
              type="button"
              onClick=${() => {
                setAuthTab("login");
                setAuthError("");
              }}
            >
              Log In
            </button>
            <button
              class=${`tab-button ${authTab === "signup" ? "active" : ""}`}
              type="button"
              onClick=${() => {
                setAuthTab("signup");
                setAuthError("");
              }}
            >
              Sign Up
            </button>
          </div>

          ${authError
            ? html`<div class="error-box">${authError}</div>`
            : null}

          ${authTab === "signup"
            ? isMfaSetupVisible
              ? html`
                  <div class="mfa-card">
                    <h4>MFA Setup</h4>
                    ${registerResult?.secret
                      ? html`<p class="mono">${registerResult.secret}</p>`
                      : null}
                    ${registerResult?.mfaQRCode || registerResult?.MFAQRCode
                      ? html`
                          <div class="qr-wrap">
                            <img
                              src=${`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
                                registerResult?.mfaQRCode || registerResult?.MFAQRCode
                              )}`}
                              alt="MFA QR Code"
                            />
                          </div>
                        `
                      : null}
                    <p class="muted">
                      Scan this QR code with your authenticator app before logging in.
                    </p>
                    <button
                      class="primary-button"
                      type="button"
                      onClick=${() => {
                        setIsMfaSetupVisible(false);
                        setAuthTab("login");
                        setLoginStep(1);
                        setSignupStep(1);
                        setSignupForm({
                          fullName: "",
                          email: "",
                          bankName: "",
                          accountNumber: "",
                          password: "",
                          confirmPassword: "",
                          balancePin: "",
                          paymentPin: "",
                        });
                      }}
                    >
                      I have scanned the QR code. Proceed to Login
                    </button>
                  </div>
                `
              : html`
                  <div class="wizard">
                    <div class="wizard-steps">
                      <span class=${`wizard-pill ${signupStep === 1 ? "active" : ""}`}>
                        1. Personal Info
                      </span>
                      <span class=${`wizard-pill ${signupStep === 2 ? "active" : ""}`}>
                        2. Banking Credentials
                      </span>
                      <span class=${`wizard-pill ${signupStep === 3 ? "active" : ""}`}>
                        3. Security PINs
                      </span>
                    </div>

                    ${signupStep === 1
                      ? html`
                          <form class="form-stack" onSubmit=${(event) => event.preventDefault()}>
                            <div class="form-grid">
                              <label class="field">
                                <span>Full Name</span>
                                <input
                                  value=${signupForm.fullName}
                                  onChange=${(event) =>
                                    setSignupForm((prev) => ({
                                      ...prev,
                                      fullName: event.target.value,
                                    }))}
                                  placeholder="Priya Sharma"
                                  required
                                />
                              </label>
                              <label class="field">
                                <span>Email ID</span>
                                <input
                                  type="email"
                                  value=${signupForm.email}
                                  onChange=${(event) =>
                                    setSignupForm((prev) => ({
                                      ...prev,
                                      email: event.target.value,
                                    }))}
                                  placeholder="priya@bank.com"
                                  required
                                />
                              </label>
                            </div>
                            <p class="muted">
                              Your new account is pre-funded with a ₹10000 test balance.
                            </p>
                            <div class="form-actions">
                              <span class="muted">Step 1 of 3</span>
                              <button
                                class="primary-button"
                                type="button"
                                disabled=${!isStep1Valid}
                                onClick=${() => {
                                  if (!isStep1Valid) {
                                    setAuthError("Enter your name and a valid email.");
                                    return;
                                  }
                                  setAuthError("");
                                  setSignupStep(2);
                                }}
                              >
                                Next
                              </button>
                            </div>
                          </form>
                        `
                      : null}

                    ${signupStep === 2
                      ? html`
                          <form class="form-stack" onSubmit=${(event) => event.preventDefault()}>
                            <div class="form-grid">
                              <label class="field">
                                <span>Bank Name</span>
                                <input
                                  value=${signupForm.bankName}
                                  onChange=${(event) =>
                                    setSignupForm((prev) => ({
                                      ...prev,
                                      bankName: event.target.value,
                                    }))}
                                  placeholder="National Bank"
                                  required
                                />
                              </label>
                              <label class="field">
                                <span>Account Number</span>
                                <input
                                  value=${signupForm.accountNumber}
                                  onChange=${(event) =>
                                    setSignupForm((prev) => ({
                                      ...prev,
                                      accountNumber: event.target.value,
                                    }))}
                                  placeholder="000111222333"
                                  required
                                />
                              </label>
                              <label class="field">
                                <span>Web Banking Password</span>
                                <input
                                  type="password"
                                  value=${signupForm.password}
                                  onChange=${(event) =>
                                    setSignupForm((prev) => ({
                                      ...prev,
                                      password: event.target.value,
                                    }))}
                                  placeholder="Enter password"
                                  required
                                />
                              </label>
                              <label class="field">
                                <span>Confirm Password</span>
                                <input
                                  type="password"
                                  value=${signupForm.confirmPassword}
                                  onChange=${(event) =>
                                    setSignupForm((prev) => ({
                                      ...prev,
                                      confirmPassword: event.target.value,
                                    }))}
                                  placeholder="Re-enter password"
                                  required
                                />
                              </label>
                            </div>
                            <div class="form-actions">
                              <button
                                class="ghost-button"
                                type="button"
                                onClick=${() => setSignupStep(1)}
                              >
                                Back
                              </button>
                              <button
                                class="primary-button"
                                type="button"
                                disabled=${!isStep2Valid}
                                onClick=${() => {
                                  if (!isStep2Valid) {
                                    setAuthError("Password and confirm password must match.");
                                    return;
                                  }
                                  if (!isAlphanumericPassword(signupForm.password)) {
                                    setAuthError(
                                      "Password must be alphanumeric with letters and numbers."
                                    );
                                    return;
                                  }
                                  setAuthError("");
                                  setSignupStep(3);
                                }}
                              >
                                Next
                              </button>
                            </div>
                          </form>
                        `
                      : null}

                    ${signupStep === 3
                      ? html`
                          <form class="form-stack" onSubmit=${handleSignup}>
                            <div class="form-grid">
                              <label class="field">
                                <span>4-digit Security PIN</span>
                                <input
                                  type="password"
                                  inputmode="numeric"
                                  pattern="[0-9]*"
                                  value=${signupForm.balancePin}
                                  onChange=${(event) =>
                                    setSignupForm((prev) => ({
                                      ...prev,
                                      balancePin: event.target.value,
                                    }))}
                                  placeholder="0000"
                                  required
                                />
                              </label>
                              <label class="field">
                                <span>6-digit Payment PIN</span>
                                <input
                                  type="password"
                                  inputmode="numeric"
                                  pattern="[0-9]*"
                                  value=${signupForm.paymentPin}
                                  onChange=${(event) =>
                                    setSignupForm((prev) => ({
                                      ...prev,
                                      paymentPin: event.target.value,
                                    }))}
                                  placeholder="000000"
                                  required
                                />
                              </label>
                            </div>
                            <div class="form-actions">
                              <button
                                class="ghost-button"
                                type="button"
                                onClick=${() => setSignupStep(2)}
                              >
                                Back
                              </button>
                              <button
                                class="primary-button"
                                type="submit"
                                disabled=${authLoading || !isStep3Valid}
                              >
                                Submit Registration
                              </button>
                            </div>
                            <p class="muted">POST /auth/register</p>
                          </form>
                        `
                      : null}
                  </div>
                `
            : html`
                <div class="login-flow">
                  <div class="login-step">
                    <h3>${loginStep === 1 ? "Login Step 1" : "Login Step 2"}</h3>
                    ${loginStep === 1
                      ? html`
                          <form class="form-stack" onSubmit=${handleLoginStep1}>
                            <label class="field">
                              <span>Email ID</span>
                              <input
                                type="email"
                                value=${loginForm.email}
                                onChange=${(event) =>
                                  setLoginForm((prev) => ({
                                    ...prev,
                                    email: event.target.value,
                                  }))}
                                required
                              />
                            </label>
                            <label class="field">
                              <span>Password</span>
                              <input
                                type="password"
                                value=${loginForm.password}
                                onChange=${(event) =>
                                  setLoginForm((prev) => ({
                                    ...prev,
                                    password: event.target.value,
                                  }))}
                                required
                              />
                            </label>
                            <div class="form-actions">
                              <span class="muted">POST /auth/login/step1</span>
                              <button
                                class="primary-button"
                                type="submit"
                                disabled=${authLoading}
                              >
                                Continue
                              </button>
                            </div>
                          </form>
                        `
                      : html`
                          <form class="form-stack" onSubmit=${handleLoginStep2}>
                            <label class="field">
                              <span>6-digit Authenticator Token</span>
                              <input
                                value=${loginForm.otp}
                                onChange=${(event) =>
                                  setLoginForm((prev) => ({
                                    ...prev,
                                    otp: event.target.value,
                                  }))}
                                placeholder="000000"
                                required
                              />
                            </label>
                            <div class="form-actions">
                              <button
                                class="ghost-button"
                                type="button"
                                onClick=${() => setLoginStep(1)}
                              >
                                Back
                              </button>
                              <button
                                class="primary-button"
                                type="submit"
                                disabled=${authLoading}
                              >
                                Verify & Enter
                              </button>
                            </div>
                          </form>
                        `}
                  </div>

                  <div class="mfa-card">
                    <h4>Two-Step Protection</h4>
                    <p>
                      Step 2 requires your rolling 6-digit authenticator token. Keep it ready.
                    </p>
                  </div>
                </div>
              `}
        </section>
      </div>
    `;
  }

  return html`
    <div class="app dashboard">
      ${toast ? html`<div class="toast">${toast}</div>` : null}
      <header class="topbar">
        <div class="brand">
          <p class="eyebrow">Secure Dashboard</p>
          <h1>Digital Banking Wallet</h1>
          <p>Live INR ledger with secured balance and payment controls.</p>
        </div>
        <div class="header-actions">
          <button
            type="button"
            class="theme-toggle"
            onClick=${() => setTheme(theme === "light" ? "dark" : "light")}
          >
            ${theme === "light" ? "Dark Mode" : "Light Mode"}
          </button>
          <button type="button" class="ghost-button" onClick=${clearSession}>
            Log Out
          </button>
        </div>
      </header>

      <section class="greeting">
        <h2>Welcome, ${displayName}</h2>
      </section>

      <section class="dashboard-grid">
        <div class="panel">
          <div class="panel-header">
            <div>
              <h3>Secure Balance Viewer</h3>
              <p class="muted">Currency: ${formatCurrency(balanceData?.currency)}</p>
            </div>
            <button
              type="button"
              class="ghost-button"
              onClick=${() => setBalanceData(null)}
              disabled=${balanceLoading}
            >
              Mask Balance
            </button>
          </div>

          <div class="balance-card">
            ${balanceData
              ? html`
                  <div class="balance-meta">
                    <span class="label">Account Name</span>
                    <strong>${balanceData?.account_name || "--"}</strong>
                  </div>
                  <div class="balance-meta">
                    <span class="label">Balance</span>
                    <strong class="balance-amount">
                      ${formatRupee(balanceData?.balance || "0")}
                    </strong>
                  </div>
                `
              : html`
                  <div class="masked">
                    <div class="mask-line"></div>
                    <div class="mask-line short"></div>
                    <p class="muted">Balance hidden</p>
                  </div>
                `}
          </div>

          <form class="pin-row" onSubmit=${handleBalanceReveal}>
            <label class="field">
              <span>4-digit Balance PIN</span>
              <input
                value=${balancePinInput}
                onChange=${(event) => setBalancePinInput(event.target.value)}
                placeholder="0000"
                required
              />
            </label>
            <button
              type="submit"
              class="primary-button"
              disabled=${balanceLoading}
            >
              View Balance
            </button>
          </form>
          ${balanceError ? html`<div class="error-box">${balanceError}</div>` : null}

            <div class="statement">
            <div class="statement-header">
              <h4>Latest 20 Transactions</h4>
              <span class="muted">GET /accounts/statement</span>
            </div>
              ${statementError
                ? html`<div class="error-box">${statementError}</div>`
                : null}
            <div class="table-card">
              <div class="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Sr.</th>
                      <th>Date</th>
                      <th>Transaction ID</th>
                      <th>Account Name</th>
                      <th>Type</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${statementLoading
                      ? html`
                          <tr>
                            <td colSpan="6">Loading statement...</td>
                          </tr>
                        `
                      : statementRows.length
                      ? statementRows
                      : html`
                          <tr>
                            <td colSpan="6">No statement records found.</td>
                          </tr>
                        `}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div>
              <h3>Make a Payment</h3>
              <p class="muted">POST /accounts/transfer</p>
            </div>
          </div>

          <form class="form-stack" onSubmit=${handleTransfer}>
            <label class="field">
              <span>Destination User UUID</span>
              <input
                value=${paymentForm.destinationUserId}
                onChange=${(event) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    destinationUserId: event.target.value,
                  }))}
                placeholder="User UUID"
                required
              />
            </label>
            <label class="field">
              <span>Amount (INR)</span>
              <input
                value=${paymentForm.amount}
                onChange=${(event) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    amount: event.target.value,
                  }))}
                placeholder="0.00"
                required
              />
            </label>
            <label class="field">
              <span>6-digit Payment PIN</span>
              <input
                value=${paymentForm.paymentPin}
                onChange=${(event) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    paymentPin: event.target.value,
                  }))}
                placeholder="000000"
                required
              />
            </label>
            ${transferError ? html`<div class="error-box">${transferError}</div>` : null}
            <div class="form-actions">
              <span class="muted">Amounts are string-based.</span>
              <button
                class="primary-button"
                type="submit"
                disabled=${transferLoading}
              >
                Send Payment
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  `;
};

const root = createRoot(document.getElementById("root"));
root.render(React.createElement(App));
