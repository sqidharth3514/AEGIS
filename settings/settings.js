// Aegis - Settings & Site Profile Manager (Manifest V3)

(() => {
  "use strict";

  const SITE_STATES_KEY = "aegisSiteStates";
  const DEFAULT_ENABLE_KEY = "defaultEnable";
  const PRESETS_KEY = "aegisGlobalPresets";

  // Elements
  const defaultEnableEl = document.getElementById("defaultEnable");
  const defaultFontFamilyEl = document.getElementById("defaultFontFamily");
  const defaultLineHeightEl = document.getElementById("defaultLineHeight");
  const defaultRulerEl = document.getElementById("defaultRuler");
  const siteListEl = document.getElementById("siteList");
  const siteSearchInput = document.getElementById("siteSearchInput");
  const clearAllSitesBtn = document.getElementById("clearAllSitesBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const importFileInput = document.getElementById("importFileInput");
  const toastEl = document.getElementById("toast");
  const toastMessageEl = document.getElementById("toastMessage");

  let toastTimer = null;
  function showToast(msg) {
    if (!toastEl || !toastMessageEl) return;
    toastMessageEl.textContent = msg;
    clearTimeout(toastTimer);
    toastEl.classList.add("show");
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2500);
  }

  // ======================================================
  // LOAD PREFERENCES
  // ======================================================
  async function loadPreferences() {
    const res = await chrome.storage.local.get([DEFAULT_ENABLE_KEY, PRESETS_KEY]);
    if (defaultEnableEl) {
      defaultEnableEl.checked = Boolean(res[DEFAULT_ENABLE_KEY]);
    }

    const presets = res[PRESETS_KEY] || {};
    if (defaultFontFamilyEl && presets.fontFamily) {
      defaultFontFamilyEl.value = presets.fontFamily;
    }
    if (defaultLineHeightEl) {
      defaultLineHeightEl.checked = Boolean(presets.lineHeight);
    }
    if (defaultRulerEl) {
      defaultRulerEl.checked = Boolean(presets.readingRuler);
    }
  }

  // ======================================================
  // SAVE PREFERENCES
  // ======================================================
  defaultEnableEl?.addEventListener("change", async () => {
    await chrome.storage.local.set({ [DEFAULT_ENABLE_KEY]: defaultEnableEl.checked });
    showToast(`Default on new sites: ${defaultEnableEl.checked ? "Enabled" : "Disabled"}`);
  });

  async function savePresets() {
    const presets = {
      fontFamily: defaultFontFamilyEl?.value || "default",
      lineHeight: defaultLineHeightEl?.checked || false,
      readingRuler: defaultRulerEl?.checked || false
    };
    await chrome.storage.local.set({ [PRESETS_KEY]: presets });
    showToast("Global presets updated");
  }

  defaultFontFamilyEl?.addEventListener("change", savePresets);
  defaultLineHeightEl?.addEventListener("change", savePresets);
  defaultRulerEl?.addEventListener("change", savePresets);

  // ======================================================
  // SITE PROFILES MANAGER
  // ======================================================
  let allSiteEntries = [];

  async function loadSiteProfiles() {
    const res = await chrome.storage.local.get([SITE_STATES_KEY]);
    const siteStates = res[SITE_STATES_KEY] || {};
    allSiteEntries = Object.entries(siteStates);
    renderSiteList();
  }

  function renderSiteList() {
    if (!siteListEl) return;
    const query = (siteSearchInput?.value || "").trim().toLowerCase();
    const filtered = allSiteEntries.filter(([domain]) => domain.toLowerCase().includes(query));

    if (!filtered.length) {
      siteListEl.innerHTML = `<div class="empty-state">${
        allSiteEntries.length === 0 ? "No customized site profiles yet." : "No matching websites found."
      }</div>`;
      return;
    }

    siteListEl.innerHTML = "";
    filtered.forEach(([domain, config]) => {
      const item = document.createElement("div");
      item.className = "site-item";

      const activeTools = Object.entries(config)
        .filter(([k, v]) => v === true || (k === "colorBlindMode" && v !== "off") || (k === "colorTint" && v !== "off"))
        .length;

      item.innerHTML = `
        <div>
          <div class="site-domain">${domain}</div>
          <div class="site-meta">${activeTools} active enhancement${activeTools === 1 ? "" : "s"}</div>
        </div>
        <button class="danger-btn-sm reset-site-btn" data-domain="${domain}" title="Reset settings for ${domain}">Reset</button>
      `;

      item.querySelector(".reset-site-btn")?.addEventListener("click", () => resetSite(domain));
      siteListEl.appendChild(item);
    });
  }

  async function resetSite(domain) {
    const res = await chrome.storage.local.get([SITE_STATES_KEY]);
    const siteStates = res[SITE_STATES_KEY] || {};
    delete siteStates[domain];
    await chrome.storage.local.set({ [SITE_STATES_KEY]: siteStates });
    showToast(`Reset settings for ${domain}`);
    await loadSiteProfiles();
  }

  clearAllSitesBtn?.addEventListener("click", async () => {
    if (!allSiteEntries.length) {
      showToast("No site profiles to clear");
      return;
    }
    if (confirm("Are you sure you want to clear all customized site profiles?")) {
      await chrome.storage.local.remove([SITE_STATES_KEY]);
      showToast("All site profiles cleared");
      await loadSiteProfiles();
    }
  });

  siteSearchInput?.addEventListener("input", renderSiteList);

  // ======================================================
  // BACKUP & RESTORE
  // ======================================================
  exportBtn?.addEventListener("click", async () => {
    const allData = await chrome.storage.local.get(null);
    const backup = {
      app: "Aegis",
      version: "1.2.0",
      exportedAt: new Date().toISOString(),
      data: allData
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aegis-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Settings exported successfully");
  });

  importBtn?.addEventListener("click", () => {
    if (!importFileInput) return;
    importFileInput.value = "";
    importFileInput.click();
  });

  importFileInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed.data) throw new Error("Invalid backup structure");
      await chrome.storage.local.set(parsed.data);
      showToast("Backup restored successfully!");
      await loadPreferences();
      await loadSiteProfiles();
    } catch {
      showToast("Error: Invalid JSON backup file");
    }
  });

  // ======================================================
  // INIT
  // ======================================================
  document.addEventListener("DOMContentLoaded", async () => {
    await loadPreferences();
    await loadSiteProfiles();
  });
})();