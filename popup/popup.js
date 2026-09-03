// Aegis - Popup Controller (Manifest V3)

(() => {
  "use strict";

  // ======================================================
  // UI REFERENCES
  // ======================================================
  const ui = {
    // Header & Status
    statusBadge: document.getElementById("statusBadge"),
    enableSwitch: document.getElementById("enableSwitch"),

    // Dashboard
    currentSite: document.getElementById("currentSite"),
    scoreNumber: document.getElementById("scoreNumber"),
    scoreLabel: document.getElementById("scoreLabel"),
    progressBar: document.getElementById("progressBar"),
    activeCount: document.getElementById("activeCount"),
    enabledFeatures: document.getElementById("enabledFeatures"),
    quickAuditBtn: document.getElementById("quickAuditBtn"),

    // Audio / TTS
    ttsPlayBtn: document.getElementById("ttsPlayBtn"),
    ttsStopBtn: document.getElementById("ttsStopBtn"),
    ttsLabel: document.getElementById("ttsLabel"),
    ttsIcon: document.getElementById("ttsIcon"),

    // Typography
    decreaseFontBtn: document.getElementById("decreaseFontBtn"),
    increaseFontBtn: document.getElementById("increaseFontBtn"),
    fontFamilySelect: document.getElementById("fontFamilySelect"),
    lineHeightSwitch: document.getElementById("lineHeightSwitch"),
    letterSpacingSwitch: document.getElementById("letterSpacingSwitch"),
    wordSpacingSwitch: document.getElementById("wordSpacingSwitch"),

    // Visuals & Contrast
    darkModeSwitch: document.getElementById("darkModeSwitch"),
    contrastSwitch: document.getElementById("contrastSwitch"),
    colorTintSelect: document.getElementById("colorTintSelect"),
    colorBlindBtn: document.getElementById("colorBlindBtn"),
    colorBlindLabel: document.getElementById("colorBlindLabel"),

    // Focus & Reading Aids
    readingModeSwitch: document.getElementById("readingModeSwitch"),
    focusModeSwitch: document.getElementById("focusModeSwitch"),
    readingRulerSwitch: document.getElementById("readingRulerSwitch"),
    highlightLinksSwitch: document.getElementById("highlightLinksSwitch"),
    highlightHeadingsSwitch: document.getElementById("highlightHeadingsSwitch"),

    // Accessibility Audit
    scanAccessibilityBtn: document.getElementById("scanAccessibilityBtn"),
    analysisResults: document.getElementById("analysisResults"),

    // Backup, Settings & Reset
    exportBackupBtn: document.getElementById("exportBackupBtn"),
    restoreBackupBtn: document.getElementById("restoreBackupBtn"),
    restoreFileInput: document.getElementById("restoreFileInput"),
    openSettingsBtn: document.getElementById("openSettingsBtn"),
    resetBtn: document.getElementById("resetBtn"),

    // Toast & Onboarding
    toast: document.getElementById("toast"),
    toastMessage: document.getElementById("toastMessage"),
    welcomeScreen: document.getElementById("welcomeScreen"),
    getStartedBtn: document.getElementById("getStartedBtn")
  };

  // State Mirror
  const state = {
    aegisEnabled: false,
    aegisFontScale: 1,
    fontFamily: "default",
    darkModeOn: false,
    highContrastOn: false,
    lineHeightOn: false,
    letterSpacingOn: false,
    wordSpacingOn: false,
    readingModeOn: false,
    focusModeOn: false,
    readingRulerOn: false,
    colorTint: "off",
    colorBlindMode: "off",
    highlightLinksOn: false,
    highlightHeadingsOn: false
  };

  let lastAuditScore = null;

  // ======================================================
  // HELPERS & TOAST
  // ======================================================
  let toastTimer = null;
  function showToast(message) {
    if (!ui.toast || !ui.toastMessage) return;
    ui.toastMessage.textContent = message;
    clearTimeout(toastTimer);
    ui.toast.classList.add("show");
    toastTimer = setTimeout(() => {
      ui.toast.classList.remove("show");
    }, 2400);
  }

  function isRestrictedUrl(url) {
    if (!url) return true;
    return /^(chrome|edge|about|devtools|chrome-extension):\/\//i.test(url);
  }

  /**
   * Safely sends a message to the active tab, handling restricted tabs gracefully.
   */
  function sendToActiveTab(message, callback = () => {}) {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs || !tabs.length) return callback(null);
      const tab = tabs[0];

      if (isRestrictedUrl(tab.url)) {
        updateDashboardForRestrictedTab();
        return callback(null);
      }

      try {
        chrome.tabs.sendMessage(tab.id, message, (response) => {
          if (chrome.runtime.lastError) {
            // Attempt injection if script isn't loaded yet
            chrome.scripting.executeScript(
              {
                target: { tabId: tab.id },
                files: ["content/content.js"]
              },
              () => {
                if (chrome.runtime.lastError) return callback(null);
                chrome.tabs.sendMessage(tab.id, message, (retryRes) => {
                  void chrome.runtime.lastError;
                  callback(retryRes);
                });
              }
            );
          } else {
            callback(response);
          }
        });
      } catch (err) {
        console.warn("[Aegis Popup] Message error:", err);
        callback(null);
      }
    });
  }

  function updateDashboardForRestrictedTab() {
    if (ui.currentSite) ui.currentSite.textContent = "Browser System Page";
    if (ui.scoreNumber) ui.scoreNumber.textContent = "N/A";
    if (ui.scoreLabel) ui.scoreLabel.textContent = "LOCKED";
    if (ui.progressBar) ui.progressBar.style.width = "0%";
    if (ui.enabledFeatures) {
      ui.enabledFeatures.innerHTML = `<span class="feature-pill none">Extensions restricted here</span>`;
    }
  }

  // ======================================================
  // TTS UI UPDATES
  // ======================================================
  function updateTtsUI(ttsState) {
    if (!ui.ttsPlayBtn) return;
    if (ttsState?.isSpeaking) {
      ui.ttsPlayBtn.classList.add("speaking");
      if (ttsState.isPaused) {
        if (ui.ttsLabel) ui.ttsLabel.textContent = "Resume Speech";
        if (ui.ttsIcon) ui.ttsIcon.textContent = "▶";
      } else {
        if (ui.ttsLabel) ui.ttsLabel.textContent = "Pause Speech";
        if (ui.ttsIcon) ui.ttsIcon.textContent = "⏸";
      }
    } else {
      ui.ttsPlayBtn.classList.remove("speaking");
      if (ui.ttsLabel) ui.ttsLabel.textContent = "Listen to Page";
      if (ui.ttsIcon) ui.ttsIcon.textContent = "🔊";
    }
  }

  // ======================================================
  // UI REFRESH
  // ======================================================
  function refreshUI() {
    // Status Badge
    if (ui.statusBadge) {
      ui.statusBadge.textContent = state.aegisEnabled ? "ACTIVE" : "OFF";
      ui.statusBadge.classList.toggle("active", state.aegisEnabled);
    }

    // Switches
    const switchBindings = [
      [ui.enableSwitch, state.aegisEnabled],
      [ui.darkModeSwitch, state.darkModeOn],
      [ui.contrastSwitch, state.highContrastOn],
      [ui.readingModeSwitch, state.readingModeOn],
      [ui.focusModeSwitch, state.focusModeOn],
      [ui.readingRulerSwitch, state.readingRulerOn],
      [ui.lineHeightSwitch, state.lineHeightOn],
      [ui.letterSpacingSwitch, state.letterSpacingOn],
      [ui.wordSpacingSwitch, state.wordSpacingOn],
      [ui.highlightLinksSwitch, state.highlightLinksOn],
      [ui.highlightHeadingsSwitch, state.highlightHeadingsOn]
    ];
    switchBindings.forEach(([el, val]) => {
      if (el) el.checked = Boolean(val);
    });

    // Font Scale
    if (ui.increaseFontBtn) {
      const pct = Math.round((state.aegisFontScale || 1) * 100);
      ui.increaseFontBtn.textContent = `A+ (${pct}%)`;
    }

    // Font Family Select
    if (ui.fontFamilySelect && state.fontFamily) {
      ui.fontFamilySelect.value = state.fontFamily;
    }

    // Color Tint Select
    if (ui.colorTintSelect && state.colorTint) {
      ui.colorTintSelect.value = state.colorTint;
    }

    // Color Blind Button
    if (ui.colorBlindLabel) {
      const mode = (state.colorBlindMode || "off").toUpperCase();
      ui.colorBlindLabel.textContent = `🎨 Color Blind: ${mode}`;
    }

    updateDashboard();
  }

  function updateDashboard() {
    // Current Site
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs?.length || !ui.currentSite) return;
      const tab = tabs[0];
      if (isRestrictedUrl(tab.url)) {
        return updateDashboardForRestrictedTab();
      }
      try {
        ui.currentSite.textContent = new URL(tab.url).hostname;
      } catch {
        ui.currentSite.textContent = "Active Webpage";
      }
    });

    // Enabled Features Count & List
    const featureMap = [
      [state.aegisEnabled, "Aegis Enabled"],
      [state.darkModeOn, "Dark Mode"],
      [state.highContrastOn, "High Contrast"],
      [state.readingModeOn, "Reader View"],
      [state.focusModeOn, "Focus Mode"],
      [state.readingRulerOn, "Reading Ruler"],
      [state.lineHeightOn, "Line Spacing"],
      [state.letterSpacingOn, "Letter Spacing"],
      [state.wordSpacingOn, "Word Spacing"],
      [state.fontFamily !== "default", `Font: ${state.fontFamily}`],
      [state.colorTint !== "off", `Tint: ${state.colorTint}`],
      [state.colorBlindMode !== "off", `Color: ${state.colorBlindMode}`],
      [state.highlightLinksOn, "Links Highlighted"],
      [state.highlightHeadingsOn, "Headings Highlighted"]
    ];

    const activeList = featureMap.filter(([isActive]) => isActive).map(([, name]) => name);

    if (ui.activeCount) {
      ui.activeCount.textContent = activeList.length;
    }

    if (ui.enabledFeatures) {
      ui.enabledFeatures.innerHTML = activeList.length
        ? activeList.map((f) => `<span class="feature-pill">${f}</span>`).join("")
        : `<span class="feature-pill none">None Active</span>`;
    }

    // Set progress bar to active features ratio if audit hasn't run yet
    if (lastAuditScore === null && ui.progressBar) {
      const activePct = Math.min(100, Math.round((activeList.length / 10) * 100));
      ui.progressBar.style.width = `${activePct}%`;
    }
  }

  function applyState(newState) {
    if (!newState) return;
    Object.assign(state, newState);
    refreshUI();
  }

  // ======================================================
  // ACCESSIBILITY SCANNER
  // ======================================================
  function runAccessibilityScan() {
    if (!ui.analysisResults) return;
    ui.analysisResults.innerHTML = `
      <div class="analysis-item placeholder">
        <span>Analyzing page structure & WCAG guidelines... ⏳</span>
      </div>
    `;

    sendToActiveTab({ type: "AEGIS_SCAN_ACCESSIBILITY" }, (report) => {
      if (!report) {
        ui.analysisResults.innerHTML = `
          <div class="analysis-item placeholder">
            <span class="analysis-bad">Unable to scan page (Restricted or loading)</span>
          </div>
        `;
        return;
      }

      lastAuditScore = report.score;

      // Update Audit Score Circle
      if (ui.scoreNumber) ui.scoreNumber.textContent = `${report.score}%`;
      if (ui.scoreLabel) ui.scoreLabel.textContent = "SCORE";
      if (ui.progressBar) ui.progressBar.style.width = `${report.score}%`;

      const scoreCircle = document.querySelector(".score-circle");
      if (scoreCircle) {
        scoreCircle.classList.remove("good", "warning", "bad");
        if (report.score >= 85) scoreCircle.classList.add("good");
        else if (report.score >= 65) scoreCircle.classList.add("warning");
        else scoreCircle.classList.add("bad");
      }

      const rows = [
        { label: "Images", count: report.images.issues, total: report.images.total, issue: "Missing Alt Text" },
        { label: "Headings", count: report.headings.issues, total: report.headings.total, issue: "Skipped Levels / Missing H1" },
        { label: "Buttons", count: report.buttons.issues, total: report.buttons.total, issue: "Missing Label" },
        { label: "Links", count: report.links.issues, total: report.links.total, issue: "Empty / Missing Label" },
        { label: "Forms", count: report.forms.issues, total: report.forms.total, issue: "Missing Associated Label" }
      ];

      ui.analysisResults.innerHTML = rows
        .map((r) => {
          const isGood = r.count === 0;
          const statusClass = isGood ? "analysis-good" : r.count <= 2 ? "analysis-warning" : "analysis-bad";
          const statusText = isGood ? "✓ Compliant" : `${r.count} ${r.issue}`;
          return `
            <div class="analysis-item">
              <span>${r.label} <small>(${r.total})</small></span>
              <span class="${statusClass}">${statusText}</span>
            </div>
          `;
        })
        .join("");
    });
  }

  // ======================================================
  // EVENT BINDINGS
  // ======================================================

  // Switches
  const switchActions = [
    [ui.enableSwitch, "AEGIS_TOGGLE_ENABLED"],
    [ui.darkModeSwitch, "AEGIS_TOGGLE_DARK_MODE"],
    [ui.contrastSwitch, "AEGIS_TOGGLE_HIGH_CONTRAST"],
    [ui.readingModeSwitch, "AEGIS_TOGGLE_READING_MODE"],
    [ui.focusModeSwitch, "AEGIS_TOGGLE_FOCUS_MODE"],
    [ui.readingRulerSwitch, "AEGIS_TOGGLE_READING_RULER"],
    [ui.lineHeightSwitch, "AEGIS_TOGGLE_LINE_HEIGHT"],
    [ui.letterSpacingSwitch, "AEGIS_TOGGLE_LETTER_SPACING"],
    [ui.wordSpacingSwitch, "AEGIS_TOGGLE_WORD_SPACING"],
    [ui.highlightLinksSwitch, "AEGIS_TOGGLE_HIGHLIGHT_LINKS"],
    [ui.highlightHeadingsSwitch, "AEGIS_TOGGLE_HIGHLIGHT_HEADINGS"]
  ];

  switchActions.forEach(([el, type]) => {
    el?.addEventListener("change", () => {
      sendToActiveTab({ type }, (res) => {
        applyState(res);
        showToast("Setting updated");
      });
    });
  });

  // Font Scaling
  ui.increaseFontBtn?.addEventListener("click", () => {
    sendToActiveTab({ type: "AEGIS_ADJUST_FONT_SCALE", delta: 0.05 }, (res) => {
      applyState(res);
      showToast("Font size increased");
    });
  });

  ui.decreaseFontBtn?.addEventListener("click", () => {
    sendToActiveTab({ type: "AEGIS_ADJUST_FONT_SCALE", delta: -0.05 }, (res) => {
      applyState(res);
      showToast("Font size decreased");
    });
  });

  // Dropdowns
  ui.fontFamilySelect?.addEventListener("change", (e) => {
    const family = e.target.value;
    sendToActiveTab({ type: "AEGIS_SET_FONT_FAMILY", family }, (res) => {
      applyState(res);
      showToast(`Font: ${family}`);
    });
  });

  ui.colorTintSelect?.addEventListener("change", (e) => {
    const tint = e.target.value;
    sendToActiveTab({ type: "AEGIS_SET_COLOR_TINT", tint }, (res) => {
      applyState(res);
      showToast(`Color Tint: ${tint}`);
    });
  });

  // Color Blind Mode Cycle
  ui.colorBlindBtn?.addEventListener("click", () => {
    sendToActiveTab({ type: "AEGIS_CYCLE_COLOR_BLIND_MODE" }, (res) => {
      applyState(res);
      showToast("Color blind mode cycled");
    });
  });

  // Text-To-Speech Controls (Native Chrome TTS Engine via Background)
  ui.ttsPlayBtn?.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs?.[0]?.id || null;
      chrome.runtime.sendMessage({ type: "AEGIS_TTS_TOGGLE", tabId }, (res) => {
        updateTtsUI(res);
      });
    });
  });

  ui.ttsStopBtn?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "AEGIS_TTS_STOP" }, (res) => {
      updateTtsUI(res);
      showToast("Speech stopped");
    });
  });

  // Audit Buttons
  ui.scanAccessibilityBtn?.addEventListener("click", runAccessibilityScan);
  ui.quickAuditBtn?.addEventListener("click", runAccessibilityScan);

  // Reset
  ui.resetBtn?.addEventListener("click", () => {
    if (confirm("Reset all Aegis accessibility settings for this website?")) {
      sendToActiveTab({ type: "AEGIS_RESET_CURRENT_SITE" }, (res) => {
        applyState(res);
        showToast("Site settings reset to default");
      });
    }
  });

  // Options Page
  ui.openSettingsBtn?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // Backup & Restore
  ui.exportBackupBtn?.addEventListener("click", () => {
    chrome.storage.local.get(null, (data) => {
      const payload = {
        app: "Aegis",
        version: "1.2.1",
        exportedAt: new Date().toISOString(),
        data
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aegis-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Backup exported successfully");
    });
  });

  ui.restoreBackupBtn?.addEventListener("click", () => {
    if (!ui.restoreFileInput) return;
    ui.restoreFileInput.value = "";
    ui.restoreFileInput.click();
  });

  ui.restoreFileInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed.data) throw new Error("Invalid format");
      chrome.storage.local.set(parsed.data, () => {
        showToast("Backup restored! Reloading...");
        setTimeout(() => location.reload(), 700);
      });
    } catch {
      showToast("Invalid backup file");
    }
  });

  // Welcome Onboarding
  chrome.storage.local.get(["aegisWelcomeDone"], (res) => {
    if (res.aegisWelcomeDone) {
      ui.welcomeScreen?.classList.add("hidden");
    }
  });

  ui.getStartedBtn?.addEventListener("click", () => {
    chrome.storage.local.set({ aegisWelcomeDone: true }, () => {
      ui.welcomeScreen?.classList.add("hidden");
      showToast("Welcome to Aegis! 🛡️");
    });
  });

  // ======================================================
  // INITIALIZATION & SYNC
  // ======================================================
  document.addEventListener("DOMContentLoaded", () => {
    // 1. Fetch initial Aegis state from active tab
    sendToActiveTab({ type: "AEGIS_GET_STATE" }, (res) => {
      if (res) applyState(res);
      // Fast audit scan on popup open
      setTimeout(runAccessibilityScan, 250);
    });

    // 2. Fetch TTS speech state from background
    chrome.runtime.sendMessage({ type: "AEGIS_TTS_GET_STATE" }, (res) => {
      if (res) updateTtsUI(res);
    });
  });

  // Listen for background or tab broadcasts
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "AEGIS_STATE_CHANGED" && message.state) {
      applyState(message.state);
    }
    if (message.type === "AEGIS_TTS_STATE_CHANGED" && message.state) {
      updateTtsUI(message.state);
    }
  });
})();