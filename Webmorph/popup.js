const DEFAULT_KEY = "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";
const apiKeyInput = document.getElementById("apiKey");
const langSelect = document.getElementById("lang");
const statusEl = document.getElementById("status");

chrome.storage.local.get(["apiKey", "groqApiKey", "grokApiKey", "geminiApiKey", "wmLanguage"], (data) => {
  const existingKey = data.apiKey || data.groqApiKey || data.grokApiKey || data.geminiApiKey || DEFAULT_KEY;
  apiKeyInput.value = existingKey;
  if (data.wmLanguage) langSelect.value = data.wmLanguage;
});

async function saveSettings() {
  const key = apiKeyInput.value.trim() || DEFAULT_KEY;
  const lang = langSelect.value;
  await chrome.storage.local.set({
    apiKey: key,
    groqApiKey: key,
    grokApiKey: key,
    geminiApiKey: key,
    wmLanguage: lang
  });
}

document.getElementById("saveBtn").addEventListener("click", async () => {
  await saveSettings();
  statusEl.style.color = "#10b981";
  statusEl.textContent = "Settings saved!";
  setTimeout(() => (statusEl.textContent = ""), 2000);
});

document.getElementById("morphBtn").addEventListener("click", async () => {
  await saveSettings();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
    statusEl.style.color = "#f87171";
    statusEl.textContent = "Open any regular website first (not chrome://).";
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_WEBMORPH" });
    window.close();
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    setTimeout(async () => {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_WEBMORPH" });
      } catch (e) {}
      window.close();
    }, 150);
  }
});
