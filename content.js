(() => {
  if (window.__WEBMORPH_LOADED__) return;
  window.__WEBMORPH_LOADED__ = true;

  let hostEl = null;
  let shadow = null;
  let state = {
    open: false,
    splitView: true,
    highContrast: false,
    fontScale: 1,
    step: 1,
    language: "English",
    fields: [],
    traps: [],
    aiWarnings: [],
    pageSummary: "",
    submitBtn: null,
    neutralizedCount: 0
  };

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TOGGLE_WEBMORPH") {
      state.open ? closeOverlay() : openOverlay();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.open) {
      closeOverlay();
    }
  });

  function escapeHtml(str = "") {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function findLabel(el, idx) {
    if (el.id) {
      try {
        const explicit = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (explicit?.innerText.trim()) return explicit.innerText.trim();
      } catch (e) {}
    }
    const parentLabel = el.closest("label");
    if (parentLabel?.innerText.trim()) return parentLabel.innerText.trim();
    if (el.getAttribute("aria-label")) return el.getAttribute("aria-label").trim();
    if (el.placeholder) return el.placeholder.trim();
    if (el.name) return el.name.replace(/[_-]+/g, " ").trim();
    const prev = el.previousElementSibling;
    if (prev && prev.innerText && prev.innerText.trim().length < 60) return prev.innerText.trim();
    return `Field ${idx + 1}`;
  }

  function setNativeValue(el, value, isLiveTyping = false) {
    if (!el) return;
    if (el.type === "checkbox") {
      const boolVal = value === true || value === "true" || value === "yes";
      if (el.checked !== boolVal) el.click();
    } else if (el.tagName === "SELECT") {
      const target = String(value).toLowerCase();
      const match = Array.from(el.options).find(
        (o) => o.value.toLowerCase() === target || o.text.toLowerCase().includes(target)
      );
      if (match) el.value = match.value;
    } else {
      const proto =
        el.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
    }

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));

    // Prevent screen jitter and premature blur validation during active keystrokes
    if (!isLiveTyping) {
      el.dispatchEvent(new Event("blur", { bubbles: true }));

      // Visual green sync pulse on the real website DOM
      const oldOutline = el.style.outline;
      const oldTransition = el.style.transition;
      el.style.transition = "outline 0.2s ease";
      el.style.outline = "3px solid #10b981";
      try {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (e) {}
      setTimeout(() => {
        el.style.outline = oldOutline;
        el.style.transition = oldTransition;
      }, 1400);
    }
  }

  function scanPage() {
    const rawInputs = Array.from(
      document.querySelectorAll("input, select, textarea")
    ).filter((el) => {
      if (!isVisible(el)) return false;
      if (el.closest("#webmorph-host")) return false;
      const skip = ["hidden", "submit", "button", "reset", "image", "file"];
      return !skip.includes((el.type || "").toLowerCase());
    });

    const fields = rawInputs.slice(0, 36).map((el, i) => {
      const wmId = `wm-${i}`;
      el.setAttribute("data-wm-id", wmId);
      const label = findLabel(el, i).slice(0, 80);
      const options =
        el.tagName === "SELECT"
          ? Array.from(el.options).map((o) => ({ value: o.value, text: o.text.trim() }))
          : [];
      return {
        id: wmId,
        el,
        tag: el.tagName.toLowerCase(),
        type: (el.type || "text").toLowerCase(),
        label,
        simplifiedLabel: label,
        value: el.type === "checkbox" ? el.checked : el.value || "",
        required: el.required || false,
        options
      };
    });

    // Dark Pattern Detection
    const traps = [];
    fields.forEach((f) => {
      if (f.type === "checkbox" && f.el.checked) {
        traps.push({
          type: "prechecked",
          text: `Pre-checked opt-in detected: "${f.label}"`,
          el: f.el,
          wmId: f.id,
          neutralized: false
        });
      }
    });

    const urgencyRegex =
      /(only \d+ left|hurry|offer ends|limited time|non-refundable|convenience fee|auto-renew|selling fast|\d{1,2}:\d{2}\s*(left|remaining))/i;
    const textNodes = Array.from(document.querySelectorAll("p, span, div, small, strong, b, li"))
      .filter((el) => !el.closest("#webmorph-host") && el.children.length === 0 && isVisible(el));

    const seenTrapText = new Set();
    for (const node of textNodes) {
      const t = node.innerText?.trim();
      if (t && t.length > 6 && t.length < 140 && urgencyRegex.test(t) && !seenTrapText.has(t)) {
        seenTrapText.add(t);
        traps.push({
          type: "urgency",
          text: `Suspicious pressure / fine print: "${t}"`,
          el: node,
          neutralized: false
        });
        if (traps.length >= 6) break;
      }
    }

    // Locate likely primary submit button
    const buttons = Array.from(
      document.querySelectorAll('button, input[type="submit"], a[role="button"]')
    ).filter((el) => isVisible(el) && !el.closest("#webmorph-host"));

    const submitRegex = /(submit|continue|pay|book|register|apply|next|confirm|checkout|sign up|create|save)/i;
    const submitBtn =
      buttons.find((b) => b.type === "submit") ||
      buttons.find((b) => submitRegex.test(b.innerText || b.value || "")) ||
      null;

    state.fields = fields;
    state.traps = traps;
    state.submitBtn = submitBtn;
    state.aiWarnings = [];
    state.pageSummary = `Detected ${fields.length} interactive field${fields.length === 1 ? "" : "s"} and ${traps.length} potential dark pattern${traps.length === 1 ? "" : "s"} on ${location.hostname}.`;
    state.step = 1;
    state.neutralizedCount = 0;
  }

  async function runAISimplify() {
    const { wmLanguage } = await chrome.storage.local.get("wmLanguage");
    state.language = wmLanguage || "English";

    const payload = {
      title: document.title,
      url: location.href,
      language: state.language,
      fields: state.fields.map(({ id, label, type, required }) => ({ id, label, type, required })),
      textSample: document.body.innerText || ""
    };

    const res = await chrome.runtime.sendMessage({ type: "AI_SIMPLIFY_PAGE", payload });
    if (res?.ok && res.data) {
      if (res.data.pageSummary) state.pageSummary = res.data.pageSummary;
      if (res.data.simplifiedLabels) {
        state.fields.forEach((f) => {
          if (res.data.simplifiedLabels[f.id]) f.simplifiedLabel = res.data.simplifiedLabels[f.id];
        });
      }
      if (Array.isArray(res.data.aiWarnings)) state.aiWarnings = res.data.aiWarnings;
      renderUI();
    }
  }

  function localSmartAutofill(goalText) {
    let filled = 0;
    const emailMatch = goalText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/i);
    const phoneMatch = goalText.match(/(?:\+?\d{1,3}[\s-]?)?[6-9]\d{9}/);
    const nameMatch = goalText.match(/(?:name is|i am|i'm|name:?)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i);
    const cityMatch = goalText.match(/(?:from|in|to|city:?)\s+([A-Za-z]+)/i);

    state.fields.forEach((f) => {
      const l = (f.label + " " + f.type).toLowerCase();
      if (emailMatch && (l.includes("email") || f.type === "email")) {
        f.value = emailMatch[0];
        setNativeValue(f.el, f.value, false);
        filled++;
      } else if (phoneMatch && (l.includes("phone") || l.includes("mobile") || f.type === "tel")) {
        f.value = phoneMatch[0];
        setNativeValue(f.el, f.value, false);
        filled++;
      } else if (nameMatch && l.includes("name") && !l.includes("user")) {
        f.value = nameMatch[1];
        setNativeValue(f.el, f.value, false);
        filled++;
      } else if (cityMatch && (l.includes("city") || l.includes("location") || l.includes("from"))) {
        f.value = cityMatch[1];
        setNativeValue(f.el, f.value, false);
        filled++;
      }
    });
    return filled;
  }

  async function handleGoalSubmit(goalText, statusNode) {
    if (!goalText.trim()) return;
    if (statusNode) statusNode.textContent = "Grok / AI mapping your goal to page fields...";

    const res = await chrome.runtime.sendMessage({
      type: "AI_AUTOFILL_GOAL",
      payload: {
        goal: goalText,
        language: state.language,
        fields: state.fields.map(({ id, label, type, options }) => ({
          id,
          label,
          type,
          options: options.slice(0, 12).map((o) => o.text)
        }))
      }
    });

    if (res?.ok && res.data?.fills) {
      let count = 0;
      Object.entries(res.data.fills).forEach(([wmId, val]) => {
        const field = state.fields.find((f) => f.id === wmId);
        if (field) {
          field.value = val;
          setNativeValue(field.el, val, false);
          count++;
        }
      });
      const note = res.data.note || `Auto-filled ${count} fields directly on the live webpage.`;
      renderUI(note);
    } else {
      const count = localSmartAutofill(goalText);
      const msg =
        count > 0
          ? `Local Engine filled ${count} matching field(s). Add your Grok API key in popup for full AI reasoning.`
          : `No direct match found locally. Add your Grok API key in popup for smart AI auto-fill.`;
      renderUI(msg);
    }
  }

  function neutralizeTraps() {
    let count = 0;
    state.traps.forEach((t) => {
      if (t.neutralized) return;
      if (t.type === "prechecked" && t.el) {
        setNativeValue(t.el, false, false);
        const f = state.fields.find((x) => x.id === t.wmId);
        if (f) f.value = false;
        t.neutralized = true;
        count++;
      } else if (t.type === "urgency" && t.el) {
        t.el.style.opacity = "0.35";
        t.el.style.textDecoration = "line-through";
        t.el.style.border = "1px dashed #ef4444";

        if (!t.el.querySelector(".wm-neutralized-badge")) {
          const badge = document.createElement("span");
          badge.className = "wm-neutralized-badge";
          badge.textContent = " [🛡️ BLOCKED BY WEBMORPH] ";
          badge.style.cssText =
            "background:#ef4444;color:#fff;font-size:11px;font-weight:bold;padding:2px 6px;border-radius:4px;margin-left:6px;display:inline-block;vertical-align:middle;text-decoration:none;";
          t.el.appendChild(badge);
        }

        t.neutralized = true;
        count++;
      }
    });
    state.neutralizedCount += count;
    renderUI(`Neutralized ${count} dark pattern(s) on the live page.`);
  }

  function speakSummary() {
    window.speechSynthesis.cancel();
    const lines = [
      state.pageSummary,
      state.traps.length ? `Warning: ${state.traps.length} suspicious patterns detected.` : "No dark patterns detected.",
      ...state.aiWarnings
    ].join(" ");
    const utter = new SpeechSynthesisUtterance(lines);
    window.speechSynthesis.speak(utter);
  }

  function startVoiceGoal(inputEl, statusEl) {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      if (statusEl) statusEl.textContent = "Voice input not supported in this browser.";
      return;
    }
    const rec = new SpeechRec();
    rec.lang = "en-US";
    if (statusEl) statusEl.textContent = "Listening... speak your goal now.";
    rec.onresult = (e) => {
      const text = e.results[0][0].transcript;
      inputEl.value = text;
      handleGoalSubmit(text, statusEl);
    };
    rec.onerror = () => {
      if (statusEl) statusEl.textContent = "Mic access blocked or cancelled.";
    };
    rec.start();
  }

  function openOverlay() {
    state.open = true;
    scanPage();
    if (!hostEl) {
      hostEl = document.createElement("div");
      hostEl.id = "webmorph-host";
      hostEl.style.all = "initial";
      hostEl.style.position = "fixed";
      hostEl.style.zIndex = "2147483647";
      hostEl.style.top = "0";
      hostEl.style.right = "0";
      hostEl.style.height = "100vh";
      shadow = hostEl.attachShadow({ mode: "open" });
      document.documentElement.appendChild(hostEl);
    }
    renderUI();
    runAISimplify();
  }

  function closeOverlay() {
    state.open = false;
    window.speechSynthesis.cancel();
    if (hostEl) {
      hostEl.remove();
      hostEl = null;
      shadow = null;
    }
  }

  function renderUI(bannerMsg = "") {
    if (!shadow) return;
    hostEl.style.width = state.splitView ? "440px" : "100vw";

    const mid = Math.ceil(state.fields.length / 2);
    const step1Fields = state.fields.slice(0, Math.max(mid, 1));
    const step2Fields = state.fields.slice(Math.max(mid, 1));
    const hasFields = state.fields.length > 0;

    const bg = state.highContrast ? "#000000" : "#0b1120";
    const card = state.highContrast ? "#000000" : "#111827";
    const text = state.highContrast ? "#ffff00" : "#f8fafc";
    const muted = state.highContrast ? "#ffffff" : "#94a3b8";
    const border = state.highContrast ? "#ffff00" : "#1f2937";
    const accent = state.highContrast ? "#00ff00" : "#6366f1";

    const renderField = (f) => {
      if (f.type === "checkbox") {
        return `
          <label class="check-row">
            <input type="checkbox" data-bind="${f.id}" ${f.value ? "checked" : ""} />
            <span>${escapeHtml(f.simplifiedLabel)}</span>
          </label>`;
      }
      if (f.tag === "select") {
        return `
          <div class="field">
            <label>${escapeHtml(f.simplifiedLabel)}${f.required ? " *" : ""}</label>
            <select data-bind="${f.id}">
              ${f.options
                .map(
                  (o) =>
                    `<option value="${escapeHtml(o.value)}" ${
                      o.value === f.value ? "selected" : ""
                    }>${escapeHtml(o.text || o.value)}</option>`
                )
                .join("")}
            </select>
          </div>`;
      }
      if (f.tag === "textarea") {
        return `
          <div class="field">
            <label>${escapeHtml(f.simplifiedLabel)}${f.required ? " *" : ""}</label>
            <textarea rows="3" data-bind="${f.id}">${escapeHtml(f.value)}</textarea>
          </div>`;
      }
      return `
        <div class="field">
          <label>${escapeHtml(f.simplifiedLabel)}${f.required ? " *" : ""}</label>
          <input type="${f.type === "password" ? "password" : "text"}" data-bind="${f.id}" value="${escapeHtml(
        f.value
      )}" placeholder="Type here — syncs live to webpage..." />
        </div>`;
    };

    const filledSummary = state.fields
      .filter((f) => f.value !== "" && f.value !== false)
      .map(
        (f) =>
          `<li><b>${escapeHtml(f.simplifiedLabel)}:</b> ${escapeHtml(
            f.type === "password" ? "••••••••" : String(f.value)
          )}</li>`
      )
      .join("");

    shadow.innerHTML = `
      <style>
        * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
        .shell {
          width: 100%; height: 100vh; background: ${bg}; color: ${text};
          border-left: 2px solid ${border}; display: flex; flex-direction: column;
          font-size: ${14 * state.fontScale}px; box-shadow: -12px 0 40px rgba(0,0,0,0.45);
        }
        .topbar {
          padding: 12px 16px; border-bottom: 1px solid ${border};
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
          background: ${card};
        }
        .logo { font-weight: 800; font-size: 1.05em; display: flex; align-items: center; gap: 8px; }
        .pill { font-size: 0.72em; padding: 2px 8px; border-radius: 999px; background: #10b98122; color: #10b981; border: 1px solid #10b98155; }
        .toolbar {
          padding: 8px 16px; border-bottom: 1px solid ${border};
          display: flex; flex-wrap: wrap; gap: 6px; background: ${bg};
        }
        button {
          cursor: pointer; border-radius: 8px; border: 1px solid ${border};
          background: ${card}; color: ${text}; padding: 6px 10px; font-size: 0.85em; font-weight: 600;
        }
        button:hover { border-color: ${accent}; }
        button.primary { background: ${accent}; color: ${state.highContrast ? "#000" : "#fff"}; border-color: transparent; }
        button.danger { background: #dc262622; color: #f87171; border-color: #ef444466; }
        button.success { background: #10b981; color: #052e16; border-color: transparent; font-weight: 800; }
        .body { flex: 1; overflow-y: auto; padding: 16px; max-width: 780px; width: 100%; margin: 0 auto; }
        .card { background: ${card}; border: 1px solid ${border}; border-radius: 12px; padding: 14px; margin-bottom: 14px; }
        .muted { color: ${muted}; font-size: 0.88em; line-height: 1.45; }
        .goal-row { display: flex; gap: 6px; margin-top: 8px; }
        input, select, textarea {
          width: 100%; padding: 9px 11px; border-radius: 8px;
          border: 1px solid ${border}; background: ${bg}; color: ${text}; font-size: 0.95em;
        }
        .field { margin-bottom: 12px; }
        .field label { display: block; font-weight: 600; margin-bottom: 5px; font-size: 0.9em; }
        .check-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; cursor: pointer; }
        .check-row input { width: 18px; height: 18px; }
        .steps { display: flex; gap: 6px; margin-bottom: 14px; }
        .step-btn { flex: 1; text-align: center; padding: 8px; border-radius: 8px; opacity: 0.6; }
        .step-btn.active { opacity: 1; border-color: ${accent}; background: ${accent}22; }
        .trap { padding: 8px 10px; border-radius: 8px; background: #ef444418; border: 1px solid #ef444444; margin-top: 8px; font-size: 0.86em; }
        .status-banner { padding: 8px 12px; border-radius: 8px; background: #10b98122; border: 1px solid #10b98155; color: #34d399; font-size: 0.85em; margin-bottom: 12px; }
        .footer { padding: 12px 16px; border-top: 1px solid ${border}; display: flex; justify-content: space-between; gap: 8px; background: ${card}; }
        ul { padding-left: 18px; margin: 8px 0; }
        li { margin-bottom: 6px; }
      </style>

      <div class="shell">
        <div class="topbar">
          <div class="logo">
            <span>WebMorph</span>
            <span class="pill">LIVE SYNC</span>
          </div>
          <div style="display:flex;gap:6px;">
            <button id="rescanBtn" title="Rescan Page">Rescan</button>
            <button id="closeBtn">✕</button>
          </div>
        </div>

        <div class="toolbar">
          <button id="splitBtn">${state.splitView ? "Full Takeover" : "Split View"}</button>
          <button id="fontBtn">A+</button>
          <button id="contrastBtn">${state.highContrast ? "Normal Contrast" : "WCAG AAA"}</button>
          <button id="readBtn">Read Aloud</button>
        </div>

        <div class="body">
          ${bannerMsg ? `<div class="status-banner" id="banner">${escapeHtml(bannerMsg)}</div>` : `<div id="banner" class="muted" style="margin-bottom:10px;"></div>`}

          <div class="card">
            <div style="font-weight:700;margin-bottom:4px;">Page Intelligence (${escapeHtml(state.language)})</div>
            <div class="muted">${escapeHtml(state.pageSummary)}</div>
          </div>

          ${
            state.traps.length || state.aiWarnings.length
              ? `<div class="card">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                    <b style="color:#f87171;">Dark Pattern Shield (${state.traps.length + state.aiWarnings.length})</b>
                    ${
                      state.traps.some((t) => !t.neutralized)
                        ? `<button class="danger" id="neutralizeBtn">Neutralize Traps</button>`
                        : `<span class="pill">Shielded</span>`
                    }
                  </div>
                  ${state.traps
                    .map(
                      (t) =>
                        `<div class="trap">${t.neutralized ? "✅ Blocked: " : "⚠️ "}${escapeHtml(t.text)}</div>`
                    )
                    .join("")}
                  ${state.aiWarnings
                    .map((w) => `<div class="trap">🔍 Fine Print: ${escapeHtml(w)}</div>`)
                    .join("")}
                </div>`
              : ""
          }

          ${
            hasFields
              ? `
                <div class="card">
                  <div style="font-weight:700;">AI Goal Auto-Fill</div>
                  <div class="muted">Describe what you want filled (e.g. "Name Alex Morgan, email alex@gmail.com, phone 9876543210").</div>
                  <div class="goal-row">
                    <input id="goalInput" placeholder="Speak or type your goal..." />
                    <button id="micBtn" title="Voice Input">🎤</button>
                    <button class="primary" id="goalBtn">Fill</button>
                  </div>
                </div>

                <div class="steps">
                  <button class="step-btn ${state.step === 1 ? "active" : ""}" data-step="1">1. Essentials</button>
                  <button class="step-btn ${state.step === 2 ? "active" : ""}" data-step="2">2. More Info</button>
                  <button class="step-btn ${state.step === 3 ? "active" : ""}" data-step="3">3. Safety Gate</button>
                </div>

                ${
                  state.step === 1
                    ? `<div class="card">${step1Fields.map(renderField).join("")}</div>`
                    : ""
                }
                ${
                  state.step === 2
                    ? `<div class="card">${
                        step2Fields.length
                          ? step2Fields.map(renderField).join("")
                          : `<div class="muted">All fields were already covered in Step 1. Continue to the Safety Gate!</div>`
                      }</div>`
                    : ""
                }
                ${
                  state.step === 3
                    ? `<div class="card">
                        <div style="font-weight:800;color:#10b981;margin-bottom:6px;">Human-in-the-Loop Safety Gate</div>
                        <div class="muted">WebMorph never clicks Submit or Pay automatically. Verify every field synced to <b>${escapeHtml(
                          location.hostname
                        )}</b> before approving:</div>
                        <ul>${filledSummary || "<li>No fields filled yet.</li>"}</ul>
                        <div class="muted" style="margin-top:8px;">Traps neutralized: <b>${state.neutralizedCount}</b></div>
                        <div style="display:flex;gap:8px;margin-top:12px;">
                          <button class="success" id="approveBtn" style="flex:1;padding:11px;">
                            ${
                              state.submitBtn
                                ? `Approve & Click "${escapeHtml(
                                    (state.submitBtn.innerText || state.submitBtn.value || "Submit").slice(0, 24)
                                  )}"`
                                : "Approve & Scroll to Page Form"
                            }
                          </button>
                        </div>
                      </div>`
                    : ""
                }
              `
              : `<div class="card">
                  <div style="font-weight:700;margin-bottom:6px;">Clean Reader Mode</div>
                  <div class="muted">No interactive form fields were found on this page, so WebMorph switched to distraction-free summary & fine-print scanning.</div>
                  <div style="margin-top:10px;line-height:1.6;">${escapeHtml(
                    (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 900)
                  )}...</div>
                </div>`
          }
        </div>

        ${
          hasFields
            ? `<div class="footer">
                <button id="prevBtn" ${state.step === 1 ? "disabled" : ""}>← Back</button>
                <span class="muted">Step ${state.step} of 3</span>
                <button class="primary" id="nextBtn" ${state.step === 3 ? "disabled" : ""}>Next →</button>
              </div>`
            : ""
        }
      </div>
    `;

    // Wire controls
    shadow.getElementById("closeBtn").onclick = closeOverlay;
    shadow.getElementById("rescanBtn").onclick = () => {
      scanPage();
      renderUI("Rescanned live DOM.");
      runAISimplify();
    };
    shadow.getElementById("splitBtn").onclick = () => {
      state.splitView = !state.splitView;
      renderUI();
    };
    shadow.getElementById("fontBtn").onclick = () => {
      state.fontScale = state.fontScale >= 1.3 ? 1 : +(state.fontScale + 0.15).toFixed(2);
      renderUI();
    };
    shadow.getElementById("contrastBtn").onclick = () => {
      state.highContrast = !state.highContrast;
      renderUI();
    };
    shadow.getElementById("readBtn").onclick = speakSummary;

    const neutBtn = shadow.getElementById("neutralizeBtn");
    if (neutBtn) neutBtn.onclick = neutralizeTraps;

    const goalInput = shadow.getElementById("goalInput");
    const goalBtn = shadow.getElementById("goalBtn");
    const micBtn = shadow.getElementById("micBtn");
    const banner = shadow.getElementById("banner");
    if (goalBtn) goalBtn.onclick = () => handleGoalSubmit(goalInput.value, banner);
    if (micBtn) micBtn.onclick = () => startVoiceGoal(goalInput, banner);
    if (goalInput) {
      goalInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleGoalSubmit(goalInput.value, banner);
      });
    }

    shadow.querySelectorAll("[data-step]").forEach((btn) => {
      btn.onclick = () => {
        state.step = Number(btn.dataset.step);
        renderUI();
      };
    });

    const prevBtn = shadow.getElementById("prevBtn");
    const nextBtn = shadow.getElementById("nextBtn");
    if (prevBtn) prevBtn.onclick = () => { if (state.step > 1) { state.step--; renderUI(); } };
    if (nextBtn) nextBtn.onclick = () => { if (state.step < 3) { state.step++; renderUI(); } };

    // Live two-way DOM sync from WebMorph inputs -> Real website DOM without jitter
    shadow.querySelectorAll("[data-bind]").forEach((input) => {
      const handler = (e) => {
        const f = state.fields.find((x) => x.id === input.dataset.bind);
        if (!f) return;
        const val = input.type === "checkbox" ? input.checked : input.value;
        f.value = val;
        const isLive = e.type === "input" && input.type !== "checkbox";
        setNativeValue(f.el, val, isLive);
      };
      input.addEventListener("input", handler);
      input.addEventListener("change", handler);
    });

    const approveBtn = shadow.getElementById("approveBtn");
    if (approveBtn) {
      approveBtn.onclick = () => {
        if (state.submitBtn) {
          state.submitBtn.scrollIntoView({ behavior: "smooth", block: "center" });
          state.submitBtn.style.outline = "4px solid #10b981";
          try {
            state.submitBtn.click();
            const form = state.submitBtn.closest("form");
            if (form && typeof form.requestSubmit === "function") {
              form.requestSubmit(state.submitBtn);
            }
          } catch (e) {
            console.warn("Submit error:", e);
          }
          renderUI("Approved! Triggered the real webpage submit button.");
        } else {
          window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
          renderUI("Verified! Review the highlighted form on the page to finish.");
        }
      };
    }
  }
})();
