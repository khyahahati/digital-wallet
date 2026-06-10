import React, { useEffect, useMemo, useRef, useState } from "react";
import htm from "htm";

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

const SegmentedPinInput = ({
  length,
  value,
  onChange,
  onComplete,
  autoFocus = false,
  disabled = false,
  name,
}) => {
  const refs = useRef([]);
  const digits = Array.from({ length }, (_, index) => value[index] || "");

  useEffect(() => {
    if (autoFocus && refs.current[0]) {
      refs.current[0].focus();
    }
  }, [autoFocus]);

  const emitChange = (nextDigits) => {
    const nextValue = nextDigits.join("");
    onChange(nextValue);
    if (nextDigits.every((digit) => digit !== "") && nextDigits.length === length) {
      onComplete?.(nextValue);
    }
  };

  const handlePaste = (event) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "");
    if (!pasted) return;
    const nextDigits = Array.from({ length }, (_, index) => pasted[index] || "");
    emitChange(nextDigits);
    const lastIndex = Math.min(pasted.length, length) - 1;
    if (lastIndex >= 0 && refs.current[lastIndex]) {
      refs.current[lastIndex].focus();
    }
  };

  const handleChange = (index, event) => {
    const nextValue = event.target.value.replace(/\D/g, "");
    const nextDigits = [...digits];

    if (nextValue.length > 1) {
      for (let i = 0; i < nextValue.length && index + i < length; i += 1) {
        nextDigits[index + i] = nextValue[i];
      }
      emitChange(nextDigits);
      const nextIndex = Math.min(index + nextValue.length, length - 1);
      refs.current[nextIndex]?.focus();
      return;
    }

    nextDigits[index] = nextValue;
    emitChange(nextDigits);

    if (nextValue && refs.current[index + 1]) {
      refs.current[index + 1].focus();
    }
  };

  const handleKeyDown = (index, event) => {
    if (event.key !== "Backspace") return;
    if (digits[index]) {
      const nextDigits = [...digits];
      nextDigits[index] = "";
      emitChange(nextDigits);
      return;
    }
    if (refs.current[index - 1]) {
      refs.current[index - 1].focus();
    }
  };

  return html`
    <div class="pin-grid" onPaste=${handlePaste}>
      ${digits.map(
        (digit, index) => html`
          <input
            key=${`${name}-${index}`}
            ref=${(node) => {
              refs.current[index] = node;
            }}
            type="password"
            inputMode="numeric"
            pattern="\\d*"
            maxLength="1"
            class="pin-cell"
            value=${digit}
            onChange=${(event) => handleChange(index, event)}
            onKeyDown=${(event) => handleKeyDown(index, event)}
            disabled=${disabled}
            aria-label=${`Digit ${index + 1}`}
          />
        `
      )}
    </div>
  `;
};

const App = () => {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem(THEME_KEY) || "light";
  });
  const [sessionToken, setSessionToken] = useState(() => {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  });
  const [userProfile, setUserProfile] = useState(() => readStoredUser());
  const [showAuthCard, setShowAuthCard] = useState(false);
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
  const [showBalanceValue, setShowBalanceValue] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [activePanel, setActivePanel] = useState(null);
  const [signupPasswordVisible, setSignupPasswordVisible] = useState(false);
  const [signupConfirmVisible, setSignupConfirmVisible] = useState(false);
  const [loginPasswordVisible, setLoginPasswordVisible] = useState(false);
  const [mfaSetupCode, setMfaSetupCode] = useState("");
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

  const resetAuthFlow = () => {
    setAuthTab("login");
    setLoginStep(1);
    setSignupStep(1);
    setLoginUserId("");
    setAuthError("");
    setAuthLoading(false);
    setIsMfaSetupVisible(false);
    setRegisterResult(null);
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
    setLoginForm({ email: "", password: "", otp: "" });
    setMfaSetupCode("");
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
    setActivePanel(null);
    setShowHistory(false);
    setShowBalanceValue(true);
    setShowAuthCard(false);
    resetAuthFlow();
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

  const submitLoginStep2 = async (code) => {
    if (!isExactDigits(code, 6)) {
      setAuthError("Enter the 6-digit authenticator code.");
      return;
    }
    setAuthLoading(true);
    setAuthError("");
    try {
      const data = await postJson("/auth/login/step2", {
        user_id: loginUserId,
        mfa_token: code.trim(),
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

  const handleBalanceReveal = async (overridePin) => {
    setBalanceError("");
    const pinValue = (overridePin ?? balancePinInput).trim();
    if (!isExactDigits(pinValue, 4)) {
      setBalanceError("Balance PIN must be exactly 4 digits.");
      return;
    }
    await refreshBalance(pinValue);
    setBalancePinInput("");
  };

  const handleTransfer = async (event) => {
    event.preventDefault();
    setTransferError("");
    if (!paymentForm.destinationUserId.trim()) {
      setTransferError("Payment ID is required.");
      return;
    }
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
          to_account_id: paymentForm.destinationUserId.trim(),
          amount: paymentForm.amount.trim(),
          payment_pin: paymentForm.paymentPin.trim(),
        },
        sessionToken
      );
      showToast("Transfer completed successfully.");
      setPaymentForm({ destinationUserId: "", amount: "", paymentPin: "" });
      setActivePanel(null);
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
      <div class="history-row" key=${entry?.id || `${entry?.transaction_id}-${index}`}>
        <div>
          <p class="history-title">${entry?.account_name || entry?.account || "Ledger"}</p>
          <p class="history-meta">${formatDate(entry?.date || entry?.created_at || entry?.timestamp)}</p>
        </div>
        <div class=${`history-amount ${isCredit ? "positive" : "negative"}`}>
          ${displayAmount}
        </div>
      </div>
    `;
  });

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

  if (!isAuthenticated) {
    return html`
      <div class="app shell">
        ${toast ? html`<div class="toast">${toast}</div>` : null}
        <header class="topbar">
          <button
            class="icon-button"
            type="button"
            onClick=${() => setTheme(theme === "light" ? "dark" : "light")}
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            ${theme === "light" ? "◐" : "◑"}
          </button>
          <div class="nav-actions">
            <button
              class="primary-button"
              type="button"
              onClick=${() => setShowAuthCard(true)}
            >
              Log In / Sign Up
            </button>
          </div>
        </header>

        <main class="stage">
          <section class=${`hero ${showAuthCard ? "is-hidden" : "is-visible"}`}>
            <h1 class="hero-title gradient-text">Welcome to Digital-Wallet!</h1>
          </section>

          <section class=${`auth-card ${showAuthCard ? "is-visible" : "is-hidden"}`}>
            ${authError ? html`<div class="error-box">${authError}</div>` : null}
            ${authTab === "signup"
              ? isMfaSetupVisible
                ? html`
                    <div class="stack">
                      <h2 class="section-title">Secure MFA Setup</h2>
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
                        Scan the code in your authenticator app, then enter your 6-digit verification code.
                      </p>
                      <${SegmentedPinInput}
                        length=${6}
                        value=${mfaSetupCode}
                        onChange=${setMfaSetupCode}
                        onComplete=${() => {
                          setIsMfaSetupVisible(false);
                          resetAuthFlow();
                          setShowAuthCard(true);
                        }}
                        autoFocus=${true}
                        name="mfa-setup"
                      />
                      <button
                        class="primary-button"
                        type="button"
                        disabled=${!isExactDigits(mfaSetupCode, 6)}
                        onClick=${() => {
                          setIsMfaSetupVisible(false);
                          resetAuthFlow();
                          setShowAuthCard(true);
                        }}
                      >
                        Continue to Login
                      </button>
                    </div>
                  `
                : html`
                    <div class="stack">
                      <h2 class="section-title">Create Secure Wallet</h2>
                      <div class="progress-pill">${signupStep}/3</div>
                      ${signupStep === 1
                        ? html`
                            <form class="form-stack" onSubmit=${(event) => event.preventDefault()}>
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
                                  placeholder="you@bank.com"
                                  required
                                />
                              </label>
                              <button
                                class="primary-button"
                                type="button"
                                disabled=${!isStep1Valid}
                                onClick=${() => setSignupStep(2)}
                              >
                                Next
                              </button>
                            </form>
                          `
                        : null}

                      ${signupStep === 2
                        ? html`
                            <form class="form-stack" onSubmit=${(event) => event.preventDefault()}>
                              <label class="field">
                                <span>Bank Name</span>
                                <input
                                  value=${signupForm.bankName}
                                  onChange=${(event) =>
                                    setSignupForm((prev) => ({
                                      ...prev,
                                      bankName: event.target.value,
                                    }))}
                                  placeholder="Axis Bank"
                                  required
                                />
                              </label>
                              <label class="field">
                                <span>Account ID</span>
                                <input
                                  value=${signupForm.accountNumber}
                                  onChange=${(event) =>
                                    setSignupForm((prev) => ({
                                      ...prev,
                                      accountNumber: event.target.value,
                                    }))}
                                  placeholder="0092910"
                                  required
                                />
                              </label>
                              <label class="field">
                                <span>Web-Banking Password</span>
                                <div class="input-with-icon">
                                  <input
                                    type=${signupPasswordVisible ? "text" : "password"}
                                    value=${signupForm.password}
                                    onChange=${(event) =>
                                      setSignupForm((prev) => ({
                                        ...prev,
                                        password: event.target.value,
                                      }))}
                                    placeholder="Password"
                                    required
                                  />
                                  <button
                                    class="eye-button"
                                    type="button"
                                    onClick=${() =>
                                      setSignupPasswordVisible((prev) => !prev)}
                                    aria-label="Toggle password visibility"
                                  >
                                    ${signupPasswordVisible ? "Hide" : "Show"}
                                  </button>
                                </div>
                              </label>
                              <label class="field">
                                <span>Confirm Password</span>
                                <div class="input-with-icon">
                                  <input
                                    type=${signupConfirmVisible ? "text" : "password"}
                                    value=${signupForm.confirmPassword}
                                    onChange=${(event) =>
                                      setSignupForm((prev) => ({
                                        ...prev,
                                        confirmPassword: event.target.value,
                                      }))}
                                    placeholder="Confirm password"
                                    required
                                  />
                                  <button
                                    class="eye-button"
                                    type="button"
                                    onClick=${() =>
                                      setSignupConfirmVisible((prev) => !prev)}
                                    aria-label="Toggle password visibility"
                                  >
                                    ${signupConfirmVisible ? "Hide" : "Show"}
                                  </button>
                                </div>
                              </label>
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
                                  onClick=${() => setSignupStep(3)}
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
                              <label class="field">
                                <span>Create 4-Digit Balance PIN</span>
                                <${SegmentedPinInput}
                                  length=${4}
                                  value=${signupForm.balancePin}
                                  onChange=${(value) =>
                                    setSignupForm((prev) => ({ ...prev, balancePin: value }))}
                                  name="balance-pin"
                                />
                              </label>
                              <label class="field">
                                <span>Create 6-Digit Payment PIN</span>
                                <${SegmentedPinInput}
                                  length=${6}
                                  value=${signupForm.paymentPin}
                                  onChange=${(value) =>
                                    setSignupForm((prev) => ({ ...prev, paymentPin: value }))}
                                  name="payment-pin"
                                />
                              </label>
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
                                  ${authLoading ? "Creating..." : "Create Secure Wallet"}
                                </button>
                              </div>
                            </form>
                          `
                        : null}
                    </div>
                  `
              : html`
                  <div class="stack">
                    ${loginStep === 1
                      ? html`
                          <h2 class="section-title gradient-text">Welcome back!</h2>
                          <div class="progress-pill">1/2</div>
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
                                placeholder="you@bank.com"
                                required
                              />
                            </label>
                            <label class="field">
                              <span>Web-Banking Password</span>
                              <div class="input-with-icon">
                                <input
                                  type=${loginPasswordVisible ? "text" : "password"}
                                  value=${loginForm.password}
                                  onChange=${(event) =>
                                    setLoginForm((prev) => ({
                                      ...prev,
                                      password: event.target.value,
                                    }))}
                                  placeholder="Password"
                                  required
                                />
                                <button
                                  class="eye-button"
                                  type="button"
                                  onClick=${() => setLoginPasswordVisible((prev) => !prev)}
                                  aria-label="Toggle password visibility"
                                >
                                  ${loginPasswordVisible ? "Hide" : "Show"}
                                </button>
                              </div>
                            </label>
                            <button class="primary-button" type="submit" disabled=${authLoading}>
                              ${authLoading ? "Verifying..." : "Continue"}
                            </button>
                          </form>
                        `
                      : html`
                          <h2 class="section-title">Verification</h2>
                          <div class="progress-pill">2/2</div>
                          <p className="text-muted text-sm my-2">
                             Enter the 6-digit code on your Authenticator app to securely log in to your wallet.
                          </p>
                          <${SegmentedPinInput}
                            length=${6}
                            value=${loginForm.otp}
                            onChange=${(value) =>
                              setLoginForm((prev) => ({ ...prev, otp: value }))}
                            onComplete=${submitLoginStep2}
                            autoFocus=${true}
                            disabled=${authLoading}
                            name="login-otp"
                          />
                          <button
                            class="ghost-button"
                            type="button"
                            onClick=${() => {
                              setLoginStep(1);
                              setLoginForm((prev) => ({ ...prev, otp: "" }));
                              setAuthError("");
                            }}
                          >
                            Back to credentials
                          </button>
                        `}
                  </div>
                `}

            <button
              class="link-button"
              type="button"
              onClick=${() => {
                setAuthTab(authTab === "login" ? "signup" : "login");
                setAuthError("");
                setLoginStep(1);
                setSignupStep(1);
              }}
            >
              ${authTab === "login"
                ? "New here? Create an account"
                : "Already registered? Log in"}
            </button>
          </section>
        </main>
      </div>
    `;
  }

  return html`
    <div class="app shell">
      ${toast ? html`<div class="toast">${toast}</div>` : null}
      <header class="topbar">
        <button
          class="icon-button"
          type="button"
          onClick=${() => setTheme(theme === "light" ? "dark" : "light")}
          aria-label="Toggle theme"
          title="Toggle theme"
        >
          ${theme === "light" ? "◐" : "◑"}
        </button>
        <div class="nav-actions">
          <button
            class="ghost-button"
            type="button"
            onClick=${() => setActivePanel("payment")}
          >
             Make a Payment
          </button>
          <button
            class="ghost-button"
            type="button"
            onClick=${() => setActivePanel("balance")}
          >
             View Balance
          </button>
          <button class="ghost-button" type="button" onClick=${clearSession}>
             Sign Out
          </button>
        </div>
      </header>

      <main class="stage">
        <section class="hero is-visible">
          <h1 class="hero-title gradient-text">Welcome ${displayName}!</h1>
        </section>
      </main>

      ${activePanel
        ? html`
            <div class="overlay" role="dialog" aria-modal="true">
              <div class="overlay-card">
                <div class="overlay-header">
                  <h2 class="section-title">
                    ${activePanel === "balance" ? "View Balance" : "Make a Payment"}
                  </h2>
                  <button
                    class="icon-button"
                    type="button"
                    onClick=${() => setActivePanel(null)}
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>

                ${activePanel === "balance"
                  ? html`
                      <div class="stack">
                        ${balanceData
                          ? null
                          : html`
                              <label class="field">
                                <span>Enter 4-digit Balance PIN</span>
                                <${SegmentedPinInput}
                                  length=${4}
                                  value=${balancePinInput}
                                  onChange=${setBalancePinInput}
                                  onComplete=${handleBalanceReveal}
                                  autoFocus=${true}
                                  disabled=${balanceLoading}
                                  name="balance-reveal"
                                />
                              </label>
                            `}
                        ${balanceError ? html`<div class="error-box">${balanceError}</div>` : null}
                        <div class="balance-display">
                          <div>
                            <p class="label">Balance</p>
                            <p class="balance-amount">
                              ${balanceData
                                ? showBalanceValue
                                  ? `${formatRupee(balanceData?.balance || "0")} ${formatCurrency(
                                      balanceData?.currency
                                    )}`
                                  : "******"
                                : "******"}
                            </p>
                          </div>
                          <button
                            class="ghost-button"
                            type="button"
                            onClick=${() => setShowBalanceValue((prev) => !prev)}
                            disabled=${!balanceData}
                          >
                            ${showBalanceValue ? "Hide Balance" : "Show Balance"}
                          </button>
                        </div>

                        <button
                          class="accordion"
                          type="button"
                          onClick=${() => setShowHistory((prev) => !prev)}
                        >
                          Transaction History
                          <span>${showHistory ? "-" : "+"}</span>
                        </button>
                        ${showHistory
                          ? html`
                              <div class="history-panel">
                                ${statementLoading
                                  ? html`<p class="muted">Loading history...</p>`
                                  : null}
                                ${statementError
                                  ? html`<div class="error-box">${statementError}</div>`
                                  : null}
                                ${statementRows.length
                                  ? statementRows
                                  : html`<p class="muted">No transactions yet.</p>`}
                              </div>
                            `
                          : null}
                      </div>
                    `
                  : html`
                      <form class="form-stack" onSubmit=${handleTransfer}>
                        <label class="field">
                          <span>Payment ID (Recipient UUID)</span>
                          <input
                            value=${paymentForm.destinationUserId}
                            onChange=${(event) =>
                              setPaymentForm((prev) => ({
                                ...prev,
                                destinationUserId: event.target.value,
                              }))}
                            placeholder="Account UUID"
                            required
                          />
                        </label>
                        <label class="field">
                          <span>Amount</span>
                          <input
                            value=${paymentForm.amount}
                            onChange=${(event) =>
                              setPaymentForm((prev) => ({ ...prev, amount: event.target.value }))}
                            placeholder="800"
                            required
                          />
                        </label>
                        <label class="field">
                          <span>6-Digit Payment PIN</span>
                          <${SegmentedPinInput}
                            length=${6}
                            value=${paymentForm.paymentPin}
                            onChange=${(value) =>
                              setPaymentForm((prev) => ({ ...prev, paymentPin: value }))}
                            name="payment-pin-input"
                          />
                        </label>
                        ${transferError ? html`<div class="error-box">${transferError}</div>` : null}
                        <button class="primary-button" type="submit" disabled=${transferLoading}>
                          ${transferLoading ? "Sending..." : "Send Payment"}
                        </button>
                      </form>
                    `}
              </div>
            </div>
          `
        : null}
    </div>
  `;
};

export default App;
