import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const STORAGE_KEYS = {
  reminders: "lifeAdmin.reminders",
  expenses: "lifeAdmin.expenses",
  appearance: "lifeAdmin.appearance",
  legacyMigrationDone: "lifeAdmin.firebaseMigrationDone",
  lastSync: "lifeAdmin.lastSync",
  pendingOps: "lifeAdmin.firebasePendingOps"
};

const DEFAULT_APPEARANCE = {
  theme: "light",
  accent: "#1f6f5f",
  accentName: "Emerald"
};

const THEME_NAMES = {
  light: "Light",
  dark: "Dark",
  soft: "Soft",
  warm: "Warm",
  system: "System"
};

const state = {
  reminders: load(STORAGE_KEYS.reminders),
  expenses: load(STORAGE_KEYS.expenses),
  appearance: loadAppearance(),
  user: null,
  firebaseApp: null,
  auth: null,
  db: null,
  cloudConfigured: false,
  authMode: "signin",
  deferredInstallPrompt: null,
  realtimeUnsubs: [],
  refreshTimer: null
};

const $ = (id) => document.getElementById(id);

const reminderDialog = $("reminderDialog");
const expenseDialog = $("expenseDialog");
const appearanceDialog = $("appearanceDialog");
const accountDialog = $("accountDialog");
const installDialog = $("installDialog");
const setupDialog = $("setupDialog");
const reminderForm = $("reminderForm");
const expenseForm = $("expenseForm");
const authForm = $("authForm");

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
}

function loadAppearance() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.appearance));
    return { ...DEFAULT_APPEARANCE, ...(saved || {}) };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

function saveLocalData() {
  localStorage.setItem(STORAGE_KEYS.reminders, JSON.stringify(state.reminders));
  localStorage.setItem(STORAGE_KEYS.expenses, JSON.stringify(state.expenses));
}

function saveAppearanceLocal() {
  localStorage.setItem(STORAGE_KEYS.appearance, JSON.stringify(state.appearance));
}

function loadPendingOps() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.pendingOps)) || [];
  } catch {
    return [];
  }
}

function savePendingOps(ops) {
  localStorage.setItem(STORAGE_KEYS.pendingOps, JSON.stringify(ops));
}

function queueCloudOperation(operation) {
  if (!state.user) return;

  const ops = loadPendingOps();
  ops.push({
    ...operation,
    userId: state.user.uid,
    queuedAt: new Date().toISOString()
  });
  savePendingOps(ops);
}

function pendingOperationCount() {
  if (!state.user) return 0;
  return loadPendingOps().filter(op => op.userId === state.user.uid).length;
}

function uid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function money(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: amount % 1 ? 2 : 0
  }).format(amount);
}

function parseDue(item) {
  return new Date(`${item.dueDate}T${item.dueTime || "09:00"}:00`);
}

function daysBetween(from, to) {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86400000);
}

function formatDue(item) {
  const due = parseDue(item);
  const today = new Date();
  const days = daysBetween(today, due);
  const date = due.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
  const time = item.dueTime || "09:00";

  if (days < 0) return `Overdue · ${date} at ${time}`;
  if (days === 0) return `Today at ${time}`;
  if (days === 1) return `Tomorrow at ${time}`;
  return `${date} at ${time} · in ${days} days`;
}

function repeatLabel(value) {
  if (!value || value === "none") return "";
  return value[0].toUpperCase() + value.slice(1);
}

function nextOccurrence(item) {
  const current = parseDue(item);
  const next = new Date(current);

  if (item.repeat === "weekly") next.setDate(next.getDate() + 7);
  if (item.repeat === "monthly") next.setMonth(next.getMonth() + 1);
  if (item.repeat === "yearly") next.setFullYear(next.getFullYear() + 1);

  return {
    ...item,
    id: uid(),
    completed: false,
    completedAt: null,
    dueDate: localDateString(next),
    createdAt: new Date().toISOString()
  };
}

function monthlyEquivalent(expense) {
  const amount = Number(expense.amount || 0);
  if (expense.frequency === "weekly") return amount * 52 / 12;
  if (expense.frequency === "yearly") return amount / 12;
  return amount;
}

function yearlyEquivalent(expense) {
  const amount = Number(expense.amount || 0);
  if (expense.frequency === "weekly") return amount * 52;
  if (expense.frequency === "monthly") return amount * 12;
  return amount;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function capitalize(value = "") {
  return value ? value[0].toUpperCase() + value.slice(1) : "";
}

/* ---------- Appearance ---------- */
function hexToRgb(hex) {
  const cleaned = String(hex).replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return { r: 31, g: 111, b: 95 };
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16)
  };
}

function shadeHex(hex, amount = -0.24) {
  const { r, g, b } = hexToRgb(hex);
  const adjust = (channel) => {
    const target = amount < 0 ? 0 : 255;
    const value = Math.round(channel + (target - channel) * Math.abs(amount));
    return Math.max(0, Math.min(255, value));
  };
  return `#${[adjust(r), adjust(g), adjust(b)]
    .map(v => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

function applyAppearance() {
  const root = document.documentElement;
  const appearance = state.appearance;

  root.dataset.theme = appearance.theme;
  root.style.setProperty("--accent", appearance.accent);
  root.style.setProperty("--accent-dark", shadeHex(appearance.accent, -0.32));

  const { r, g, b } = hexToRgb(appearance.accent);
  root.style.setProperty("--accent-soft", `rgba(${r}, ${g}, ${b}, 0.13)`);

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute("content", appearance.theme === "dark" ? "#111418" : appearance.accent);
  }

  if ($("customAccent")) $("customAccent").value = appearance.accent;
  if ($("currentThemeLabel")) $("currentThemeLabel").textContent = THEME_NAMES[appearance.theme] || "Light";
  if ($("currentAccentLabel")) $("currentAccentLabel").textContent = appearance.accentName || "Custom";

  document.querySelectorAll("[data-theme-choice]").forEach(button => {
    button.classList.toggle("selected", button.dataset.themeChoice === appearance.theme);
  });

  document.querySelectorAll("[data-accent]").forEach(button => {
    button.classList.toggle("selected", button.dataset.accent.toLowerCase() === appearance.accent.toLowerCase());
  });
}

function setTheme(theme) {
  if (!THEME_NAMES[theme]) return;
  state.appearance.theme = theme;
  saveAppearanceLocal();
  applyAppearance();
  syncAppearanceToCloud();
}

function setAccent(accent, name = "Custom") {
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) return;
  state.appearance.accent = accent;
  state.appearance.accentName = name;
  saveAppearanceLocal();
  applyAppearance();
  syncAppearanceToCloud();
}

function resetAppearance() {
  state.appearance = { ...DEFAULT_APPEARANCE };
  saveAppearanceLocal();
  applyAppearance();
  syncAppearanceToCloud();
}

function openAppearanceDialog() {
  applyAppearance();
  appearanceDialog.showModal();
}

/* ---------- Rendering ---------- */
function render() {
  renderReminders();
  renderCompleted();
  renderExpenses();
  renderStats();
  updateNotificationButton();
  updateAccountUI();
}

function renderReminders() {
  const list = $("reminderList");
  const filter = $("filterCategory").value;
  const reminders = state.reminders
    .filter(r => !r.completed)
    .filter(r => filter === "all" || r.category === filter)
    .sort((a, b) => parseDue(a) - parseDue(b));

  if (!reminders.length) {
    list.innerHTML = `<div class="empty-state">No upcoming items here yet.</div>`;
    return;
  }

  list.innerHTML = reminders.map(r => `
    <article class="reminder-card">
      <div class="reminder-main">
        <div class="reminder-title-row">
          <p class="reminder-title">${escapeHtml(r.title)}</p>
          <span class="tag">${escapeHtml(r.category)}</span>
          ${r.priority === "high" ? `<span class="tag high">High priority</span>` : ""}
        </div>
        <p class="reminder-meta">${formatDue(r)}${r.repeat !== "none" ? ` · ${repeatLabel(r.repeat)}` : ""}${r.amount ? ` · ${money(r.amount)}` : ""}</p>
        ${r.notes ? `<p class="reminder-notes">${escapeHtml(r.notes)}</p>` : ""}
      </div>
      <div class="card-actions">
        <button class="action-btn" onclick="completeReminder('${r.id}')">Done</button>
        <button class="action-btn danger" onclick="deleteReminder('${r.id}')">Delete</button>
      </div>
    </article>
  `).join("");
}

function renderCompleted() {
  const list = $("completedList");
  const completed = state.reminders
    .filter(r => r.completed)
    .sort((a,b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0))
    .slice(0, 12);

  if (!completed.length) {
    list.innerHTML = `<div class="empty-state">Completed items will appear here.</div>`;
    return;
  }

  list.innerHTML = completed.map(r => `
    <article class="reminder-card">
      <div class="reminder-main">
        <div class="reminder-title-row">
          <p class="reminder-title">${escapeHtml(r.title)}</p>
          <span class="tag">${escapeHtml(r.category)}</span>
        </div>
        <p class="reminder-meta">Completed${r.completedAt ? ` · ${new Date(r.completedAt).toLocaleDateString("en-ZA")}` : ""}</p>
      </div>
      <div class="card-actions">
        <button class="action-btn" onclick="restoreReminder('${r.id}')">Restore</button>
        <button class="action-btn danger" onclick="deleteReminder('${r.id}')">Delete</button>
      </div>
    </article>
  `).join("");
}

function renderExpenses() {
  const list = $("expenseList");
  const expenses = [...state.expenses].sort((a,b) => new Date(a.nextDate) - new Date(b.nextDate));

  if (!expenses.length) {
    list.innerHTML = `<div class="empty-state">Add subscriptions, debit orders and recurring bills.</div>`;
  } else {
    list.innerHTML = expenses.map(e => `
      <article class="expense-card">
        <div>
          <strong>${escapeHtml(e.name)}</strong>
          <small>${capitalize(e.frequency)} · next ${new Date(e.nextDate + "T00:00:00").toLocaleDateString("en-ZA", {day:"numeric", month:"short"})}</small>
        </div>
        <div class="expense-amount">
          ${money(e.amount)}
          <div><button class="action-btn danger" onclick="deleteExpense('${e.id}')">Delete</button></div>
        </div>
      </article>
    `).join("");
  }

  const monthly = state.expenses.reduce((sum, e) => sum + monthlyEquivalent(e), 0);
  const yearly = state.expenses.reduce((sum, e) => sum + yearlyEquivalent(e), 0);
  $("expenseMonthlyTotal").textContent = money(monthly);
  $("expenseYearlyTotal").textContent = money(yearly);
}

function renderStats() {
  const today = new Date();
  const active = state.reminders.filter(r => !r.completed);

  const dueToday = active.filter(r => daysBetween(today, parseDue(r)) === 0).length;
  const dueSoon = active.filter(r => {
    const days = daysBetween(today, parseDue(r));
    return days >= 0 && days <= 7;
  }).length;

  const monthly = state.expenses.reduce((sum, e) => sum + monthlyEquivalent(e), 0);
  const yearly = state.expenses.reduce((sum, e) => sum + yearlyEquivalent(e), 0);

  $("dueTodayCount").textContent = dueToday;
  $("dueSoonCount").textContent = dueSoon;
  $("monthlyTotal").textContent = money(monthly);
  $("yearlyTotal").textContent = money(yearly);

  if (dueToday > 0) {
    $("todayHeading").textContent = `${dueToday} ${dueToday === 1 ? "thing needs" : "things need"} your attention today.`;
    $("todaySubtext").textContent = "Handle today's items first, then you're free to focus on what comes next.";
  } else if (dueSoon > 0) {
    $("todayHeading").textContent = "Nothing due today.";
    $("todaySubtext").textContent = `${dueSoon} ${dueSoon === 1 ? "item is" : "items are"} coming up in the next 7 days.`;
  } else {
    $("todayHeading").textContent = "You're all caught up.";
    $("todaySubtext").textContent = active.length ? "Your next reminders are safely stored." : "Add a reminder, bill, renewal or subscription to get started.";
  }
}



/* ---------- Firebase configuration ---------- */
function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig &&
    firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.appId &&
    !firebaseConfig.apiKey.includes("YOUR_") &&
    !firebaseConfig.projectId.includes("YOUR_") &&
    !firebaseConfig.appId.includes("YOUR_")
  );
}

function setSyncStatus(mode, text, detail = "") {
  const dot = $("syncDot");
  dot.className = `sync-dot ${mode}`;
  $("syncStatusText").textContent = text;
  $("syncStatusDetail").textContent = detail;

  if (mode === "synced") {
    localStorage.setItem(STORAGE_KEYS.lastSync, new Date().toISOString());
  }

  updateAccountUI();
}

function formatLastSync() {
  const value = localStorage.getItem(STORAGE_KEYS.lastSync);
  if (!value) return "Not synced yet";
  const date = new Date(value);
  return date.toLocaleString("en-ZA", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function updateAccountUI() {
  if ($("accountEmail")) {
    $("accountEmail").textContent = state.user?.email || (state.cloudConfigured ? "Not signed in" : "Local mode");
  }

  if ($("accountCloudStatus")) {
    $("accountCloudStatus").textContent = state.user
      ? "Connected to Firebase"
      : state.cloudConfigured
        ? "Waiting for sign in"
        : "Local only";
  }

  if ($("accountLastSync")) $("accountLastSync").textContent = formatLastSync();
  if ($("logoutBtn")) $("logoutBtn").classList.toggle("hidden", !state.user);
  if ($("accountSyncBtn")) $("accountSyncBtn").disabled = !state.user;
}

function userCollection(name) {
  return collection(state.db, "users", state.user.uid, name);
}

function userDocument(collectionName, id) {
  return doc(state.db, "users", state.user.uid, collectionName, id);
}

function appearanceDocument() {
  return doc(state.db, "users", state.user.uid, "settings", "appearance");
}

function reminderToFirestore(reminder) {
  return {
    title: reminder.title,
    category: reminder.category || "Other",
    priority: reminder.priority || "normal",
    dueDate: reminder.dueDate,
    dueTime: reminder.dueTime || "09:00",
    repeat: reminder.repeat || "none",
    amount: reminder.amount === null || reminder.amount === "" ? null : Number(reminder.amount),
    notes: reminder.notes || "",
    completed: Boolean(reminder.completed),
    completedAt: reminder.completedAt || null,
    createdAt: reminder.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function firestoreToReminder(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    title: data.title || "",
    category: data.category || "Other",
    priority: data.priority || "normal",
    dueDate: data.dueDate,
    dueTime: data.dueTime || "09:00",
    repeat: data.repeat || "none",
    amount: data.amount === null || data.amount === undefined ? null : Number(data.amount),
    notes: data.notes || "",
    completed: Boolean(data.completed),
    completedAt: data.completedAt || null,
    createdAt: data.createdAt || new Date().toISOString()
  };
}

function expenseToFirestore(expense) {
  return {
    name: expense.name,
    amount: Number(expense.amount || 0),
    frequency: expense.frequency || "monthly",
    nextDate: expense.nextDate,
    createdAt: expense.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function firestoreToExpense(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    name: data.name || "",
    amount: Number(data.amount || 0),
    frequency: data.frequency || "monthly",
    nextDate: data.nextDate,
    createdAt: data.createdAt || new Date().toISOString()
  };
}

async function flushPendingOperations() {
  if (!state.db || !state.user || !navigator.onLine) return false;

  const allOps = loadPendingOps();
  const userOps = allOps.filter(op => op.userId === state.user.uid);
  if (!userOps.length) return true;

  setSyncStatus(
    "syncing",
    `Syncing ${userOps.length} offline ${userOps.length === 1 ? "change" : "changes"}…`,
    "Uploading changes saved while the app was offline."
  );

  let remaining = [...allOps];

  for (const op of userOps) {
    try {
      if (op.entity === "reminder" && op.action === "upsert") {
        await setDoc(userDocument("reminders", op.payload.id), reminderToFirestore(op.payload), { merge: true });
      } else if (op.entity === "reminder" && op.action === "delete") {
        for (const id of op.ids || []) await deleteDoc(userDocument("reminders", id));
      } else if (op.entity === "expense" && op.action === "upsert") {
        await setDoc(userDocument("expenses", op.payload.id), expenseToFirestore(op.payload), { merge: true });
      } else if (op.entity === "expense" && op.action === "delete") {
        for (const id of op.ids || []) await deleteDoc(userDocument("expenses", id));
      } else if (op.entity === "appearance" && op.action === "upsert") {
        await setDoc(appearanceDocument(), {
          theme: op.payload.theme,
          accent: op.payload.accent,
          accentName: op.payload.accentName,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }

      const opIndex = remaining.findIndex(candidate =>
        candidate.userId === op.userId &&
        candidate.queuedAt === op.queuedAt &&
        candidate.entity === op.entity &&
        candidate.action === op.action
      );
      if (opIndex >= 0) remaining.splice(opIndex, 1);
      savePendingOps(remaining);
    } catch (error) {
      console.error("Pending Firebase sync failed:", error);
      savePendingOps(remaining);
      setSyncStatus("error", "Some offline changes still need syncing", error.message || "Try Sync now again.");
      return false;
    }
  }

  return true;
}

async function initFirebase() {
  state.cloudConfigured = isFirebaseConfigured();

  if (!state.cloudConfigured) {
    $("authGate").classList.add("hidden");
    setSyncStatus(
      "local",
      "Local mode — Firebase setup required",
      "The app works locally now. Add your Firebase web configuration in firebase-config.js to enable accounts and cloud sync."
    );
    render();
    return;
  }

  try {
    state.firebaseApp = initializeApp(firebaseConfig);
    state.auth = getAuth(state.firebaseApp);
    state.db = getFirestore(state.firebaseApp);
    await setPersistence(state.auth, browserLocalPersistence);

    setSyncStatus("syncing", "Connecting to Firebase…", "Checking your saved login session.");

    onAuthStateChanged(state.auth, async (user) => {
      if (user) {
        if (state.user?.uid !== user.uid) {
          await handleSignedIn(user);
        }
      } else {
        handleSignedOut();
      }
    });
  } catch (error) {
    console.error(error);
    setSyncStatus("error", "Firebase could not start", error.message || "Check firebase-config.js.");
    setupDialog.showModal();
  }
}

function showAuthGate() {
  setAuthMode("signin");
  $("authGate").classList.remove("hidden");
}

function hideAuthGate() {
  $("authGate").classList.add("hidden");
  showAuthMessage("");
}

function setAuthMode(mode) {
  state.authMode = mode;
  const isSignup = mode === "signup";

  $("authTabs").classList.remove("hidden");
  $("authEmailLabel").classList.remove("hidden");
  $("forgotPasswordBtn").classList.toggle("hidden", isSignup);
  $("authConfirmWrap").classList.toggle("hidden", !isSignup);
  $("authConfirmPassword").required = isSignup;

  $("authPasswordText").textContent = "Password";
  $("authPassword").autocomplete = isSignup ? "new-password" : "current-password";
  $("authSubmitBtn").textContent = isSignup ? "Create account" : "Sign in";

  document.querySelectorAll("[data-auth-mode]").forEach(button => {
    button.classList.toggle("active", button.dataset.authMode === mode);
  });

  showAuthMessage("");
}

function showAuthMessage(message, type = "") {
  const el = $("authMessage");
  el.textContent = message || "";
  el.className = `auth-message${type ? ` ${type}` : ""}`;
}

function friendlyAuthError(error) {
  const code = error?.code || "";
  const messages = {
    "auth/email-already-in-use": "An account already exists with this email address.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/invalid-credential": "The email address or password is incorrect.",
    "auth/weak-password": "Please choose a stronger password.",
    "auth/too-many-requests": "Too many attempts. Please wait a little and try again.",
    "auth/network-request-failed": "Network error. Check your internet connection and try again.",
    "auth/user-disabled": "This account has been disabled."
  };
  return messages[code] || error?.message || "Authentication failed.";
}

async function handleSignedIn(user) {
  state.user = user;
  hideAuthGate();
  updateAccountUI();
  setSyncStatus("syncing", "Syncing your account…", user.email || "Secure Firebase session active.");

  await syncFromCloud({ allowLegacyMigration: true });
  subscribeRealtime();

  setSyncStatus(
    "synced",
    "Cloud synced",
    `Signed in as ${user.email || "your account"}. Changes sync securely across devices.`
  );
}

function handleSignedOut() {
  const wasSignedIn = Boolean(state.user);
  state.user = null;
  unsubscribeRealtime();

  if (wasSignedIn) {
    // Avoid showing the previous account's cached information to the next person
    // using the same browser.
    state.reminders = [];
    state.expenses = [];
    saveLocalData();
    render();
  }

  if (state.cloudConfigured) showAuthGate();
  setSyncStatus("local", "Sign in to sync", "Your Firebase connection is ready. Sign in or create an account.");
}

async function syncFromCloud({ allowLegacyMigration = false } = {}) {
  if (!state.db || !state.user) return;

  if (!navigator.onLine) {
    setSyncStatus("offline", "Offline — changes saved locally", "Cloud sync will resume when your internet connection returns.");
    return;
  }

  setSyncStatus("syncing", "Syncing…", "Checking Firebase for your latest reminders, expenses and appearance.");

  const pendingFlushed = await flushPendingOperations();
  if (!pendingFlushed && pendingOperationCount() > 0) return;

  const localReminders = [...state.reminders];
  const localExpenses = [...state.expenses];

  try {
    const [reminderSnap, expenseSnap, settingsSnap] = await Promise.all([
      getDocs(userCollection("reminders")),
      getDocs(userCollection("expenses")),
      getDoc(appearanceDocument())
    ]);

    let cloudReminders = reminderSnap.docs.map(firestoreToReminder);
    let cloudExpenses = expenseSnap.docs.map(firestoreToExpense);

    const migrationDone = localStorage.getItem(STORAGE_KEYS.legacyMigrationDone) === "true";
    const hasLegacyData = localReminders.length > 0 || localExpenses.length > 0;
    const cloudIsEmpty = cloudReminders.length === 0 && cloudExpenses.length === 0;

    if (allowLegacyMigration && !migrationDone && hasLegacyData && cloudIsEmpty) {
      for (const reminder of localReminders) {
        await setDoc(userDocument("reminders", reminder.id), reminderToFirestore(reminder));
      }
      for (const expense of localExpenses) {
        await setDoc(userDocument("expenses", expense.id), expenseToFirestore(expense));
      }

      localStorage.setItem(STORAGE_KEYS.legacyMigrationDone, "true");
      return syncFromCloud({ allowLegacyMigration: false });
    }

    localStorage.setItem(STORAGE_KEYS.legacyMigrationDone, "true");

    state.reminders = cloudReminders;
    state.expenses = cloudExpenses;

    if (settingsSnap.exists()) {
      const settings = settingsSnap.data();
      state.appearance = {
        theme: settings.theme || DEFAULT_APPEARANCE.theme,
        accent: settings.accent || DEFAULT_APPEARANCE.accent,
        accentName: settings.accentName || "Custom"
      };
      saveAppearanceLocal();
      applyAppearance();
    } else {
      await syncAppearanceToCloud();
    }

    saveLocalData();
    render();
    setSyncStatus("synced", "Cloud synced", `Signed in as ${state.user.email || "your account"}.`);
  } catch (error) {
    console.error(error);
    setSyncStatus("error", "Firebase sync failed", error.message || "Your local copy is still safe.");
  }
}

async function syncReminderToCloud(reminder) {
  if (!state.db || !state.user) return false;

  if (!navigator.onLine) {
    queueCloudOperation({ entity: "reminder", action: "upsert", payload: { ...reminder } });
    setSyncStatus("offline", "Saved locally — waiting to sync", "This reminder will upload automatically when you reconnect.");
    return false;
  }

  try {
    await setDoc(userDocument("reminders", reminder.id), reminderToFirestore(reminder), { merge: true });
    setSyncStatus("synced", "Cloud synced", "Your latest reminder changes are stored online.");
    return true;
  } catch (error) {
    console.error(error);
    queueCloudOperation({ entity: "reminder", action: "upsert", payload: { ...reminder } });
    setSyncStatus("error", "Saved locally — Firebase update queued", error.message);
    return false;
  }
}

async function syncExpenseToCloud(expense) {
  if (!state.db || !state.user) return false;

  if (!navigator.onLine) {
    queueCloudOperation({ entity: "expense", action: "upsert", payload: { ...expense } });
    setSyncStatus("offline", "Saved locally — waiting to sync", "This expense will upload automatically when you reconnect.");
    return false;
  }

  try {
    await setDoc(userDocument("expenses", expense.id), expenseToFirestore(expense), { merge: true });
    setSyncStatus("synced", "Cloud synced", "Your latest expense changes are stored online.");
    return true;
  } catch (error) {
    console.error(error);
    queueCloudOperation({ entity: "expense", action: "upsert", payload: { ...expense } });
    setSyncStatus("error", "Saved locally — Firebase update queued", error.message);
    return false;
  }
}

async function syncAppearanceToCloud() {
  if (!state.db || !state.user) return false;

  const payload = { ...state.appearance };

  if (!navigator.onLine) {
    queueCloudOperation({ entity: "appearance", action: "upsert", payload });
    return false;
  }

  try {
    await setDoc(appearanceDocument(), {
      theme: payload.theme,
      accent: payload.accent,
      accentName: payload.accentName,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return true;
  } catch (error) {
    console.error(error);
    queueCloudOperation({ entity: "appearance", action: "upsert", payload });
    return false;
  }
}

function subscribeRealtime() {
  if (!state.db || !state.user) return;
  unsubscribeRealtime();

  state.realtimeUnsubs = [
    onSnapshot(userCollection("reminders"), scheduleCloudRefresh, console.error),
    onSnapshot(userCollection("expenses"), scheduleCloudRefresh, console.error),
    onSnapshot(appearanceDocument(), scheduleCloudRefresh, console.error)
  ];
}

function unsubscribeRealtime() {
  for (const unsubscribe of state.realtimeUnsubs) {
    try { unsubscribe(); } catch {}
  }
  state.realtimeUnsubs = [];
}

function scheduleCloudRefresh() {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => syncFromCloud(), 350);
}

/* ---------- Data actions ---------- */
async function completeReminder(id) {
  const item = state.reminders.find(r => r.id === id);
  if (!item) return;

  item.completed = true;
  item.completedAt = new Date().toISOString();

  let next = null;
  if (item.repeat && item.repeat !== "none") {
    next = nextOccurrence(item);
    state.reminders.push(next);
  }

  saveLocalData();
  render();

  if (state.user) {
    setSyncStatus("syncing", "Saving…", "Updating your completed reminder.");
    await syncReminderToCloud(item);
    if (next) await syncReminderToCloud(next);
  }
}

async function restoreReminder(id) {
  const item = state.reminders.find(r => r.id === id);
  if (!item) return;

  item.completed = false;
  item.completedAt = null;
  saveLocalData();
  render();

  if (state.user) {
    setSyncStatus("syncing", "Saving…", "Restoring your reminder.");
    await syncReminderToCloud(item);
  }
}

async function deleteReminder(id) {
  state.reminders = state.reminders.filter(r => r.id !== id);
  saveLocalData();
  render();

  if (state.db && state.user) {
    if (!navigator.onLine) {
      queueCloudOperation({ entity: "reminder", action: "delete", ids: [id] });
      setSyncStatus("offline", "Deleted locally — waiting to sync", "The Firebase copy will be removed when you reconnect.");
    } else {
      try {
        setSyncStatus("syncing", "Deleting…", "Removing the reminder from Firebase.");
        await deleteDoc(userDocument("reminders", id));
        setSyncStatus("synced", "Cloud synced", "Reminder deleted.");
      } catch (error) {
        queueCloudOperation({ entity: "reminder", action: "delete", ids: [id] });
        setSyncStatus("error", "Deleted locally — Firebase delete queued", error.message);
      }
    }
  }
}

async function deleteExpense(id) {
  state.expenses = state.expenses.filter(e => e.id !== id);
  saveLocalData();
  render();

  if (state.db && state.user) {
    if (!navigator.onLine) {
      queueCloudOperation({ entity: "expense", action: "delete", ids: [id] });
      setSyncStatus("offline", "Deleted locally — waiting to sync", "The Firebase copy will be removed when you reconnect.");
    } else {
      try {
        setSyncStatus("syncing", "Deleting…", "Removing the expense from Firebase.");
        await deleteDoc(userDocument("expenses", id));
        setSyncStatus("synced", "Cloud synced", "Expense deleted.");
      } catch (error) {
        queueCloudOperation({ entity: "expense", action: "delete", ids: [id] });
        setSyncStatus("error", "Deleted locally — Firebase delete queued", error.message);
      }
    }
  }
}

async function clearCompleted() {
  const completedIds = state.reminders.filter(r => r.completed).map(r => r.id);
  state.reminders = state.reminders.filter(r => !r.completed);
  saveLocalData();
  render();

  if (completedIds.length && state.db && state.user) {
    if (!navigator.onLine) {
      queueCloudOperation({ entity: "reminder", action: "delete", ids: completedIds });
      setSyncStatus("offline", "Cleared locally — waiting to sync", "Completed Firebase items will be removed when you reconnect.");
    } else {
      try {
        setSyncStatus("syncing", "Clearing completed items…", "Updating Firebase.");
        for (const id of completedIds) await deleteDoc(userDocument("reminders", id));
        setSyncStatus("synced", "Cloud synced", "Completed items cleared.");
      } catch (error) {
        queueCloudOperation({ entity: "reminder", action: "delete", ids: completedIds });
        setSyncStatus("error", "Cleared locally — Firebase deletes queued", error.message);
      }
    }
  }
}

function openReminderDialog() {
  reminderForm.reset();
  $("dueDate").value = localDateString();
  $("dueTime").value = "09:00";
  reminderDialog.showModal();
}

function openExpenseDialog() {
  expenseForm.reset();
  $("expenseDate").value = localDateString();
  expenseDialog.showModal();
}

/* ---------- Authentication events ---------- */
document.querySelectorAll("[data-auth-mode]").forEach(button => {
  button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!state.auth) {
    showAuthMessage("Firebase is not configured yet.", "error");
    return;
  }

  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  const confirm = $("authConfirmPassword").value;

  if (state.authMode === "signup" && password !== confirm) {
    showAuthMessage("The passwords do not match.", "error");
    return;
  }

  $("authSubmitBtn").disabled = true;
  showAuthMessage("Please wait…");

  try {
    if (state.authMode === "signup") {
      const credential = await createUserWithEmailAndPassword(state.auth, email, password);
      await handleSignedIn(credential.user);
    } else {
      const credential = await signInWithEmailAndPassword(state.auth, email, password);
      await handleSignedIn(credential.user);
    }
  } catch (error) {
    showAuthMessage(friendlyAuthError(error), "error");
  } finally {
    $("authSubmitBtn").disabled = false;
  }
});

$("forgotPasswordBtn").addEventListener("click", async () => {
  if (!state.auth) return;

  const email = $("authEmail").value.trim();
  if (!email) {
    showAuthMessage("Enter your email address first.", "error");
    return;
  }

  showAuthMessage("Sending reset email…");

  try {
    await sendPasswordResetEmail(state.auth, email);
    showAuthMessage("Password reset email sent. Follow the link in the email to choose a new password.", "success");
  } catch (error) {
    showAuthMessage(friendlyAuthError(error), "error");
  }
});

$("logoutBtn").addEventListener("click", async () => {
  if (!state.auth) return;
  accountDialog.close();
  await signOut(state.auth);
});

$("accountBtn").addEventListener("click", () => {
  if (!state.cloudConfigured) {
    setupDialog.showModal();
    return;
  }

  if (!state.user) {
    showAuthGate();
    return;
  }

  updateAccountUI();
  accountDialog.showModal();
});

$("accountSyncBtn").addEventListener("click", () => syncFromCloud());
$("syncNowBtn").addEventListener("click", () => {
  if (!state.cloudConfigured) {
    setupDialog.showModal();
  } else if (!state.user) {
    showAuthGate();
  } else {
    syncFromCloud();
  }
});

$("cloudSetupHelpBtn").addEventListener("click", () => setupDialog.showModal());

/* ---------- Reminder and expense form events ---------- */
reminderForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const reminder = {
    id: uid(),
    title: $("title").value.trim(),
    category: $("category").value,
    priority: $("priority").value,
    dueDate: $("dueDate").value,
    dueTime: $("dueTime").value || "09:00",
    repeat: $("repeat").value,
    amount: $("amount").value ? Number($("amount").value) : null,
    notes: $("notes").value.trim(),
    completed: false,
    completedAt: null,
    createdAt: new Date().toISOString()
  };

  if (!reminder.title || !reminder.dueDate) return;

  state.reminders.push(reminder);
  saveLocalData();
  reminderDialog.close();
  render();
  scheduleLocalCheck();

  if (state.user) {
    setSyncStatus("syncing", "Saving reminder…", "Uploading your new reminder to Firebase.");
    await syncReminderToCloud(reminder);
  }
});

expenseForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const expense = {
    id: uid(),
    name: $("expenseName").value.trim(),
    amount: Number($("expenseAmount").value || 0),
    frequency: $("expenseFrequency").value,
    nextDate: $("expenseDate").value,
    createdAt: new Date().toISOString()
  };

  if (!expense.name || !expense.nextDate || expense.amount < 0) return;

  state.expenses.push(expense);
  saveLocalData();
  expenseDialog.close();
  render();

  if (state.user) {
    setSyncStatus("syncing", "Saving expense…", "Uploading your recurring expense to Firebase.");
    await syncExpenseToCloud(expense);
  }
});

/* ---------- General interface ---------- */
$("quickAddBtn").addEventListener("click", openReminderDialog);
$("navAddBtn").addEventListener("click", openReminderDialog);
$("addExpenseBtn").addEventListener("click", openExpenseDialog);
$("navExpensesBtn").addEventListener("click", () => {
  document.querySelector(".side-panel").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("filterCategory").addEventListener("change", renderReminders);
$("clearCompletedBtn").addEventListener("click", clearCompleted);

document.querySelectorAll("[data-close]").forEach(btn => {
  btn.addEventListener("click", () => $(btn.dataset.close).close());
});

$("appearanceBtn").addEventListener("click", openAppearanceDialog);
$("navAppearanceBtn").addEventListener("click", openAppearanceDialog);

document.querySelectorAll("[data-theme-choice]").forEach(button => {
  button.addEventListener("click", () => setTheme(button.dataset.themeChoice));
});

document.querySelectorAll("[data-accent]").forEach(button => {
  button.addEventListener("click", () => setAccent(button.dataset.accent, button.dataset.accentName));
});

$("customAccent").addEventListener("input", (event) => {
  setAccent(event.target.value, "Custom");
});

$("resetAppearanceBtn").addEventListener("click", resetAppearance);

/* ---------- Notifications ---------- */
$("notifyBtn").addEventListener("click", requestNotifications);

async function requestNotifications() {
  if (!("Notification" in window)) {
    alert("This browser does not support notifications.");
    return;
  }

  const permission = await Notification.requestPermission();
  updateNotificationButton();

  if (permission === "granted") {
    new Notification("Life Admin notifications are on", {
      body: "We'll alert you when due reminders are detected while the app is running."
    });
  }
}

function updateNotificationButton() {
  if (!("Notification" in window)) {
    $("notifyBtn").textContent = "Notifications unavailable";
    return;
  }

  if (Notification.permission === "granted") {
    $("notifyBtn").textContent = "Notifications on";
  } else if (Notification.permission === "denied") {
    $("notifyBtn").textContent = "Notifications blocked";
  } else {
    $("notifyBtn").textContent = "Notifications";
  }
}

function scheduleLocalCheck() {
  checkDueNotifications();
}

function checkDueNotifications() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const now = new Date();
  const lastSent = JSON.parse(localStorage.getItem("lifeAdmin.lastSent") || "{}");

  state.reminders.filter(r => !r.completed).forEach(r => {
    const due = parseDue(r);
    const delta = due - now;

    if (delta <= 60000 && delta >= -15 * 60000 && !lastSent[r.id]) {
      new Notification(r.title, {
        body: `${r.category} · ${formatDue(r)}`
      });
      lastSent[r.id] = Date.now();
    }
  });

  localStorage.setItem("lifeAdmin.lastSent", JSON.stringify(lastSent));
}

/* ---------- PWA installation ---------- */
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function updateInstallUI() {
  const installed = isStandalone();
  $("installBtn").textContent = installed ? "Installed" : "Install App";
  $("installBtn").disabled = installed;

  if (installed) {
    $("tryInstallBtn").textContent = "Already installed";
    $("tryInstallBtn").disabled = true;
  } else {
    $("tryInstallBtn").textContent = "Install App";
    $("tryInstallBtn").disabled = false;
  }
}

function showInstallDialog() {
  const instructions = $("installInstructions");

  if (isStandalone()) {
    instructions.innerHTML = `<p><strong>Life Admin is already installed</strong> on this device.</p>`;
  } else if (isIOS()) {
    instructions.innerHTML = `
      <p><strong>On iPhone or iPad:</strong></p>
      <p>Open this website in Safari, tap the <strong>Share</strong> button, then choose <strong>Add to Home Screen</strong>.</p>
    `;
  } else if (state.deferredInstallPrompt) {
    instructions.innerHTML = `
      <p><strong>Your browser supports direct installation.</strong></p>
      <p>Choose <strong>Install App</strong> below. Life Admin will then open from your home screen or app launcher like a normal app.</p>
    `;
  } else {
    instructions.innerHTML = `
      <p><strong>Install from your browser menu.</strong></p>
      <p>Look for <strong>Install app</strong>, <strong>Add to Home Screen</strong>, or an install icon in the address bar. The website must be hosted over HTTPS for installation.</p>
    `;
  }

  updateInstallUI();
  installDialog.showModal();
}

async function triggerInstall() {
  if (isStandalone()) return;

  if (!state.deferredInstallPrompt) {
    showInstallDialog();
    return;
  }

  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  if (installDialog.open) installDialog.close();
  updateInstallUI();
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.deferredInstallPrompt = event;
  updateInstallUI();
});

window.addEventListener("appinstalled", () => {
  state.deferredInstallPrompt = null;
  updateInstallUI();
});

$("installBtn").addEventListener("click", () => {
  if (state.deferredInstallPrompt) triggerInstall();
  else showInstallDialog();
});

$("tryInstallBtn").addEventListener("click", triggerInstall);

/* ---------- Connectivity ---------- */
window.addEventListener("online", () => {
  if (state.user) syncFromCloud();
});

window.addEventListener("offline", () => {
  if (state.user) {
    setSyncStatus("offline", "Offline — changes saved locally", "Cloud sync will resume automatically when you reconnect.");
  }
});

window.addEventListener("focus", () => {
  if (state.user && navigator.onLine) syncFromCloud();
});

/* ---------- Globals used by inline action buttons ---------- */
window.completeReminder = completeReminder;
window.restoreReminder = restoreReminder;
window.deleteReminder = deleteReminder;
window.deleteExpense = deleteExpense;

/* ---------- Service worker ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(console.error);
  });
}

/* ---------- Startup ---------- */
setInterval(checkDueNotifications, 60000);
applyAppearance();
render();
updateInstallUI();
scheduleLocalCheck();
initFirebase();
