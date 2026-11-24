const DEFAULT_API_KEY = "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";

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(["apiKey"]);
  if (!data.apiKey) {
    await chrome.storage.local.set({
      apiKey: DEFAULT_API_KEY,
      groqApiKey: DEFAULT_API_KEY,
      wmLanguage: "English"
    });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-webmorph") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) toggleOnTab(tab.id);
  }
});

async function toggleOnTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "TOGGLE_WEBMORPH" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    setTimeout(() => chrome.tabs.sendMessage(tabId, { type: "TOGGLE_WEBMORPH" }), 150);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "AI_SIMPLIFY_PAGE") {
    handleSimplifyPage(msg.payload).then(sendResponse);
    return true;
  }
  if (msg.type === "AI_AUTOFILL_GOAL") {
    handleAutofillGoal(msg.payload).then(sendResponse);
    return true;
  }
});

function parseJsonSafely(text) {
  if (!text) return null;
  let str = String(text).trim();

  // Strip markdown code fences if present
  if (str.startsWith("```")) {
    str = str.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  try {
    return JSON.parse(str);
  } catch (e) {
    const start = str.indexOf("{");
    const end = str.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(str.substring(start, end + 1));
      } catch (err) {}
    }
    return null;
  }
}

async function callGroq(prompt, apiKey) {
  const models = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"];
  for (const model of models) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: "You are WebMorph, an expert autonomous web agent and anti-dark-pattern engine. Output strictly valid JSON matching the requested schema. No conversational prose."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          response_format: { type: "json_object" },
          temperature: 0.1
        })
      });

      if (res.ok) {
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        const parsed = parseJsonSafely(content);
        if (parsed) return { ok: true, data: parsed };
      }
    } catch (err) {
      console.warn(`Groq model ${model} failed:`, err);
    }
  }
  return { fallback: true };
}

async function callGrok(prompt, apiKey) {
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        model: "grok-2-latest",
        messages: [
          {
            role: "system",
            content: "You are WebMorph, an expert web accessibility agent. Output strictly valid JSON matching the requested schema."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.1
      })
    });

    if (!res.ok) return { fallback: true, error: `Grok HTTP ${res.status}` };
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    const parsed = parseJsonSafely(raw);
    return parsed ? { ok: true, data: parsed } : { fallback: true };
  } catch (err) {
    return { fallback: true, error: err.message };
  }
}

async function callGemini(prompt, apiKey) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
      })
    });

    if (!res.ok) return { fallback: true, error: `Gemini HTTP ${res.status}` };
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = parseJsonSafely(raw);
    return parsed ? { ok: true, data: parsed } : { fallback: true };
  } catch (err) {
    return { fallback: true, error: err.message };
  }
}

async function callAI(prompt) {
  const { apiKey, groqApiKey, grokApiKey, geminiApiKey } = await chrome.storage.local.get([
    "apiKey",
    "groqApiKey",
    "grokApiKey",
    "geminiApiKey"
  ]);

  const activeKey = (apiKey || groqApiKey || grokApiKey || geminiApiKey || DEFAULT_API_KEY).trim();
  if (!activeKey) return { fallback: true };

  // Detect key provider
  if (activeKey.startsWith("gsk_")) {
    return await callGroq(prompt, activeKey);
  }
  if (activeKey.startsWith("xai-")) {
    return await callGrok(prompt, activeKey);
  }
  if (activeKey.startsWith("AIza")) {
    return await callGemini(prompt, activeKey);
  }

  // Default fallback tries Groq first
  return await callGroq(prompt, activeKey);
}

async function handleSimplifyPage({ title, url, language, fields, textSample }) {
  const prompt = `
You are WebMorph, an accessibility and anti-dark-pattern web agent.
Analyze this webpage and return JSON only.
Page Title: ${title}
URL: ${url}
Target Language: ${language}
Form Fields: ${JSON.stringify(fields.slice(0, 30))}
Page Text Sample: ${textSample.slice(0, 2500)}

Return JSON with this exact shape:
{
  "pageSummary": "1 concise plain-language sentence in ${language} explaining what this page is for.",
  "simplifiedLabels": { "wm-0": "Clear human label in ${language}" },
  "aiWarnings": ["Up to 3 short warnings in ${language} about hidden fees, auto-renewals, non-refundable terms, or tricky fine print found in the text sample. Empty array if none."]
}`;
  return await callAI(prompt);
}

async function handleAutofillGoal({ goal, fields, language }) {
  const prompt = `
You are WebMorph's form-filling agent.
User Goal: "${goal}"
Available Form Fields: ${JSON.stringify(fields)}

Match information from the user's goal to the exact field IDs ("id").
For select fields, pick the closest matching option text/value.
For checkboxes, return true or false only if clearly requested.
Return JSON only:
{
  "fills": { "wm-0": "value to fill" },
  "note": "Short 1-sentence confirmation in ${language} of what was filled."
}`;
  return await callAI(prompt);
}
