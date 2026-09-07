const STORAGE_KEYS = {
  reminders: "lifeAdmin.reminders",
  expenses: "lifeAdmin.expenses",
  appearance: "lifeAdmin.appearance",
  legacyMigrationDone: "lifeAdmin.cloudMigrationDone",
  lastSync: "lifeAdmin.lastSync",
  pendingOps: "lifeAdmin.pendingOps",
  inbox: "lifeAdmin.inbox",
  personalization: "lifeAdmin.personalization"
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
  inbox: load(STORAGE_KEYS.inbox),
  appearance: loadAppearance(),
  personalization: loadPersonalization(),
  user: null,
  supabase: null,
  cloudConfigured: false,
  pushConfigured: false,
  authMode: "signin",
  deferredInstallPrompt: null,
  realtimeChannel: null,
  refreshTimer: null
};

const $ = (id) => document.getElementById(id);

const reminderDialog = $("reminderDialog");
const expenseDialog = $("expenseDialog");
const appearanceDialog = $("appearanceDialog");
const accountDialog = $("accountDialog");
const installDialog = $("installDialog");
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

function loadPersonalization() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.personalization));
    return {
      notificationTone: saved?.notificationTone || "chime",
      backgroundImagePath: saved?.backgroundImagePath || "",
      notificationImagePath: saved?.notificationImagePath || "",
      notificationImageEnabled: Boolean(saved?.notificationImageEnabled)
    };
  } catch {
    return { notificationTone: "chime", backgroundImagePath: "", notificationImagePath: "", notificationImageEnabled: false };
  }
}

function savePersonalizationLocal() {
  localStorage.setItem(STORAGE_KEYS.personalization, JSON.stringify(state.personalization));
}

function notificationToneFile(tone = state.personalization?.notificationTone || "chime") {
  const allowed = ["chime","bell","soft","digital","urgent"];
  return `sounds/${allowed.includes(tone) ? tone : "chime"}.wav`;
}

async function previewNotificationTone(tone = state.personalization?.notificationTone || "chime") {
  try {
    const audio = new Audio(notificationToneFile(tone));
    audio.volume = 0.75;
    await audio.play();
  } catch (error) {
    console.warn("Could not preview notification tone:", error);
  }
}

async function getSignedMediaUrl(path) {
  if (!path || !state.supabase || !state.user) return "";
  const { data, error } = await state.supabase.storage.from("life-admin-media").createSignedUrl(path, 60 * 60 * 24);
  if (error) { console.warn("Could not create media URL:", error); return ""; }
  return data?.signedUrl || "";
}

async function applyPersonalizationMedia() {
  const bg = await getSignedMediaUrl(state.personalization?.backgroundImagePath);
  const root = document.documentElement;
  if (bg) {
    root.style.setProperty("--life-admin-background", `url("${bg.replace(/"/g, '\\"')}")`);
    root.classList.add("has-custom-background");
  } else {
    root.style.removeProperty("--life-admin-background");
    root.classList.remove("has-custom-background");
  }

  const preview = $("backgroundImagePreview");
  if (preview) preview.innerHTML = bg ? `<img src="${escapeHtml(bg)}" alt="Your background image">` : "";

  const notifUrl = await getSignedMediaUrl(state.personalization?.notificationImagePath);
  const notifPreview = $("notificationImagePreview");
  if (notifPreview) notifPreview.innerHTML = notifUrl ? `<img src="${escapeHtml(notifUrl)}" alt="Your notification image">` : "";
  if ($("notificationImageEnabled")) $("notificationImageEnabled").checked = Boolean(state.personalization?.notificationImageEnabled);
}

async function syncPersonalizationToCloud() {
  if (!state.supabase || !state.user) return false;
  const p = state.personalization;
  const { error } = await state.supabase.from("user_settings").upsert({
    user_id: state.user.id,
    theme: state.appearance.theme,
    accent: state.appearance.accent,
    accent_name: state.appearance.accentName,
    notification_tone: p.notificationTone,
    background_image_path: p.backgroundImagePath || null,
    notification_image_path: p.notificationImagePath || null,
    notification_image_enabled: Boolean(p.notificationImageEnabled),
    updated_at: new Date().toISOString()
  });
  if (error) { console.error("Personalization sync failed:", error); return false; }
  return true;
}

async function uploadPersonalImage(kind, file) {
  if (!state.supabase || !state.user || !file) return;
  if (!file.type.startsWith("image/")) return alert("Please choose an image file.");
  if (file.size > 10 * 1024 * 1024) return alert("Please choose an image smaller than 10 MB.");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${state.user.id}/${kind}-${Date.now()}.${ext}`;
  const { error } = await state.supabase.storage.from("life-admin-media").upload(path, file, { upsert: true, contentType: file.type });
  if (error) return alert(`Image upload failed: ${error.message}`);
  if (kind === "background") state.personalization.backgroundImagePath = path;
  else state.personalization.notificationImagePath = path;
  savePersonalizationLocal();
  await syncPersonalizationToCloud();
  await applyPersonalizationMedia();
}

async function removePersonalImage(kind) {
  const key = kind === "background" ? "backgroundImagePath" : "notificationImagePath";
  const path = state.personalization[key];
  if (path && state.supabase) await state.supabase.storage.from("life-admin-media").remove([path]);
  state.personalization[key] = "";
  if (kind === "notification") state.personalization.notificationImageEnabled = false;
  savePersonalizationLocal();
  await syncPersonalizationToCloud();
  await applyPersonalizationMedia();
}

function saveLocalData() {
  localStorage.setItem(STORAGE_KEYS.reminders, JSON.stringify(state.reminders));
  localStorage.setItem(STORAGE_KEYS.expenses, JSON.stringify(state.expenses));
  localStorage.setItem(STORAGE_KEYS.inbox, JSON.stringify(state.inbox || []));
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
    userId: state.user.id,
    queuedAt: new Date().toISOString()
  });
  savePendingOps(ops);
}

function pendingOperationCount() {
  if (!state.user) return 0;
  return loadPendingOps().filter(op => op.userId === state.user.id).length;
}

async function flushPendingOperations() {
  if (!state.supabase || !state.user || !navigator.onLine) return false;

  const allOps = loadPendingOps();
  const userOps = allOps.filter(op => op.userId === state.user.id);
  if (!userOps.length) return true;

  setSyncStatus(
    "syncing",
    `Syncing ${userOps.length} offline ${userOps.length === 1 ? "change" : "changes"}…`,
    "Uploading changes saved while the app was offline."
  );

  let remaining = [...allOps];

  for (const op of userOps) {
    let error = null;

    if (op.entity === "reminder" && op.action === "upsert") {
      ({ error } = await state.supabase.from("reminders").upsert(reminderToRow({ ...op.payload })));
    } else if (op.entity === "reminder" && op.action === "delete") {
      ({ error } = await state.supabase.from("reminders").delete().in("id", op.ids || []));
    } else if (op.entity === "expense" && op.action === "upsert") {
      ({ error } = await state.supabase.from("expenses").upsert(expenseToRow({ ...op.payload })));
    } else if (op.entity === "expense" && op.action === "delete") {
      ({ error } = await state.supabase.from("expenses").delete().in("id", op.ids || []));
    } else if (op.entity === "appearance" && op.action === "upsert") {
      ({ error } = await state.supabase.from("user_settings").upsert({
        user_id: state.user.id,
        theme: op.payload.theme,
        accent: op.payload.accent,
        accent_name: op.payload.accentName,
        notification_tone: op.payload.notificationTone || "chime",
        background_image_path: op.payload.backgroundImagePath || null,
        notification_image_path: op.payload.notificationImagePath || null,
        notification_image_enabled: Boolean(op.payload.notificationImageEnabled),
        updated_at: new Date().toISOString()
      }));
    }

    if (error) {
      console.error("Pending sync failed:", error);
      savePendingOps(remaining);
      setSyncStatus("error", "Some offline changes still need syncing", error.message || "Try Sync now again.");
      return false;
    }

    const opIndex = remaining.findIndex(candidate =>
      candidate.userId === op.userId &&
      candidate.queuedAt === op.queuedAt &&
      candidate.entity === op.entity &&
      candidate.action === op.action
    );
    if (opIndex >= 0) remaining.splice(opIndex, 1);
    savePendingOps(remaining);
  }

  return true;
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `00000000-0000-4000-8000-${String(Date.now()).slice(-12)}`;
}

function ensureUuid(value) {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(String(value || "")) ? value : uid();
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function dueTimestamp(dueDate, dueTime = "09:00") {
  if (!dueDate) return null;
  const date = new Date(`${dueDate}T${dueTime || "09:00"}:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
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
    dueAt: null,
    dueTimezone: currentTimeZone(),
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
  const tone = state.personalization?.notificationTone || "chime";
  document.querySelectorAll("[data-tone]").forEach(b => b.classList.toggle("selected", b.dataset.tone === tone));
  if ($("currentNotificationToneLabel")) $("currentNotificationToneLabel").textContent = tone.charAt(0).toUpperCase() + tone.slice(1);
  applyPersonalizationMedia();
  appearanceDialog.showModal();
}

/* ---------- Rendering ---------- */
function render() {
  if (window.lifeAdminEnhancedRender) return window.lifeAdminEnhancedRender();
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

/* ---------- Supabase configuration ---------- */
function getConfig() {
  return window.LIFE_ADMIN_CONFIG || {};
}

function isSupabaseConfigured() {
  const config = getConfig();
  return Boolean(
    config.SUPABASE_URL &&
    config.SUPABASE_PUBLISHABLE_KEY &&
    !config.SUPABASE_URL.includes("YOUR-PROJECT") &&
    !config.SUPABASE_PUBLISHABLE_KEY.includes("YOUR-PUBLISHABLE") &&
    window.supabase?.createClient
  );
}

function setSyncStatus(mode, text, detail = "") {
  const dot = $("syncDot");
  dot.className = `sync-dot ${mode}`;
  $("syncStatusText").textContent = text;
  $("syncStatusDetail").textContent = detail;

  if (mode === "synced") {
    const now = new Date();
    localStorage.setItem(STORAGE_KEYS.lastSync, now.toISOString());
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
      ? "Connected to Supabase"
      : state.cloudConfigured
        ? "Waiting for sign in"
        : "Local only";
  }
  if ($("accountLastSync")) $("accountLastSync").textContent = formatLastSync();

  if ($("logoutBtn")) $("logoutBtn").classList.toggle("hidden", !state.user);
  if ($("accountSyncBtn")) $("accountSyncBtn").disabled = !state.user;
}

function reminderToRow(reminder) {
  reminder.id = ensureUuid(reminder.id);
  const timezone = reminder.dueTimezone || currentTimeZone();
  const scheduledFor = reminder.dueAt || dueTimestamp(reminder.dueDate, reminder.dueTime || "09:00");
  reminder.dueTimezone = timezone;
  reminder.dueAt = scheduledFor;

  return {
    id: reminder.id,
    user_id: state.user.id,
    title: reminder.title,
    category: reminder.category || "Other",
    priority: reminder.priority || "normal",
    due_date: reminder.dueDate,
    due_time: reminder.dueTime || "09:00",
    due_at: scheduledFor,
    due_timezone: timezone,
    repeat: reminder.repeat || "none",
    amount: reminder.amount === null || reminder.amount === "" ? null : Number(reminder.amount),
    notes: reminder.notes || null,
    location: reminder.location || null,
    remind_before: Number(reminder.remindBefore || 0),
    attachment: reminder.attachment || null,
    completed: Boolean(reminder.completed),
    completed_at: reminder.completedAt || null,
    created_at: reminder.createdAt || new Date().toISOString()
  };
}

function rowToReminder(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    priority: row.priority,
    dueDate: row.due_date,
    dueTime: String(row.due_time || "09:00").slice(0, 5),
    dueAt: row.due_at || null,
    dueTimezone: row.due_timezone || currentTimeZone(),
    repeat: row.repeat,
    amount: row.amount === null ? null : Number(row.amount),
    notes: row.notes || "",
    location: row.location || "",
    remindBefore: Number(row.remind_before || 0),
    attachment: row.attachment || "",
    completed: Boolean(row.completed),
    completedAt: row.completed_at,
    createdAt: row.created_at
  };
}

function expenseToRow(expense) {
  expense.id = ensureUuid(expense.id);
  return {
    id: expense.id,
    user_id: state.user.id,
    name: expense.name,
    amount: Number(expense.amount || 0),
    frequency: expense.frequency || "monthly",
    next_date: expense.nextDate,
    category: expense.category || "Other",
    status: expense.status || "unpaid",
    notes: expense.notes || null,
    created_at: expense.createdAt || new Date().toISOString()
  };
}

function rowToExpense(row) {
  return {
    id: row.id,
    name: row.name,
    amount: Number(row.amount || 0),
    frequency: row.frequency,
    nextDate: row.next_date,
    category: row.category || "Other",
    status: row.status || "unpaid",
    notes: row.notes || "",
    createdAt: row.created_at
  };
}

async function initSupabase() {
  state.cloudConfigured = isSupabaseConfigured();
  state.pushConfigured = isPushConfigured();

  if (!state.cloudConfigured) {
    $("authGate").classList.add("hidden");
    setSyncStatus(
      "local",
      "Local mode — Supabase setup required",
      "The app works locally now. Add your Supabase URL and publishable key in config.js to enable accounts and cloud sync."
    );
    render();
    return;
  }

  const config = getConfig();
  state.supabase = window.supabase.createClient(
    config.SUPABASE_URL,
    config.SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  setSyncStatus("syncing", "Connecting to Supabase…", "Checking your saved login session.");

  state.supabase.auth.onAuthStateChange((event, session) => {
    window.setTimeout(async () => {
      if (event === "PASSWORD_RECOVERY") {
        state.user = session?.user || null;
        setAuthMode("recovery");
        $("authGate").classList.remove("hidden");
        return;
      }

      if (session?.user) {
        if (state.user?.id !== session.user.id) {
          await handleSignedIn(session.user);
        }
      } else if (state.user) {
        handleSignedOut();
      }
    }, 0);
  });

  const { data, error } = await state.supabase.auth.getSession();

  if (error) {
    showAuthMessage(error.message, "error");
    $("authGate").classList.remove("hidden");
    setSyncStatus("error", "Could not restore login", "Sign in again to reconnect cloud syncing.");
    return;
  }

  if (data.session?.user && state.authMode !== "recovery") {
    await handleSignedIn(data.session.user);
  } else if (state.authMode !== "recovery") {
    showAuthGate();
    setSyncStatus("local", "Sign in to sync", "Your Supabase connection is ready. Sign in or create an account.");
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
  const isRecovery = mode === "recovery";

  $("authTabs").classList.toggle("hidden", isRecovery);
  $("authEmailLabel").classList.toggle("hidden", isRecovery);
  $("forgotPasswordBtn").classList.toggle("hidden", isSignup || isRecovery);
  $("authConfirmWrap").classList.toggle("hidden", !(isSignup || isRecovery));
  $("authConfirmPassword").required = isSignup || isRecovery;

  $("authPasswordText").textContent = isRecovery ? "New password" : "Password";
  $("authPassword").autocomplete = isRecovery || isSignup ? "new-password" : "current-password";
  $("authSubmitBtn").textContent = isRecovery ? "Save new password" : isSignup ? "Create account" : "Sign in";

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

async function handleSignedIn(user) {
  state.user = user;
  hideAuthGate();
  updateAccountUI();
  setSyncStatus("syncing", "Syncing your account…", user.email || "Secure Supabase session active.");

  await syncFromCloud({ allowLegacyMigration: true });
  subscribeRealtime();
  await refreshExistingPushSubscription();

  setSyncStatus("synced", "Cloud synced", `Signed in as ${user.email || "your account"}. Changes sync securely across devices.`);
}

function handleSignedOut() {
  state.user = null;
  unsubscribeRealtime();

  // Prevent the next account on a shared browser from seeing the previous user's cached data.
  state.reminders = [];
  state.expenses = [];
  saveLocalData();

  render();
  showAuthGate();
  setSyncStatus("local", "Signed out", "Sign in to load your cloud data.");
}

async function syncFromCloud({ allowLegacyMigration = false } = {}) {
  if (!state.supabase || !state.user) return;

  if (!navigator.onLine) {
    setSyncStatus("offline", "Offline — changes saved locally", "Cloud sync will resume when your internet connection returns.");
    return;
  }

  setSyncStatus("syncing", "Syncing…", "Checking Supabase for your latest reminders, expenses and appearance.");

  const pendingFlushed = await flushPendingOperations();
  if (!pendingFlushed && pendingOperationCount() > 0) return;

  const localReminders = [...state.reminders];
  const localExpenses = [...state.expenses];

  const [reminderResult, expenseResult, settingsResult] = await Promise.all([
    state.supabase.from("reminders").select("*").order("due_date", { ascending: true }),
    state.supabase.from("expenses").select("*").order("next_date", { ascending: true }),
    state.supabase.from("user_settings").select("*").maybeSingle()
  ]);

  const firstError = reminderResult.error || expenseResult.error || settingsResult.error;
  if (firstError) {
    console.error(firstError);
    setSyncStatus("error", "Cloud sync failed", firstError.message || "Your local copy is still safe.");
    return;
  }

  const cloudReminders = (reminderResult.data || []).map(rowToReminder);
  const cloudExpenses = (expenseResult.data || []).map(rowToExpense);

  const migrationDone = localStorage.getItem(STORAGE_KEYS.legacyMigrationDone) === "true";
  const hasLegacyData = localReminders.length > 0 || localExpenses.length > 0;
  const cloudIsEmpty = cloudReminders.length === 0 && cloudExpenses.length === 0;

  if (allowLegacyMigration && !migrationDone && hasLegacyData && cloudIsEmpty) {
    try {
      if (localReminders.length) {
        const reminderRows = localReminders.map(item => reminderToRow({ ...item }));
        const { error } = await state.supabase.from("reminders").upsert(reminderRows);
        if (error) throw error;
      }

      if (localExpenses.length) {
        const expenseRows = localExpenses.map(item => expenseToRow({ ...item }));
        const { error } = await state.supabase.from("expenses").upsert(expenseRows);
        if (error) throw error;
      }

      localStorage.setItem(STORAGE_KEYS.legacyMigrationDone, "true");
      return syncFromCloud({ allowLegacyMigration: false });
    } catch (error) {
      console.error("Legacy migration failed:", error);
      setSyncStatus("error", "Could not move local data to the cloud", error.message || "Local data has not been deleted.");
      return;
    }
  }

  localStorage.setItem(STORAGE_KEYS.legacyMigrationDone, "true");

  state.reminders = cloudReminders;
  state.expenses = cloudExpenses;

  const remindersNeedingSchedule = state.reminders.filter(reminder => !reminder.dueAt);
  if (remindersNeedingSchedule.length) {
    const migratedRows = remindersNeedingSchedule.map(reminder => reminderToRow(reminder));
    const { error: scheduleMigrationError } = await state.supabase.from("reminders").upsert(migratedRows);
    if (scheduleMigrationError) {
      console.warn("Could not add server notification timestamps to older reminders:", scheduleMigrationError);
    }
  }

  if (settingsResult.data) {
    state.appearance = {
      theme: settingsResult.data.theme || DEFAULT_APPEARANCE.theme,
      accent: settingsResult.data.accent || DEFAULT_APPEARANCE.accent,
      accentName: settingsResult.data.accent_name || "Custom"
    };
    state.personalization = {
      notificationTone: settingsResult.data.notification_tone || state.personalization.notificationTone || "chime",
      backgroundImagePath: settingsResult.data.background_image_path || state.personalization.backgroundImagePath || "",
      notificationImagePath: settingsResult.data.notification_image_path || state.personalization.notificationImagePath || "",
      notificationImageEnabled: Boolean(settingsResult.data.notification_image_enabled)
    };
    saveAppearanceLocal();
    savePersonalizationLocal();
    applyAppearance();
    applyPersonalizationMedia();
  } else {
    await syncPersonalizationToCloud();
  }

  saveLocalData();
  render();
  setSyncStatus("synced", "Cloud synced", `Signed in as ${state.user.email || "your account"}.`);
}

async function syncReminderToCloud(reminder) {
  if (!state.supabase || !state.user) return false;

  if (!navigator.onLine) {
    queueCloudOperation({ entity: "reminder", action: "upsert", payload: { ...reminder } });
    setSyncStatus("offline", "Saved locally — waiting to sync", "This reminder will upload automatically when you reconnect.");
    return false;
  }

  const { error } = await state.supabase.from("reminders").upsert(reminderToRow(reminder));
  if (error) {
    console.error(error);
    queueCloudOperation({ entity: "reminder", action: "upsert", payload: { ...reminder } });
    setSyncStatus("error", "Saved locally — cloud update queued", error.message);
    return false;
  }

  setSyncStatus("synced", "Cloud synced", "Your latest reminder changes are stored online.");
  return true;
}

async function syncExpenseToCloud(expense) {
  if (!state.supabase || !state.user) return false;

  if (!navigator.onLine) {
    queueCloudOperation({ entity: "expense", action: "upsert", payload: { ...expense } });
    setSyncStatus("offline", "Saved locally — waiting to sync", "This expense will upload automatically when you reconnect.");
    return false;
  }

  const { error } = await state.supabase.from("expenses").upsert(expenseToRow(expense));
  if (error) {
    console.error(error);
    queueCloudOperation({ entity: "expense", action: "upsert", payload: { ...expense } });
    setSyncStatus("error", "Saved locally — cloud update queued", error.message);
    return false;
  }

  setSyncStatus("synced", "Cloud synced", "Your latest expense changes are stored online.");
  return true;
}

async function syncAppearanceToCloud() {
  if (!state.supabase || !state.user) return false;
  const payload = { ...state.appearance, ...state.personalization };
  if (!navigator.onLine) {
    queueCloudOperation({ entity: "appearance", action: "upsert", payload });
    return false;
  }
  const { error } = await state.supabase.from("user_settings").upsert({
    user_id: state.user.id,
    theme: payload.theme,
    accent: payload.accent,
    accent_name: payload.accentName,
    notification_tone: payload.notificationTone || "chime",
    background_image_path: payload.backgroundImagePath || null,
    notification_image_path: payload.notificationImagePath || null,
    notification_image_enabled: Boolean(payload.notificationImageEnabled),
    updated_at: new Date().toISOString()
  });
  if (error) {
    console.error(error);
    queueCloudOperation({ entity: "appearance", action: "upsert", payload });
    return false;
  }
  return true;
}

function subscribeRealtime() {
  if (!state.supabase || !state.user) return;
  unsubscribeRealtime();

  state.realtimeChannel = state.supabase
    .channel(`life-admin-${state.user.id}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "reminders",
        filter: `user_id=eq.${state.user.id}`
      },
      scheduleCloudRefresh
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "expenses",
        filter: `user_id=eq.${state.user.id}`
      },
      scheduleCloudRefresh
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "user_settings",
        filter: `user_id=eq.${state.user.id}`
      },
      scheduleCloudRefresh
    )
    .subscribe();
}

function unsubscribeRealtime() {
  if (state.realtimeChannel && state.supabase) {
    state.supabase.removeChannel(state.realtimeChannel);
  }
  state.realtimeChannel = null;
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

  if (state.supabase && state.user) {
    if (!navigator.onLine) {
      queueCloudOperation({ entity: "reminder", action: "delete", ids: [id] });
      setSyncStatus("offline", "Deleted locally — waiting to sync", "The cloud copy will be removed when you reconnect.");
    } else {
      setSyncStatus("syncing", "Deleting…", "Removing the reminder from Supabase.");
      const { error } = await state.supabase.from("reminders").delete().eq("id", id);
      if (error) {
        queueCloudOperation({ entity: "reminder", action: "delete", ids: [id] });
        setSyncStatus("error", "Deleted locally — cloud delete queued", error.message);
      } else {
        setSyncStatus("synced", "Cloud synced", "Reminder deleted.");
      }
    }
  }
}

async function deleteExpense(id) {
  state.expenses = state.expenses.filter(e => e.id !== id);
  saveLocalData();
  render();

  if (state.supabase && state.user) {
    if (!navigator.onLine) {
      queueCloudOperation({ entity: "expense", action: "delete", ids: [id] });
      setSyncStatus("offline", "Deleted locally — waiting to sync", "The cloud copy will be removed when you reconnect.");
    } else {
      setSyncStatus("syncing", "Deleting…", "Removing the expense from Supabase.");
      const { error } = await state.supabase.from("expenses").delete().eq("id", id);
      if (error) {
        queueCloudOperation({ entity: "expense", action: "delete", ids: [id] });
        setSyncStatus("error", "Deleted locally — cloud delete queued", error.message);
      } else {
        setSyncStatus("synced", "Cloud synced", "Expense deleted.");
      }
    }
  }
}

async function clearCompleted() {
  const completedIds = state.reminders.filter(r => r.completed).map(r => r.id);
  state.reminders = state.reminders.filter(r => !r.completed);
  saveLocalData();
  render();

  if (completedIds.length && state.supabase && state.user) {
    if (!navigator.onLine) {
      queueCloudOperation({ entity: "reminder", action: "delete", ids: completedIds });
      setSyncStatus("offline", "Cleared locally — waiting to sync", "Completed cloud items will be removed when you reconnect.");
    } else {
      setSyncStatus("syncing", "Clearing completed items…", "Updating Supabase.");
      const { error } = await state.supabase.from("reminders").delete().in("id", completedIds);
      if (error) {
        queueCloudOperation({ entity: "reminder", action: "delete", ids: completedIds });
        setSyncStatus("error", "Cleared locally — cloud delete queued", error.message);
      } else {
        setSyncStatus("synced", "Cloud synced", "Completed items cleared.");
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

  if (!state.supabase) {
    showAuthMessage("Supabase is not configured yet.", "error");
    return;
  }

  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  const confirm = $("authConfirmPassword").value;

  if ((state.authMode === "signup" || state.authMode === "recovery") && password !== confirm) {
    showAuthMessage("The passwords do not match.", "error");
    return;
  }

  $("authSubmitBtn").disabled = true;
  showAuthMessage("Please wait…");

  try {
    if (state.authMode === "signup") {
      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      const { data, error } = await state.supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo }
      });

      if (error) throw error;

      if (data.session) {
        await handleSignedIn(data.user);
      } else {
        showAuthMessage("Account created. Check your email to confirm your account, then sign in.", "success");
        setAuthMode("signin");
      }
    } else if (state.authMode === "recovery") {
      const { error } = await state.supabase.auth.updateUser({ password });
      if (error) throw error;
      showAuthMessage("Password updated.", "success");
      await handleSignedIn(state.user);
    } else {
      const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await handleSignedIn(data.user);
    }
  } catch (error) {
    showAuthMessage(error.message || "Authentication failed.", "error");
  } finally {
    $("authSubmitBtn").disabled = false;
  }
});

$("forgotPasswordBtn").addEventListener("click", async () => {
  if (!state.supabase) return;

  const email = $("authEmail").value.trim();
  if (!email) {
    showAuthMessage("Enter your email address first.", "error");
    return;
  }

  showAuthMessage("Sending reset email…");

  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await state.supabase.auth.resetPasswordForEmail(email, { redirectTo });

  if (error) {
    showAuthMessage(error.message, "error");
  } else {
    showAuthMessage("Password reset email sent. Open the link in that email to choose a new password.", "success");
  }
});

$("logoutBtn").addEventListener("click", async () => {
  if (!state.supabase) return;
  accountDialog.close();
  await disablePushNotifications({ quiet: true });
  await state.supabase.auth.signOut();
});

$("accountBtn").addEventListener("click", () => {
  if (!state.cloudConfigured || !state.user) {
    showAuthGate();
    return;
  }

  updateAccountUI();
  accountDialog.showModal();
});

$("accountSyncBtn").addEventListener("click", () => syncFromCloud());
$("syncNowBtn").addEventListener("click", () => {
  if (!state.cloudConfigured || !state.user) {
    showAuthGate();
  } else {
    syncFromCloud();
  }
});

/* ---------- Reminder and expense form events ---------- */
reminderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const editId = reminderForm.dataset.editId;
  const reminder = {
    id: editId || uid(), title: $("title").value.trim(), category: $("category").value, priority: $("priority").value,
    dueDate: $("dueDate").value, dueTime: $("dueTime").value || "09:00", dueAt: dueTimestamp($("dueDate").value, $("dueTime").value || "09:00"),
    dueTimezone: currentTimeZone(), repeat: $("repeat").value, amount: $("amount").value ? Number($("amount").value) : null,
    notes: $("notes").value.trim(), location: $("location")?.value.trim() || "", remindBefore: Number($("remindBefore")?.value || 0), attachment: $("attachment")?.value.trim() || "",
    completed: false, completedAt: null, createdAt: new Date().toISOString()
  };
  if (!reminder.title || !reminder.dueDate) return;
  if (editId) { const index=state.reminders.findIndex(r=>r.id===editId); if(index>=0) state.reminders[index]={...state.reminders[index],...reminder}; }
  else state.reminders.push(reminder);
  saveLocalData(); reminderForm.reset(); delete reminderForm.dataset.editId; reminderDialog.close(); render(); scheduleLocalCheck();
  if (state.user) { setSyncStatus("syncing", editId ? "Updating reminder…" : "Saving reminder…", "Uploading your changes to Supabase."); await syncReminderToCloud(reminder); }
});

expenseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const editId=expenseForm.dataset.editId;
  const expense={id:editId||uid(),name:$("expenseName").value.trim(),amount:Number($("expenseAmount").value||0),frequency:$("expenseFrequency").value,nextDate:$("expenseDate").value,category:$("expenseCategory")?.value||"Other",status:$("expenseStatus")?.value||"unpaid",notes:$("expenseNotes")?.value.trim()||"",createdAt:new Date().toISOString()};
  if(!expense.name||!expense.nextDate||expense.amount<0)return;
  if(editId){const i=state.expenses.findIndex(e=>e.id===editId);if(i>=0)state.expenses[i]={...state.expenses[i],...expense};}else state.expenses.push(expense);
  saveLocalData();expenseForm.reset();delete expenseForm.dataset.editId;expenseDialog.close();render();
  if(state.user){setSyncStatus("syncing",editId?"Updating expense…":"Saving expense…","Uploading your changes to Supabase.");await syncExpenseToCloud(expense);}
});

/* ---------- General interface ---------- */
$("quickAddBtn").addEventListener("click", openReminderDialog);
$("navAddBtn").addEventListener("click", openReminderDialog);
$("addExpenseBtn").addEventListener("click", openExpenseDialog);
$("navExpensesBtn").addEventListener("click", () => {
  document.querySelector(".side-panel").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("filterCategory").addEventListener("change", () => window.lifeAdminEnhancedRenderReminders ? window.lifeAdminEnhancedRenderReminders() : renderReminders());
$("clearCompletedBtn").addEventListener("click", clearCompleted);

document.querySelectorAll("[data-close]").forEach(btn => {
  btn.addEventListener("click", () => $(btn.dataset.close).close());
});

$("appearanceBtn").addEventListener("click", openAppearanceDialog);
$("navAppearanceBtn")?.addEventListener("click", openAppearanceDialog);

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

/* ---------- Personalisation controls ---------- */
document.querySelectorAll("[data-tone]").forEach(button => {
  button.addEventListener("click", async () => {
    const tone = button.dataset.tone;
    state.personalization.notificationTone = tone;
    savePersonalizationLocal();
    document.querySelectorAll("[data-tone]").forEach(b => b.classList.toggle("selected", b.dataset.tone === tone));
    if ($("currentNotificationToneLabel")) $("currentNotificationToneLabel").textContent = tone.charAt(0).toUpperCase() + tone.slice(1);
    await syncPersonalizationToCloud();
    await previewNotificationTone(tone);
  });
});
$("previewNotificationToneBtn")?.addEventListener("click", () => previewNotificationTone());
$("backgroundImageUpload")?.addEventListener("change", e => uploadPersonalImage("background", e.target.files?.[0]));
$("notificationImageUpload")?.addEventListener("change", e => uploadPersonalImage("notification", e.target.files?.[0]));
$("removeBackgroundImageBtn")?.addEventListener("click", () => removePersonalImage("background"));
$("removeNotificationImageBtn")?.addEventListener("click", () => removePersonalImage("notification"));
$("notificationImageEnabled")?.addEventListener("change", async e => {
  state.personalization.notificationImageEnabled = e.target.checked;
  savePersonalizationLocal();
  await syncPersonalizationToCloud();
});

/* ---------- Background push notifications ---------- */
$("notifyBtn").addEventListener("click", requestNotifications);

function isPushConfigured() {
  const key = getConfig().VAPID_PUBLIC_KEY;
  return Boolean(key && !String(key).includes("YOUR-VAPID"));
}

function pushSupportAvailable() {
  return "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

async function getServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  await navigator.serviceWorker.register("service-worker.js");
  return navigator.serviceWorker.ready;
}

async function getPushSubscription() {
  const registration = await getServiceWorkerRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

async function savePushSubscription(subscription) {
  if (!state.supabase || !state.user || !subscription) return false;

  const json = subscription.toJSON();
  const row = {
    user_id: state.user.id,
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh || "",
    auth: json.keys?.auth || "",
    timezone: currentTimeZone(),
    user_agent: navigator.userAgent.slice(0, 500),
    enabled: true,
    updated_at: new Date().toISOString()
  };

  const { error } = await state.supabase.from("push_subscriptions").upsert(row, { onConflict: "endpoint" });
  if (error) {
    console.error("Push subscription sync failed:", error);
    alert(`Notifications were allowed, but the subscription could not be saved to Supabase: ${error.message}`);
    return false;
  }

  return true;
}

async function refreshExistingPushSubscription() {
  updateNotificationButton();
  if (!state.user || !state.pushConfigured || !pushSupportAvailable() || Notification.permission !== "granted") return;

  try {
    const subscription = await getPushSubscription();
    if (subscription) await savePushSubscription(subscription);
  } catch (error) {
    console.warn("Could not refresh push subscription:", error);
  } finally {
    updateNotificationButton();
  }
}

async function requestNotifications() {
  if (!pushSupportAvailable()) {
    alert("This browser/device does not support background Web Push notifications.");
    return;
  }

  if (!state.cloudConfigured || !state.user) {
    if (!state.cloudConfigured || !state.user) showAuthGate();
    return;
  }

  if (!state.pushConfigured) {
    alert("Background notifications are not configured on this installation.");
    return;
  }

  if (isIOS() && !isStandalone()) {
    alert("On iPhone/iPad, install Life Admin to the Home Screen first, open the installed app, then enable Notifications.");
    installDialog.showModal();
    return;
  }

  try {
    const currentSubscription = await getPushSubscription();
    if (Notification.permission === "granted" && currentSubscription) {
      const turnOff = confirm("Background notifications are on. Turn them off on this device?");
      if (turnOff) await disablePushNotifications();
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      updateNotificationButton();
      return;
    }

    const registration = await getServiceWorkerRegistration();
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(getConfig().VAPID_PUBLIC_KEY)
      });
    }

    const saved = await savePushSubscription(subscription);
    if (!saved) return;

    await registration.showNotification("Life Admin notifications are on", {
      body: "Background reminder alerts are enabled for this device.",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: "life-admin-push-enabled",
      data: { url: "./" }
    });
  } catch (error) {
    console.error("Could not enable notifications:", error);
    alert(error?.message || "Could not enable background notifications on this device.");
  } finally {
    updateNotificationButton();
  }
}

async function disablePushNotifications({ quiet = false } = {}) {
  if (!pushSupportAvailable()) return;

  try {
    const subscription = await getPushSubscription();
    if (!subscription) return;

    if (state.supabase && state.user) {
      const { error } = await state.supabase
        .from("push_subscriptions")
        .delete()
        .eq("endpoint", subscription.endpoint);
      if (error && !quiet) console.warn("Could not remove push subscription from Supabase:", error);
    }

    await subscription.unsubscribe();
  } catch (error) {
    if (!quiet) {
      console.error("Could not disable notifications:", error);
      alert(error?.message || "Could not turn notifications off.");
    }
  } finally {
    updateNotificationButton();
  }
}

async function updateNotificationButton() {
  const button = $("notifyBtn");
  const label = $("notifyBtnLabel");
  const setLabel = text => {
    if (label) label.textContent = text;
    else button.textContent = text;
  };

  if (!pushSupportAvailable()) {
    setLabel("Notifications unavailable");
    button.disabled = true;
    return;
  }

  button.disabled = false;

  if (Notification.permission === "denied") {
    setLabel("Notifications blocked");
    return;
  }

  if (Notification.permission !== "granted") {
    setLabel("Notifications");
    return;
  }

  try {
    const subscription = await getPushSubscription();
    setLabel(subscription ? "Notifications on" : "Notifications");
  } catch {
    setLabel("Notifications");
  }
}

function scheduleLocalCheck() {
  checkDueNotifications();
}

// Foreground fallback. The Supabase Edge Function is responsible for true background delivery.
async function checkDueNotifications() {
  if (!pushSupportAvailable() || Notification.permission !== "granted" || document.hidden) return;

  // If this device has a true Web Push subscription, the server-side Edge Function owns delivery.
  // Keeping the foreground fallback disabled in that case prevents duplicate alerts.
  try {
    if (state.user && state.pushConfigured && await getPushSubscription()) return;
  } catch {
    // If subscription lookup fails, keep the foreground fallback available.
  }

  const now = new Date();
  const lastSent = JSON.parse(localStorage.getItem("lifeAdmin.lastSent") || "{}");

  state.reminders.filter(r => !r.completed).forEach(r => {
    const due = parseDue(r);
    const delta = due - now;

    if (delta <= 60000 && delta >= -15 * 60000 && !lastSent[r.id]) {
      getServiceWorkerRegistration().then(registration => registration?.showNotification(r.title, {
        body: `${r.category} · ${formatDue(r)}`,
        icon: "icons/icon-192.png",
        badge: "icons/icon-192.png",
        tag: `foreground-${r.id}`,
        data: { url: "./", reminderId: r.id }
      })).catch(console.error);
      lastSent[r.id] = Date.now();
    }
  });

  localStorage.setItem("lifeAdmin.lastSent", JSON.stringify(lastSent));
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", event => {
    if (event.data?.type === "LIFE_ADMIN_PUSH") previewNotificationTone(event.data.tone || "chime");
  });
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
initSupabase();


/* ---------- Life Admin 2.0 enhancements ---------- */
(function enhanceLifeAdmin() {
  const inboxKey = STORAGE_KEYS.inbox;
  const loadInbox = () => { try { return JSON.parse(localStorage.getItem(inboxKey)) || []; } catch { return []; } };
  state.inbox = state.inbox || loadInbox();
  state.calendarDate = state.calendarDate || new Date();

  function saveInbox() { localStorage.setItem(inboxKey, JSON.stringify(state.inbox)); }
  function navTo(section) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    const map = {home:'navHomeBtn', calendar:'navCalendarBtn', money:'navExpensesBtn'};
    $(map[section] || 'navHomeBtn')?.classList.add('active');
    if (section === 'calendar') $('calendarDialog')?.showModal();
    else if (section === 'money') document.querySelector('.money-dashboard')?.scrollIntoView({behavior:'smooth', block:'start'});
    else window.scrollTo({top:0, behavior:'smooth'});
  }

  window.lifeAdminEnhancedRenderReminders = function() {
    const list = $('reminderList'); if (!list) return;
    const filter = $('filterCategory')?.value || 'all';
    const reminders = state.reminders.filter(r => !r.completed && (filter === 'all' || r.category === filter)).sort((a,b)=>parseDue(a)-parseDue(b));
    if (!reminders.length) { list.innerHTML='<div class="empty-state">Nothing upcoming. You are all caught up.</div>'; return; }
    list.innerHTML = reminders.map(r => `<article class="reminder-card enhanced-card" data-id="${r.id}">
      <div class="reminder-main"><div class="reminder-title-row"><p class="reminder-title">${escapeHtml(r.title)}</p><span class="tag">${escapeHtml(r.category)}</span>${r.priority==='high'?'<span class="tag high">High</span>':''}</div>
      <p class="reminder-meta">${formatDue(r)}${r.repeat!=='none'?` · ${repeatLabel(r.repeat)}`:''}${r.amount?` · ${money(r.amount)}`:''}</p>
      ${r.location?`<p class="reminder-notes">📍 ${escapeHtml(r.location)}</p>`:''}${r.notes?`<p class="reminder-notes">${escapeHtml(r.notes)}</p>`:''}${r.attachment?`<p class="reminder-notes"><a href="${escapeHtml(r.attachment)}" target="_blank" rel="noopener">Open attachment</a></p>`:''}</div>
      <div class="card-actions"><button class="action-btn" onclick="completeReminder('${r.id}')">Done</button><button class="action-btn" onclick="editReminder('${r.id}')">Edit</button><button class="action-btn danger" onclick="deleteReminder('${r.id}')">Delete</button></div></article>`).join('');
  };
  window.lifeAdminEnhancedRenderExpenses = function() {
    const list=$('expenseList'); if(!list) return;
    const expenses=[...state.expenses].sort((a,b)=>new Date(a.nextDate)-new Date(b.nextDate));
    list.innerHTML=expenses.length?expenses.map(e=>`<article class="expense-card"><div><strong>${escapeHtml(e.name)}</strong><small>${capitalize(e.frequency)} · ${escapeHtml(e.category||'Other')} · ${e.status==='paid'?'Paid':'Upcoming'} · next ${new Date(e.nextDate+'T00:00:00').toLocaleDateString('en-ZA',{day:'numeric',month:'short'})}</small>${e.notes?`<p class="reminder-notes">${escapeHtml(e.notes)}</p>`:''}</div><div class="expense-amount">${money(e.amount)}<div><button class="action-btn" onclick="editExpense('${e.id}')">Edit</button><button class="action-btn danger" onclick="deleteExpense('${e.id}')">Delete</button></div></div></article>`).join(''):'<div class="empty-state">No bills or subscriptions yet.</div>';
    const monthly=state.expenses.reduce((sum,e)=>sum+monthlyEquivalent(e),0), yearly=state.expenses.reduce((sum,e)=>sum+yearlyEquivalent(e),0);
    $('expenseMonthlyTotal').textContent=money(monthly); $('expenseYearlyTotal').textContent=money(yearly);
  };
  window.lifeAdminEnhancedRender = function(){ window.lifeAdminEnhancedRenderReminders(); renderCompleted(); window.lifeAdminEnhancedRenderExpenses(); renderStats(); renderTodayTimeline(); renderMoneyDashboard(); renderInbox(); updateNotificationButton(); updateAccountUI(); };

  function renderTodayTimeline(){
    const el=$('todayTimeline'); if(!el) return; const now=new Date(), today=localDateString(now); const items=state.reminders.filter(r=>!r.completed&&r.dueDate===today).sort((a,b)=>parseDue(a)-parseDue(b));
    $('todayDateLabel').textContent=now.toLocaleDateString('en-ZA',{weekday:'short',day:'numeric',month:'short'});
    el.innerHTML=items.length?items.map(r=>`<div class="timeline-item"><span class="timeline-time">${escapeHtml(r.dueTime||'09:00')}</span><div><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.category)}${r.location?' · 📍 '+escapeHtml(r.location):''}</small></div><button class="action-btn" onclick="completeReminder('${r.id}')">Done</button></div>`).join(''):'<div class="empty-state">Your day is clear. Add something when you need to remember it.</div>';
  }
  function renderMoneyDashboard(){
    if(!$('moneyMonthly')) return; const monthly=state.expenses.reduce((s,e)=>s+monthlyEquivalent(e),0), yearly=state.expenses.reduce((s,e)=>s+yearlyEquivalent(e),0), now=new Date(), end=new Date(now); end.setDate(end.getDate()+30);
    const due=state.expenses.filter(e=>{const d=new Date(e.nextDate+'T00:00:00');return d>=new Date(now.getFullYear(),now.getMonth(),now.getDate())&&d<=end}).sort((a,b)=>new Date(a.nextDate)-new Date(b.nextDate));
    $('moneyMonthly').textContent=money(monthly); $('moneyYearly').textContent=money(yearly); $('moneyNext30').textContent=money(due.reduce((s,e)=>s+Number(e.amount||0),0));
    $('moneyDueList').innerHTML=due.length?due.slice(0,6).map(e=>`<div class="money-due-row"><span>${escapeHtml(e.name)}<small>${new Date(e.nextDate+'T00:00:00').toLocaleDateString('en-ZA',{day:'numeric',month:'short'})}</small></span><strong>${money(e.amount)}</strong></div>`).join(''):'<div class="empty-state">No payments due in the next 30 days.</div>';
  }
  function renderInbox(){
    const el=$('inboxList'); if(!el) return; const items=state.inbox.slice(-6).reverse();
    el.innerHTML=items.length?items.map(i=>`<div class="inbox-row"><span>${escapeHtml(i.text)}</span><div><button class="action-btn" onclick="convertInbox('${i.id}')">Make reminder</button><button class="action-btn danger" onclick="removeInbox('${i.id}')">×</button></div></div>`).join(''):'<div class="empty-state">Capture ideas here without filling in a form.</div>';
  }
  window.removeInbox=id=>{state.inbox=state.inbox.filter(i=>i.id!==id);saveInbox();renderInbox();};
  window.convertInbox=id=>{const i=state.inbox.find(x=>x.id===id);if(!i)return;$('title').value=i.text;$('dueDate').value=localDateString();$('reminderDialog').showModal();removeInbox(id);};
  window.editReminder=id=>{const r=state.reminders.find(x=>x.id===id);if(!r)return;$('title').value=r.title;$('category').value=r.category;$('priority').value=r.priority;$('dueDate').value=r.dueDate;$('dueTime').value=r.dueTime||'09:00';$('repeat').value=r.repeat||'none';$('amount').value=r.amount??'';$('notes').value=r.notes||'';$('location').value=r.location||'';$('remindBefore').value=String(r.remindBefore||0);$('attachment').value=r.attachment||'';reminderForm.dataset.editId=id;$('reminderDialog').showModal();};
  window.editExpense=id=>{const e=state.expenses.find(x=>x.id===id);if(!e)return;$('expenseName').value=e.name;$('expenseAmount').value=e.amount;$('expenseFrequency').value=e.frequency;$('expenseDate').value=e.nextDate;$('expenseCategory').value=e.category||'Other';$('expenseStatus').value=e.status||'unpaid';$('expenseNotes').value=e.notes||'';expenseForm.dataset.editId=id;$('expenseDialog').showModal();};
  function setupCalendar(){
    const d=state.calendarDate, y=d.getFullYear(), m=d.getMonth(), first=new Date(y,m,1), days=new Date(y,m+1,0).getDate(), start=(first.getDay()+6)%7; $('calendarMonthLabel').textContent=d.toLocaleDateString('en-ZA',{month:'long',year:'numeric'});
    const names=['Mon','Tue','Wed','Thu','Fri','Sat','Sun']; let out=names.map(n=>`<div class="calendar-weekday">${n}</div>`).join(''); for(let i=0;i<start;i++)out+='<div class="calendar-cell muted"></div>'; for(let day=1;day<=days;day++){const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`,count=state.reminders.filter(r=>r.dueDate===ds&&!r.completed).length;out+=`<button class="calendar-cell ${ds===localDateString()?'today':''}" data-date="${ds}" type="button"><b>${day}</b>${count?`<i>${count}</i>`:''}</button>`;} $('calendarGrid').innerHTML=out;
    $('calendarGrid').querySelectorAll('[data-date]').forEach(b=>b.onclick=()=>showCalendarDay(b.dataset.date)); showCalendarDay(localDateString(d));
  }
  function showCalendarDay(ds){const items=state.reminders.filter(r=>r.dueDate===ds&&!r.completed).sort((a,b)=>parseDue(a)-parseDue(b));$('calendarDayItems').innerHTML=`<h3>${new Date(ds+'T12:00:00').toLocaleDateString('en-ZA',{weekday:'long',day:'numeric',month:'long'})}</h3>`+(items.length?items.map(r=>`<div class="calendar-item"><span>${escapeHtml(r.dueTime||'09:00')}</span><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.category)}</small></div>`).join(''):'<div class="empty-state">Nothing scheduled.</div>');}

  function openCalendar(){state.calendarDate=new Date();setupCalendar();$('calendarDialog').showModal();}
  $('openCalendarBtn')?.addEventListener('click',openCalendar); $('navCalendarBtn')?.addEventListener('click',openCalendar); $('calendarPrev')?.addEventListener('click',()=>{state.calendarDate.setMonth(state.calendarDate.getMonth()-1);setupCalendar();}); $('calendarNext')?.addEventListener('click',()=>{state.calendarDate.setMonth(state.calendarDate.getMonth()+1);setupCalendar();});
  $('navHomeBtn')?.addEventListener('click',()=>navTo('home')); $('navExpensesBtn')?.addEventListener('click',()=>navTo('money')); $('navMoreBtn')?.addEventListener('click',()=>$('moreDialog').showModal()); $('moneyAddBtn')?.addEventListener('click',openExpenseDialog);
  $('todayBtn')?.addEventListener('click',()=>{window.scrollTo({top:0,behavior:'smooth'});});
  $('globalSearch')?.addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase(), box=$('searchResults'); if(!q){box.classList.add('hidden');return;} const rs=state.reminders.filter(r=>(r.title+' '+r.category+' '+(r.notes||'')).toLowerCase().includes(q)).slice(0,8), es=state.expenses.filter(x=>(x.name+' '+(x.category||'')+' '+(x.notes||'')).toLowerCase().includes(q)).slice(0,8); box.innerHTML=[...rs.map(r=>`<button onclick="document.querySelector('[data-id=\\"${r.id}\\"]').scrollIntoView({behavior:'smooth'})"><b>${escapeHtml(r.title)}</b><span>${escapeHtml(r.category)} · ${formatDue(r)}</span></button>`),...es.map(e=>`<button onclick="document.querySelector('.money-dashboard').scrollIntoView({behavior:'smooth'})"><b>${escapeHtml(e.name)}</b><span>${money(e.amount)} · ${escapeHtml(e.category||'Expense')}</span></button>`)].join('')||'<div class="empty-state">No matches found.</div>'; box.classList.remove('hidden');});
  $('inboxAddBtn')?.addEventListener('click',()=>{const text=$('inboxInput').value.trim();if(!text)return;state.inbox.push({id:uid(),text,createdAt:new Date().toISOString()});saveInbox();$('inboxInput').value='';renderInbox();}); $('inboxInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')$('inboxAddBtn').click();});
  $('moreNotifications')?.addEventListener('click',()=>{$('moreDialog').close();requestNotifications();}); $('moreAppearance')?.addEventListener('click',()=>{$('moreDialog').close();openAppearanceDialog();}); $('moreAccount')?.addEventListener('click',()=>{$('moreDialog').close();$('accountDialog').showModal();}); $('moreInstall')?.addEventListener('click',()=>{$('moreDialog').close();showInstallDialog();}); $('moreCompleted')?.addEventListener('click',()=>{$('moreDialog').close();document.querySelector('.completed-panel')?.scrollIntoView({behavior:'smooth'});});
  $('moreExport')?.addEventListener('click',()=>{const payload={exportedAt:new Date().toISOString(),reminders:state.reminders,expenses:state.expenses,inbox:state.inbox,appearance:state.appearance};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`life-admin-backup-${localDateString()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});

  // Enhance recurring date rollover and reminder-before semantics in local foreground fallback.
  const originalCheck=checkDueNotifications; window.checkDueNotifications=async function(){try{const now=new Date();state.reminders.filter(r=>!r.completed).forEach(r=>{if(r.remindBefore){const due=parseDue(r), target=new Date(due.getTime()-Number(r.remindBefore)*60000); if(now>=target&&now<=new Date(target.getTime()+60000)){const sent=JSON.parse(localStorage.getItem('lifeAdmin.lastSent')||'{}');if(!sent['pre_'+r.id]){getServiceWorkerRegistration().then(reg=>reg?.showNotification(r.title,{body:`Starts ${formatDue(r)}${r.location?' · '+r.location:''}`,icon:'icons/icon-192.png',badge:'icons/icon-192.png',tag:'pre-'+r.id,data:{url:'./',reminderId:r.id}}));sent['pre_'+r.id]=Date.now();localStorage.setItem('lifeAdmin.lastSent',JSON.stringify(sent));}}}});}catch(e){console.warn(e);} return originalCheck();};
  // Re-render after enhancements have loaded.
  setTimeout(()=>window.lifeAdminEnhancedRender(),0);
})();
