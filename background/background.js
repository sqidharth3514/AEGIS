// Aegis - Background Service Worker & Native TTS Engine (Manifest V3)

const COMMAND_ACTIONS = {
  toggle_aegis: { type: "AEGIS_TOGGLE_ENABLED" },
  toggle_reading_mode: { type: "AEGIS_TOGGLE_READING_MODE" },
  toggle_focus_mode: { type: "AEGIS_TOGGLE_FOCUS_MODE" },
  cycle_color_blind_mode: { type: "AEGIS_CYCLE_COLOR_BLIND_MODE" },
  toggle_reading_ruler: { type: "AEGIS_TOGGLE_READING_RULER" }
};

// ======================================================
// TTS ENGINE STATE & METHODS
// ======================================================
let ttsState = {
  isSpeaking: false,
  isPaused: false,
  currentTabId: null
};

function broadcastTtsState() {
  chrome.runtime.sendMessage(
    {
      type: "AEGIS_TTS_STATE_CHANGED",
      state: { ...ttsState }
    },
    () => {
      void chrome.runtime.lastError;
    }
  );

  if (ttsState.currentTabId) {
    chrome.tabs.sendMessage(
      ttsState.currentTabId,
      {
        type: "AEGIS_TTS_STATE_CHANGED",
        state: { ...ttsState }
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  }
}

/**
 * Splits long text into manageable sentences to prevent TTS timeout issues.
 */
function chunkText(text, maxChunkLen = 800) {
  if (!text) return [];
  const sentences = text.match(/[^.!?\n]+[.!?\n]+(\s|$)|[^.!?\n]+$/g) || [text];
  const chunks = [];
  let buffer = "";

  for (const sentence of sentences) {
    if ((buffer + sentence).length > maxChunkLen) {
      if (buffer.trim()) chunks.push(buffer.trim());
      buffer = sentence;
    } else {
      buffer += sentence;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks.length ? chunks : [text.trim()];
}

function stopTts() {
  try {
    chrome.tts.stop();
  } catch (e) {
    console.warn("[Aegis TTS] Stop error:", e);
  }
  ttsState = {
    isSpeaking: false,
    isPaused: false,
    currentTabId: null
  };
  broadcastTtsState();
}

function pauseTts() {
  try {
    chrome.tts.pause();
    ttsState.isPaused = true;
    broadcastTtsState();
  } catch (e) {
    console.warn("[Aegis TTS] Pause error:", e);
  }
}

function resumeTts() {
  try {
    chrome.tts.resume();
    ttsState.isPaused = false;
    broadcastTtsState();
  } catch (e) {
    console.warn("[Aegis TTS] Resume error:", e);
  }
}

function speakText(text, tabId = null) {
  if (!text || !text.trim()) {
    stopTts();
    return;
  }

  stopTts();

  const chunks = chunkText(text.trim());
  if (!chunks.length) return;

  ttsState = {
    isSpeaking: true,
    isPaused: false,
    currentTabId: tabId
  };
  broadcastTtsState();

  const totalChunks = chunks.length;

  chunks.forEach((chunk, index) => {
    chrome.tts.speak(chunk, {
      enqueue: index > 0,
      rate: 1.0,
      pitch: 1.0,
      onEvent: (event) => {
        if (event.type === "start" && index === 0) {
          ttsState.isSpeaking = true;
          ttsState.isPaused = false;
          broadcastTtsState();
        } else if (event.type === "end") {
          if (index === totalChunks - 1) {
            ttsState.isSpeaking = false;
            ttsState.isPaused = false;
            ttsState.currentTabId = null;
            broadcastTtsState();
          }
        } else if (event.type === "error" || event.type === "cancelled") {
          ttsState.isSpeaking = false;
          ttsState.isPaused = false;
          ttsState.currentTabId = null;
          broadcastTtsState();
        }
      }
    });
  });
}

async function handleTtsToggle(tabId = null) {
  if (ttsState.isSpeaking) {
    if (ttsState.isPaused) {
      resumeTts();
    } else {
      pauseTts();
    }
    return;
  }

  // Not speaking: ask active tab for text and start
  const tab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : await getActiveTab();
  if (!tab?.id || !isInjectableUrl(tab.url)) return;

  chrome.tabs.sendMessage(tab.id, { type: "AEGIS_EXTRACT_TEXT" }, (response) => {
    if (chrome.runtime.lastError || !response?.text) {
      console.warn("[Aegis TTS] No readable text found or tab unreachable.");
      return;
    }
    speakText(response.text, tab.id);
  });
}

// ======================================================
// TAB & MESSAGE ROUTING
// ======================================================
async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch (error) {
    console.error("[Aegis SW] Failed to query active tab:", error);
    return null;
  }
}

function isInjectableUrl(url) {
  if (!url) return false;
  return !/^(chrome|edge|about|devtools|chrome-extension):\/\//i.test(url);
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  if (!tab?.id || !isInjectableUrl(tab.url)) return null;

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/content.js"]
      });
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (injErr) {
      console.warn("[Aegis SW] Could not communicate with or inject script into tab:", tab.id, injErr);
      return null;
    }
  }
}

// Commands (Keyboard shortcuts)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle_tts") {
    const tab = await getActiveTab();
    await handleTtsToggle(tab?.id);
    return;
  }

  const action = COMMAND_ACTIONS[command];
  if (action) {
    await sendToActiveTab(action);
  }
});

// Update badge
async function updateBadgeForTab(tabId) {
  if (!tabId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isInjectableUrl(tab?.url)) {
      await chrome.action.setBadgeText({ tabId, text: "" });
      return;
    }
    const response = await chrome.tabs.sendMessage(tabId, { type: "AEGIS_GET_STATE" }).catch(() => null);
    if (response?.aegisEnabled) {
      await chrome.action.setBadgeText({ tabId, text: "ON" });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#C6842C" });
    } else {
      await chrome.action.setBadgeText({ tabId, text: "" });
    }
  } catch {
    // Tab might be closed or restricted
  }
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await updateBadgeForTab(activeInfo.tabId);
});

// Runtime messages from Popup or Content Script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "AEGIS_STATE_CHANGED" && sender.tab?.id) {
    const isEnabled = !!message.state?.aegisEnabled;
    chrome.action.setBadgeText({
      tabId: sender.tab.id,
      text: isEnabled ? "ON" : ""
    });
    if (isEnabled) {
      chrome.action.setBadgeBackgroundColor({
        tabId: sender.tab.id,
        color: "#C6842C"
      });
    }
    return false;
  }

  // TTS Control Actions
  if (message.type === "AEGIS_TTS_GET_STATE") {
    sendResponse({ ...ttsState });
    return true;
  }

  if (message.type === "AEGIS_TTS_SPEAK") {
    const tabId = sender.tab?.id || message.tabId || null;
    speakText(message.text, tabId);
    sendResponse({ ...ttsState });
    return true;
  }

  if (message.type === "AEGIS_TTS_TOGGLE") {
    const tabId = sender.tab?.id || message.tabId || null;
    handleTtsToggle(tabId).then(() => sendResponse({ ...ttsState }));
    return true;
  }

  if (message.type === "AEGIS_TTS_PAUSE") {
    pauseTts();
    sendResponse({ ...ttsState });
    return true;
  }

  if (message.type === "AEGIS_TTS_RESUME") {
    resumeTts();
    sendResponse({ ...ttsState });
    return true;
  }

  if (message.type === "AEGIS_TTS_STOP") {
    stopTts();
    sendResponse({ ...ttsState });
    return true;
  }

  return false;
});