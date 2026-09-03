// Aegis - Content Script & Accessibility Engine (Manifest V3)

(() => {
  "use strict";

  const SITE_STATES_KEY = "aegisSiteStates";
  const DEFAULT_ENABLE_KEY = "defaultEnable";
  const COLOR_BLIND_MODES = ["off", "deuteranopia", "protanopia", "tritanopia", "achromatopsia"];
  const COLOR_TINTS = ["off", "sepia", "rose", "mint", "ice", "yellow"];

  // ======================================================
  // DOM References & State Variables
  // ======================================================
  let styleTag = null;
  let colorBlindSvg = null;
  let readerOverlay = null;
  let readingRulerEl = null;
  let tintOverlayEl = null;
  let ttsFloatingBar = null;
  let domObserver = null;
  let observerDebounce = null;
  let readerTheme = "light"; // light, sepia, dark, night

  const defaultState = {
    aegisEnabled: false,
    aegisFontScale: 1,
    fontFamily: "default", // default, dyslexic, sans, serif
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

  let state = { ...defaultState };

  const getSiteKey = () => location.hostname || location.host || "unknown-site";

  // ======================================================
  // STORAGE & BROADCASTING
  // ======================================================
  function notifyStateChanged() {
    chrome.runtime.sendMessage(
      {
        type: "AEGIS_STATE_CHANGED",
        state: { ...state }
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  }

  function persistSiteState() {
    chrome.storage.local.get([SITE_STATES_KEY], (res) => {
      const allStates = res[SITE_STATES_KEY] || {};
      allStates[getSiteKey()] = {
        aegisEnabled: state.aegisEnabled,
        aegisFontScale: state.aegisFontScale,
        fontFamily: state.fontFamily,
        darkModeOn: state.darkModeOn,
        highContrastOn: state.highContrastOn,
        lineHeightOn: state.lineHeightOn,
        letterSpacingOn: state.letterSpacingOn,
        wordSpacingOn: state.wordSpacingOn,
        readingModeOn: state.readingModeOn,
        focusModeOn: state.focusModeOn,
        readingRulerOn: state.readingRulerOn,
        colorTint: state.colorTint,
        colorBlindMode: state.colorBlindMode,
        highlightLinksOn: state.highlightLinksOn,
        highlightHeadingsOn: state.highlightHeadingsOn
      };
      chrome.storage.local.set({ [SITE_STATES_KEY]: allStates }, notifyStateChanged);
    });
  }

  // ======================================================
  // COLOR BLIND SVG FILTERS
  // ======================================================
  function ensureColorBlindFilters() {
    if (colorBlindSvg || !document.body) return;
    colorBlindSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    colorBlindSvg.id = "aegis-colorblind-filters";
    colorBlindSvg.setAttribute("aria-hidden", "true");
    colorBlindSvg.setAttribute("focusable", "false");
    colorBlindSvg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;left:-9999px;top:-9999px;";
    colorBlindSvg.innerHTML = `
      <defs>
        <filter id="aegis-filter-deuteranopia">
          <feColorMatrix type="matrix" values="0.625 0.700 -0.025 0 0 0.700 0.625 -0.025 0 0 0.000 0.075 0.925 0 0 0 0 0 1 0"/>
        </filter>
        <filter id="aegis-filter-protanopia">
          <feColorMatrix type="matrix" values="0.567 0.433 0.000 0 0 0.558 0.442 0.000 0 0 0.000 0.242 0.758 0 0 0 0 0 1 0"/>
        </filter>
        <filter id="aegis-filter-tritanopia">
          <feColorMatrix type="matrix" values="0.950 0.050 0.000 0 0 0.000 0.433 0.567 0 0 0.000 0.475 0.525 0 0 0 0 0 1 0"/>
        </filter>
      </defs>`;
    document.body.appendChild(colorBlindSvg);
  }

  function removeColorBlindFilters() {
    colorBlindSvg?.remove();
    colorBlindSvg = null;
  }

  // ======================================================
  // COLOR TINT OVERLAY (Visual Stress / Irlen Syndrome)
  // ======================================================
  const TINT_COLORS = {
    sepia: "rgba(244, 236, 216, 0.38)",
    rose: "rgba(255, 228, 230, 0.35)",
    mint: "rgba(209, 250, 229, 0.35)",
    ice: "rgba(224, 242, 254, 0.35)",
    yellow: "rgba(254, 240, 138, 0.38)"
  };

  function renderColorTint() {
    if (!state.aegisEnabled || state.colorTint === "off") {
      tintOverlayEl?.remove();
      tintOverlayEl = null;
      return;
    }
    if (!tintOverlayEl) {
      tintOverlayEl = document.createElement("div");
      tintOverlayEl.id = "aegis-tint-overlay";
      document.documentElement.appendChild(tintOverlayEl);
    }
    const color = TINT_COLORS[state.colorTint] || "transparent";
    tintOverlayEl.style.cssText = `
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 2147483645;
      background-color: ${color};
      mix-blend-mode: multiply;
      transition: background-color 0.2s ease;
    `;
  }

  // ======================================================
  // READING RULER (Focus Guide Line)
  // ======================================================
  function onRulerMouseMove(e) {
    if (!readingRulerEl) return;
    const rulerHeight = 36;
    const y = e.clientY - rulerHeight / 2;
    readingRulerEl.style.top = `${y}px`;
  }

  function renderReadingRuler() {
    if (!state.aegisEnabled || !state.readingRulerOn) {
      if (readingRulerEl) {
        window.removeEventListener("mousemove", onRulerMouseMove);
        readingRulerEl.remove();
        readingRulerEl = null;
      }
      return;
    }
    if (!readingRulerEl) {
      readingRulerEl = document.createElement("div");
      readingRulerEl.id = "aegis-reading-ruler";
      readingRulerEl.style.cssText = `
        position: fixed;
        left: 0;
        right: 0;
        height: 38px;
        pointer-events: none;
        z-index: 2147483646;
        background: rgba(198, 132, 44, 0.15);
        border-top: 2px solid #C6842C;
        border-bottom: 2px solid #C6842C;
        box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.22);
        transition: top 0.05s ease-out;
      `;
      document.documentElement.appendChild(readingRulerEl);
      window.addEventListener("mousemove", onRulerMouseMove, { passive: true });
    }
  }

  // ======================================================
  // TEXT-TO-SPEECH (TEXT EXTRACTION & ON-PAGE PLAYER)
  // ======================================================
  function extractPageText() {
    // 1. Prioritize user selection
    const selected = window.getSelection()?.toString()?.trim();
    if (selected && selected.length > 0) {
      return selected;
    }

    // 2. Reader View overlay content
    if (state.readingModeOn && readerContent) {
      const readerText = readerContent.innerText?.trim();
      if (readerText && readerText.length > 20) return readerText;
    }

    // 3. Main article container
    const preferred = document.querySelector("main, article, [role='main']");
    if (preferred) {
      const preferredText = preferred.innerText?.trim();
      if (preferredText && preferredText.length > 40) return preferredText;
    }

    // 4. Gather clean paragraphs & headings
    const textNodes = Array.from(
      document.querySelectorAll("h1, h2, h3, h4, p, li, blockquote")
    ).filter((el) => {
      return !el.closest("header, nav, footer, aside, [role='navigation'], [role='banner'], script, style, noscript, [aria-hidden='true']");
    });

    if (textNodes.length) {
      const compiled = textNodes
        .map((n) => n.innerText?.trim())
        .filter((t) => t && t.length > 10)
        .join("\n\n");
      if (compiled.length > 40) return compiled;
    }

    // 5. Fallback to body
    return (document.body.innerText || "").trim().slice(0, 15000);
  }

  function renderTtsFloatingBar(ttsState) {
    if (!ttsState || !ttsState.isSpeaking) {
      if (ttsFloatingBar) {
        ttsFloatingBar.remove();
        ttsFloatingBar = null;
      }
      return;
    }

    if (!ttsFloatingBar) {
      ttsFloatingBar = document.createElement("div");
      ttsFloatingBar.id = "aegis-tts-floating-bar";
      ttsFloatingBar.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        background: #1B1916;
        border: 1px solid #C6842C;
        border-radius: 40px;
        padding: 8px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
        color: #F4F1EA;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 600;
        user-select: none;
      `;
      document.documentElement.appendChild(ttsFloatingBar);
    }

    const isPaused = ttsState.isPaused;
    ttsFloatingBar.innerHTML = `
      <span style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:16px;">🔊</span>
        <span>${isPaused ? "Speech Paused" : "Reading Aloud..."}</span>
      </span>
      <button id="aegis-bar-toggle" style="background:#2B2722;color:#C6842C;border:1px solid rgba(198,132,44,0.4);border-radius:20px;padding:4px 10px;cursor:pointer;font-size:12px;font-weight:700;">
        ${isPaused ? "▶ Resume" : "⏸ Pause"}
      </button>
      <button id="aegis-bar-stop" style="background:#3F1D1D;color:#FCA5A5;border:1px solid rgba(239,68,68,0.3);border-radius:20px;padding:4px 10px;cursor:pointer;font-size:12px;font-weight:700;">
        ⏹ Stop
      </button>
    `;

    ttsFloatingBar.querySelector("#aegis-bar-toggle")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: isPaused ? "AEGIS_TTS_RESUME" : "AEGIS_TTS_PAUSE" });
    });

    ttsFloatingBar.querySelector("#aegis-bar-stop")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "AEGIS_TTS_STOP" });
    });
  }

  // ======================================================
  // READING MODE OVERLAY & OBSERVER
  // ======================================================
  function getBestReadingSource() {
    const preferred = document.querySelector("main, article, [role='main']");
    if (preferred) return preferred;

    const candidates = Array.from(document.body.children).filter(
      (el) => el.id !== "aegis-reader-overlay" && !["SCRIPT", "STYLE", "NOSCRIPT", "SVG"].includes(el.tagName)
    );
    if (!candidates.length) return document.body;

    return candidates.reduce((best, el) => {
      return (el.innerText || "").trim().length > (best.innerText || "").trim().length ? el : best;
    }, candidates[0]);
  }

  function cleanClone(source) {
    const clone = source.cloneNode(true);
    clone.querySelectorAll("script, style, noscript, iframe, canvas, svg, header, nav, aside, footer, form, button, input, select, textarea")
      .forEach((el) => el.remove());
    return clone;
  }

  function createReaderOverlay() {
    if (readerOverlay) return;
    readerOverlay = document.createElement("div");
    readerOverlay.id = "aegis-reader-overlay";
    readerOverlay.className = `aegis-reader-theme-${readerTheme}`;
    readerOverlay.innerHTML = `
      <div id="aegis-reader-toolbar">
        <div class="aegis-reader-tb-left">
          <button id="aegis-reader-close-btn" title="Exit Reading Mode (Esc)">✕ Exit</button>
          <div class="aegis-reader-stats" id="aegis-reader-stats">Reading Mode</div>
        </div>
        <div class="aegis-reader-tb-right">
          <button id="aegis-reader-tts-btn" title="Read Aloud">🔊 Listen</button>
          <div class="aegis-reader-themes">
            <button data-theme="light" class="theme-dot light active" title="Light Theme"></button>
            <button data-theme="sepia" class="theme-dot sepia" title="Sepia Theme"></button>
            <button data-theme="dark" class="theme-dot dark" title="Dark Theme"></button>
            <button data-theme="night" class="theme-dot night" title="OLED Night"></button>
          </div>
          <button id="aegis-reader-font-dec" title="Decrease Font">A−</button>
          <button id="aegis-reader-font-inc" title="Increase Font">A+</button>
        </div>
      </div>
      <div id="aegis-reader-shell">
        <h1 id="aegis-reader-title"></h1>
        <div id="aegis-reader-meta"></div>
        <div id="aegis-reader-content"></div>
      </div>
    `;

    document.body.appendChild(readerOverlay);

    // Toolbar Listeners
    readerOverlay.querySelector("#aegis-reader-close-btn")?.addEventListener("click", () => {
      setReadingMode(false);
    });

    readerOverlay.querySelector("#aegis-reader-tts-btn")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "AEGIS_TTS_TOGGLE" });
    });

    readerOverlay.querySelectorAll(".theme-dot").forEach((dot) => {
      dot.addEventListener("click", () => {
        readerTheme = dot.dataset.theme;
        readerOverlay.className = `aegis-reader-theme-${readerTheme}`;
        readerOverlay.querySelectorAll(".theme-dot").forEach((d) => d.classList.remove("active"));
        dot.classList.add("active");
      });
    });

    readerOverlay.querySelector("#aegis-reader-font-dec")?.addEventListener("click", () => {
      adjustFontScale(-0.05);
    });

    readerOverlay.querySelector("#aegis-reader-font-inc")?.addEventListener("click", () => {
      adjustFontScale(0.05);
    });

    // Keyboard escape to close
    window.addEventListener("keydown", handleReaderEscape);
  }

  function handleReaderEscape(e) {
    if (e.key === "Escape" && state.readingModeOn) {
      setReadingMode(false);
    }
  }

  let readerContent = null;
  function populateReaderOverlay() {
    if (!readerOverlay) return;
    const titleEl = readerOverlay.querySelector("#aegis-reader-title");
    const metaEl = readerOverlay.querySelector("#aegis-reader-meta");
    readerContent = readerOverlay.querySelector("#aegis-reader-content");
    const statsEl = readerOverlay.querySelector("#aegis-reader-stats");

    const source = getBestReadingSource();
    const h1 = source.querySelector("h1");
    const titleText = (h1?.innerText || document.title || "Reading Mode").trim();
    if (titleEl) titleEl.textContent = titleText;

    const cleaned = cleanClone(source);
    if (readerContent) readerContent.replaceChildren(cleaned);

    // Calculate reading stats
    const words = (cleaned.innerText || "").trim().split(/\s+/).filter(Boolean).length;
    const readTimeMinutes = Math.max(1, Math.round(words / 200));
    if (statsEl) {
      statsEl.textContent = `${words} words · ~${readTimeMinutes} min read`;
    }
    if (metaEl) {
      metaEl.textContent = `${location.hostname} · ${new Date().toLocaleDateString()}`;
    }
  }

  function removeReaderOverlay() {
    window.removeEventListener("keydown", handleReaderEscape);
    readerOverlay?.remove();
    readerOverlay = readerContent = null;
  }

  function setupDomObserver() {
    if (domObserver || !document.body) return;
    domObserver = new MutationObserver(() => {
      if (!state.readingModeOn) return;
      clearTimeout(observerDebounce);
      observerDebounce = setTimeout(() => {
        if (state.readingModeOn) populateReaderOverlay();
      }, 200);
    });
    domObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function stopDomObserver() {
    domObserver?.disconnect();
    domObserver = null;
    clearTimeout(observerDebounce);
    observerDebounce = null;
  }

  // ======================================================
  // STYLES & VISUAL ENGINE
  // ======================================================
  function ensureStyleTag() {
    if (styleTag) return styleTag;
    styleTag = document.createElement("style");
    styleTag.id = "aegis-style";
    document.head.appendChild(styleTag);
    return styleTag;
  }

  function renderStyles() {
    if (!state.aegisEnabled) return cleanupVisuals();

    ensureStyleTag();
    if (state.colorBlindMode !== "off" && state.colorBlindMode !== "achromatopsia") {
      ensureColorBlindFilters();
    } else {
      removeColorBlindFilters();
    }

    renderColorTint();
    renderReadingRuler();

    document.documentElement.classList.add("aegis-active");
    document.documentElement.style.setProperty("--aegis-font-scale", state.aegisFontScale);

    // Font Family Definition
    let fontFamilyRule = "";
    if (state.fontFamily === "dyslexic") {
      fontFamilyRule = `
        html.aegis-active * {
          font-family: 'OpenDyslexic', 'Comic Sans MS', 'Trebuchet MS', 'Verdana', sans-serif !important;
        }
      `;
    } else if (state.fontFamily === "sans") {
      fontFamilyRule = `
        html.aegis-active * {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
        }
      `;
    } else if (state.fontFamily === "serif") {
      fontFamilyRule = `
        html.aegis-active * {
          font-family: Georgia, Cambria, "Times New Roman", Times, serif !important;
        }
      `;
    }

    styleTag.textContent = `
      html.aegis-active {
        --aegis-font-scale: ${state.aegisFontScale};
        --aegis-line-height: ${state.lineHeightOn ? "1.85" : "normal"};
        --aegis-letter-spacing: ${state.letterSpacingOn ? "0.08em" : "normal"};
        --aegis-word-spacing: ${state.wordSpacingOn ? "0.16em" : "normal"};
      }

      /* Text Adjustments using rem to prevent exponential compounding */
      html.aegis-active p,
      html.aegis-active li,
      html.aegis-active dd,
      html.aegis-active dt,
      html.aegis-active blockquote,
      html.aegis-active figcaption,
      html.aegis-active label,
      html.aegis-active select,
      html.aegis-active option,
      html.aegis-active summary {
        font-size: calc(1rem * var(--aegis-font-scale)) !important;
        line-height: var(--aegis-line-height) !important;
        letter-spacing: var(--aegis-letter-spacing) !important;
        word-spacing: var(--aegis-word-spacing) !important;
      }

      html.aegis-active h1 { font-size: calc(2rem * var(--aegis-font-scale)) !important; }
      html.aegis-active h2 { font-size: calc(1.6rem * var(--aegis-font-scale)) !important; }
      html.aegis-active h3 { font-size: calc(1.3rem * var(--aegis-font-scale)) !important; }

      ${fontFamilyRule}

      /* High-performance, uniform Dark Mode */
      html.aegis-dark {
        filter: invert(0.92) hue-rotate(180deg) contrast(1.05) !important;
        background: #111 !important;
      }
      html.aegis-dark img,
      html.aegis-dark video,
      html.aegis-dark picture,
      html.aegis-dark canvas,
      html.aegis-dark svg:not(#aegis-colorblind-filters),
      html.aegis-dark iframe,
      html.aegis-dark #aegis-reader-overlay,
      html.aegis-dark #aegis-reading-ruler,
      html.aegis-dark #aegis-tts-floating-bar {
        filter: invert(1) hue-rotate(180deg) !important;
      }

      /* WCAG AAA High Contrast */
      html.aegis-contrast {
        filter: contrast(165%) brightness(1.05) !important;
      }
      html.aegis-contrast a {
        text-decoration: underline 2px !important;
        font-weight: 700 !important;
      }

      /* Links and Headings Highlighters */
      html.aegis-hl-links a {
        background: rgba(254, 240, 138, 0.35) !important;
        border-bottom: 2px solid #C6842C !important;
        color: inherit !important;
      }
      html.aegis-hl-headings h1,
      html.aegis-hl-headings h2,
      html.aegis-hl-headings h3 {
        border-left: 4px solid #C6842C !important;
        padding-left: 8px !important;
      }

      /* Focus Mode (Selective Dimming without parent opacity trap) */
      html.aegis-focus header,
      html.aegis-focus nav,
      html.aegis-focus footer,
      html.aegis-focus aside,
      html.aegis-focus [role="banner"],
      html.aegis-focus [role="navigation"],
      html.aegis-focus [role="complementary"],
      html.aegis-focus [class*="sidebar" i],
      html.aegis-focus [class*="ad-" i],
      html.aegis-focus [class*="comment" i] {
        opacity: 0.25 !important;
        filter: grayscale(80%) !important;
        transition: opacity 0.3s ease, filter 0.3s ease !important;
      }
      html.aegis-focus header:hover,
      html.aegis-focus nav:hover,
      html.aegis-focus aside:hover {
        opacity: 0.9 !important;
        filter: none !important;
      }

      /* Color Blind Filters */
      body.aegis-cb-deuteranopia { filter: url(#aegis-filter-deuteranopia) !important; }
      body.aegis-cb-protanopia { filter: url(#aegis-filter-protanopia) !important; }
      body.aegis-cb-tritanopia { filter: url(#aegis-filter-tritanopia) !important; }
      body.aegis-cb-achromatopsia { filter: grayscale(100%) !important; }

      /* Reading Mode Overlay Styles */
      body.aegis-reading > :not(#aegis-reader-overlay) {
        display: none !important;
      }

      #aegis-reader-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        overflow-y: auto;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Georgia, serif;
        transition: background 0.25s, color 0.25s;
      }

      /* Reader Themes */
      #aegis-reader-overlay.aegis-reader-theme-light { background: #F8F9FA; color: #1A1A1A; }
      #aegis-reader-overlay.aegis-reader-theme-sepia { background: #F4ECD8; color: #3B2E1E; }
      #aegis-reader-overlay.aegis-reader-theme-dark  { background: #1E1E1E; color: #E0E0E0; }
      #aegis-reader-overlay.aegis-reader-theme-night { background: #000000; color: #C8C8C8; }

      #aegis-reader-toolbar {
        position: sticky;
        top: 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 24px;
        background: inherit;
        border-bottom: 1px solid rgba(128, 128, 128, 0.2);
        backdrop-filter: blur(8px);
        z-index: 10;
      }

      .aegis-reader-tb-left, .aegis-reader-tb-right {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .aegis-reader-stats {
        font-size: 13px;
        opacity: 0.75;
      }

      #aegis-reader-toolbar button {
        background: rgba(128, 128, 128, 0.15);
        border: 1px solid rgba(128, 128, 128, 0.25);
        color: inherit;
        border-radius: 8px;
        padding: 6px 12px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease;
      }

      #aegis-reader-toolbar button:hover {
        background: rgba(128, 128, 128, 0.3);
      }

      .aegis-reader-themes {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .theme-dot {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 2px solid transparent !important;
        padding: 0 !important;
        cursor: pointer;
      }

      .theme-dot.active {
        border-color: #C6842C !important;
        transform: scale(1.15);
      }

      .theme-dot.light { background: #F8F9FA; border: 1px solid #ccc !important; }
      .theme-dot.sepia { background: #F4ECD8; }
      .theme-dot.dark { background: #1E1E1E; }
      .theme-dot.night { background: #000000; }

      #aegis-reader-shell {
        max-width: 740px;
        margin: 0 auto;
        padding: 40px 20px 100px;
      }

      #aegis-reader-title {
        font-size: 2.2rem;
        line-height: 1.25;
        font-weight: 700;
        margin-bottom: 12px;
      }

      #aegis-reader-meta {
        font-size: 13px;
        opacity: 0.65;
        margin-bottom: 30px;
        padding-bottom: 16px;
        border-bottom: 1px solid rgba(128, 128, 128, 0.2);
      }

      #aegis-reader-content {
        font-size: calc(1.15rem * var(--aegis-font-scale, 1));
        line-height: 1.85;
      }

      #aegis-reader-content p {
        margin-bottom: 1.5em;
      }

      #aegis-reader-content img {
        max-width: 100%;
        height: auto;
        border-radius: 8px;
        margin: 20px 0;
      }
    `;

    document.documentElement.classList.toggle("aegis-dark", state.darkModeOn);
    document.documentElement.classList.toggle("aegis-contrast", state.highContrastOn);
    document.documentElement.classList.toggle("aegis-focus", state.focusModeOn);
    document.documentElement.classList.toggle("aegis-hl-links", state.highlightLinksOn);
    document.documentElement.classList.toggle("aegis-hl-headings", state.highlightHeadingsOn);
    document.body.classList.toggle("aegis-reading", state.readingModeOn);

    COLOR_BLIND_MODES.forEach((mode) => {
      if (mode !== "off") {
        document.body.classList.toggle(`aegis-cb-${mode}`, state.colorBlindMode === mode);
      }
    });

    if (state.readingModeOn) {
      createReaderOverlay();
      populateReaderOverlay();
      setupDomObserver();
    } else {
      removeReaderOverlay();
      stopDomObserver();
    }
  }

  function cleanupVisuals() {
    styleTag?.remove();
    styleTag = null;
    removeReaderOverlay();
    removeColorBlindFilters();
    stopDomObserver();
    tintOverlayEl?.remove();
    tintOverlayEl = null;

    if (ttsFloatingBar) {
      ttsFloatingBar.remove();
      ttsFloatingBar = null;
    }

    if (readingRulerEl) {
      window.removeEventListener("mousemove", onRulerMouseMove);
      readingRulerEl.remove();
      readingRulerEl = null;
    }

    document.documentElement.classList.remove(
      "aegis-active",
      "aegis-dark",
      "aegis-contrast",
      "aegis-focus",
      "aegis-hl-links",
      "aegis-hl-headings"
    );

    document.body.classList.remove(
      "aegis-reading",
      "aegis-cb-deuteranopia",
      "aegis-cb-protanopia",
      "aegis-cb-tritanopia",
      "aegis-cb-achromatopsia"
    );

    document.documentElement.style.removeProperty("--aegis-font-scale");
  }

  // ======================================================
  // STATE MUTATIONS
  // ======================================================
  function toggleFeature(key) {
    state[key] = !state[key];
    if (state.aegisEnabled) renderStyles();
    persistSiteState();
  }

  function toggleEnabled() {
    state.aegisEnabled = !state.aegisEnabled;
    state.aegisEnabled ? renderStyles() : cleanupVisuals();
    persistSiteState();
  }

  function adjustFontScale(delta) {
    state.aegisFontScale = Math.round(Math.min(Math.max(state.aegisFontScale + delta, 0.8), 2.0) * 100) / 100;
    if (state.aegisEnabled) renderStyles();
    persistSiteState();
  }

  function setReadingMode(enabled) {
    state.readingModeOn = enabled;
    if (enabled) state.focusModeOn = false;
    if (state.aegisEnabled) renderStyles();
    persistSiteState();
  }

  function setFocusMode(enabled) {
    state.focusModeOn = enabled;
    if (enabled) state.readingModeOn = false;
    if (state.aegisEnabled) renderStyles();
    persistSiteState();
  }

  function cycleColorBlindMode() {
    const nextIdx = (COLOR_BLIND_MODES.indexOf(state.colorBlindMode) + 1) % COLOR_BLIND_MODES.length;
    state.colorBlindMode = COLOR_BLIND_MODES[nextIdx];
    if (state.aegisEnabled) renderStyles();
    persistSiteState();
  }

  function setColorBlindMode(mode) {
    state.colorBlindMode = COLOR_BLIND_MODES.includes(mode) ? mode : "off";
    if (state.aegisEnabled) renderStyles();
    persistSiteState();
  }

  function setColorTint(tint) {
    state.colorTint = COLOR_TINTS.includes(tint) ? tint : "off";
    if (state.aegisEnabled) renderStyles();
    persistSiteState();
  }

  function setFontFamily(family) {
    state.fontFamily = ["default", "dyslexic", "sans", "serif"].includes(family) ? family : "default";
    if (state.aegisEnabled) renderStyles();
    persistSiteState();
  }

  function resetCurrentSite() {
    state = { ...defaultState };
    cleanupVisuals();
    persistSiteState();
  }

  // ======================================================
  // WCAG ACCESSIBILITY ANALYZER
  // ======================================================
  function scanAccessibility() {
    const images = [...document.querySelectorAll("img")];
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")];
    const buttons = [...document.querySelectorAll("button, [role='button']")];
    const links = [...document.querySelectorAll("a[href]")];
    const forms = [...document.querySelectorAll("input:not([type='hidden']), select, textarea")];

    // Images
    const missingAltImages = images.filter((img) => !img.hasAttribute("alt") || img.alt.trim() === "");

    // Headings structure
    let prevHeading = 0;
    let headingIssues = 0;
    const hasH1 = headings.some((h) => h.tagName === "H1");
    if (headings.length > 0 && !hasH1) headingIssues++;

    headings.forEach((h) => {
      const lvl = +h.tagName[1];
      if (prevHeading && lvl > prevHeading + 1) {
        headingIssues++;
      }
      prevHeading = lvl;
    });

    // Buttons
    const missingLabelButtons = buttons.filter((b) => {
      const text = b.innerText?.trim();
      const aria = b.getAttribute("aria-label") || b.getAttribute("title");
      const hasImg = b.querySelector("img[alt], svg[aria-label]");
      return !text && !aria && !hasImg;
    });

    // Links
    const emptyLinks = links.filter((a) => {
      const text = a.innerText?.trim();
      const aria = a.getAttribute("aria-label") || a.getAttribute("title");
      const hasImg = a.querySelector("img[alt], svg[aria-label]");
      return !text && !aria && !hasImg;
    });

    // Forms
    const missingLabelForms = forms.filter((f) => {
      const id = f.id;
      const hasLabelFor = id && document.querySelector(`label[for="${id}"]`);
      const hasParentLabel = f.closest("label");
      const hasAria = f.getAttribute("aria-label") || f.getAttribute("aria-labelledby") || f.getAttribute("title");
      return !hasLabelFor && !hasParentLabel && !hasAria;
    });

    // Document checks
    const hasTitle = Boolean(document.title?.trim());
    const hasLang = Boolean(document.documentElement.lang?.trim());

    // Penalty score calculation
    let penalties = 0;
    penalties += missingAltImages.length * 3;
    penalties += headingIssues * 5;
    penalties += missingLabelButtons.length * 4;
    penalties += emptyLinks.length * 2;
    penalties += missingLabelForms.length * 5;
    if (!hasTitle) penalties += 10;
    if (!hasLang) penalties += 5;

    const score = Math.max(10, Math.min(100, 100 - penalties));

    return {
      score,
      images: { total: images.length, issues: missingAltImages.length },
      headings: { total: headings.length, issues: headingIssues, hasH1 },
      buttons: { total: buttons.length, issues: missingLabelButtons.length },
      links: { total: links.length, issues: emptyLinks.length },
      forms: { total: forms.length, issues: missingLabelForms.length },
      meta: { hasTitle, hasLang }
    };
  }

  // ======================================================
  // INITIALIZATION & MESSAGE ROUTING
  // ======================================================
  chrome.storage.local.get([SITE_STATES_KEY, DEFAULT_ENABLE_KEY], (res) => {
    const siteKey = getSiteKey();
    const allStates = res[SITE_STATES_KEY] || {};
    const saved = allStates[siteKey];

    if (saved) {
      Object.assign(state, saved);
      if (state.aegisEnabled) renderStyles();
    } else if (res[DEFAULT_ENABLE_KEY] === true) {
      state.aegisEnabled = true;
      renderStyles();
      persistSiteState();
    }
  });

  const handlers = {
    AEGIS_GET_STATE: () => ({ ...state }),
    AEGIS_EXTRACT_TEXT: () => ({ text: extractPageText() }),
    AEGIS_TOGGLE_ENABLED: toggleEnabled,
    AEGIS_ADJUST_FONT_SCALE: (m) => adjustFontScale(m.delta || 0),
    AEGIS_TOGGLE_DARK_MODE: () => toggleFeature("darkModeOn"),
    AEGIS_TOGGLE_HIGH_CONTRAST: () => toggleFeature("highContrastOn"),
    AEGIS_TOGGLE_LINE_HEIGHT: () => toggleFeature("lineHeightOn"),
    AEGIS_TOGGLE_LETTER_SPACING: () => toggleFeature("letterSpacingOn"),
    AEGIS_TOGGLE_WORD_SPACING: () => toggleFeature("wordSpacingOn"),
    AEGIS_TOGGLE_READING_MODE: () => setReadingMode(!state.readingModeOn),
    AEGIS_SET_READING_MODE: (m) => setReadingMode(!!m.enabled),
    AEGIS_TOGGLE_FOCUS_MODE: () => setFocusMode(!state.focusModeOn),
    AEGIS_SET_FOCUS_MODE: (m) => setFocusMode(!!m.enabled),
    AEGIS_TOGGLE_READING_RULER: () => toggleFeature("readingRulerOn"),
    AEGIS_CYCLE_COLOR_BLIND_MODE: cycleColorBlindMode,
    AEGIS_SET_COLOR_BLIND_MODE: (m) => setColorBlindMode(m.mode),
    AEGIS_SET_COLOR_TINT: (m) => setColorTint(m.tint),
    AEGIS_SET_FONT_FAMILY: (m) => setFontFamily(m.family),
    AEGIS_TOGGLE_HIGHLIGHT_LINKS: () => toggleFeature("highlightLinksOn"),
    AEGIS_TOGGLE_HIGHLIGHT_HEADINGS: () => toggleFeature("highlightHeadingsOn"),
    AEGIS_RESET_CURRENT_SITE: resetCurrentSite
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "AEGIS_EXTRACT_TEXT") {
      sendResponse({ text: extractPageText() });
      return true;
    }

    if (message.type === "AEGIS_TTS_STATE_CHANGED" && message.state) {
      renderTtsFloatingBar(message.state);
      return false;
    }

    if (message.type === "AEGIS_SCAN_ACCESSIBILITY") {
      sendResponse(scanAccessibility());
      return true;
    }

    const action = handlers[message.type];
    if (action) {
      action(message);
      sendResponse({ ...state });
    }
    return true;
  });
})();
