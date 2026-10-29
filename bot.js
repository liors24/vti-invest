/* VTI | הבוט — Claude ישירות מהדפדפן.
   - המפתח נשמר רק במכשיר ונשלח רק ל-api.anthropic.com.
   - הזיכרון הקבוע = היומן + ההערות (localStorage). הבוט מעדכן אותם בעצמו דרך כלים.
   - השיחה עצמה נשמרת רק ל-session: בכל כניסה חדשה (או אחרי 30 דק׳ בלי פעילות) המסך נקי. */
(() => {
  "use strict";
  const V = window.VTI;
  const $ = (s) => document.querySelector(s);
  const KEY = "vti.apikey";
  const SESSION = "vti.chat";
  const MODEL = "claude-haiku-5-5"; // מהיר וזול
  const IDLE_MIN = 30;

  let messages = [];
  let busy = false;

  const getKey = () => V.store.get(KEY);
  function loadSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION));
      if (s && Date.now() - s.lastActive < IDLE_MIN * 60e3) messages = s.messages || [];
      else messages = [];
    } catch { messages = []; }
  }
  function saveSession() {
    try { sessionStorage.setItem(SESSION, JSON.stringify({ messages: messages.slice(-30), lastActive: Date.now() })); } catch {}
  }

  /* ---------- הנחיות + הקשר ---------- */
  function systemPrompt() {
    const d = V.data();
    const h = V.holdings();
    const f = V.fees();
    const sig = V.signal();
    const now = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "full", timeStyle: "short" });
    const market = d && d.status === "ok" ? {
      price: d.price, price_time_israel: new Date(d.price_time).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" }), source: d.source,
      change_day_pct: d.change_day_pct, change_week_pct: d.change_week_pct, change_month_pct: d.change_month_pct, high_52w: d.high_52w,
      last_20_closes: (d.history || []).slice(-20), headlines: (d.headlines || []).map((x) => x.title),
    } : "אין עדיין מחיר מאומת (ה-Action בגיטהאב לא רץ).";
    const journal = V.journal().slice(0, 40).map((e) => `${e.ts.slice(0, 10)}: ${V.journalLine(e)}`).join("\n") || "ריק";
    const notes = V.notes().slice(0, 40).map((n) => `- ${n.text}`).join("\n") || "ריק";

    return `אתה "VTI | סוכן ההשקעות שלי" — מדריך פיננסי אישי ואנליסט מחקר למשקיע מתחיל מישראל שעובד דרך אפליקציית Blink ומשקיע בעיקר בשוק האמריקאי, לטווח ארוך, בהון קטן. הוא מעדיף פיזור, יציבות וניהול סיכונים, ולא מעוניין במסחר אימפולסיבי, מינוף או אופציות.

איך לענות:
- עברית טבעית, חברית וברורה. תשובות קצרות למסך טלפון: 2–6 משפטים, אלא אם ביקש פירוט. בלי כותרות ובלי טבלאות.
- הסבר מושגים בפשטות. הבחן במפורש בין עובדה, פרשנות והשערה.
- כשהוא מתכנן פעולה: בדוק עמלות ביחס לסכום, פיזור (האם המניה כבר בתוך VTI), רגש/FOMO, מס (25% על רווח הון ריאלי בישראל בדרך כלל — להמליץ לוודא מול רו״ח), חשיפה לדולר, והאם זה תואם טווח ארוך. תן מסקנה ברורה: נראה סביר / שווה לחשוב / לא מומלץ — עם הסיבה.
- אל תמליץ לקנות בגלל הכרזה, התלהבות תקשורתית או עלייה חדה. אל תציג תחזית כוודאית.

כללי אמינות מחייבים:
- אין לך גישה לאינטרנט או לנתונים חיים. נתוני השוק היחידים שיש לך הם בתמונת המצב למטה, עם הזמן שלהם. ציין את הזמן כשאתה מסתמך עליהם. אל תמציא מחירים, תשואות, חדשות או מקורות.
- על מניות אחרות יש לך רק ידע כללי שעלול להיות ישן — אמור זאת.
- אתה לא מחובר ל-Blink ולא מבצע פעולות. אתה לא יועץ השקעות מורשה, ולא מבטיח רווח.

זיכרון:
- כשהמשתמש מספר על פעולה שביצע (קנה, מכר, הפקיד, קיבל דיבידנד) — קרא ל-log_action עם מה שידוע. אם זו קנייה/מכירה של VTI ויש כמות ומחיר, התיק במכשיר יתעדכן אוטומטית. אם חסרה כמות או מחיר — רשום בלי, ובקש ממנו את הנתון אם הוא רוצה שהתיק יתעדכן.
- כשהוא מתכנן משהו לעתיד — log_action עם type "plan".
- כשהוא אומר מטרה, העדפה או עובדה על עצמו שכדאי לזכור (למשל "אני מפקיד 50$ בחודש", "העמלה ב-Blink היא X") — קרא ל-save_note.
- אל תרשום את אותו דבר פעמיים. אחרי רישום, ציין בקצרה שרשמת.

עכשיו: ${now} (שעון ישראל)

תמונת מצב של השוק (מ-data/vti.json):
${JSON.stringify(market)}

התיק (חישוב משוער במכשיר): ${JSON.stringify({ units: h.units, avg_price: h.avg_price, cost: +h.cost.toFixed(2), value: h.value != null ? +h.value.toFixed(2) : null, pnl_pct: h.pnl_pct != null ? +h.pnl_pct.toFixed(2) : null, broker: "Blink" })}
המלצת המעקב של האפליקציה: ${sig ? `${sig.title}` : "אין"}
עמלות שהגדיר: ${f.fee != null ? `$${f.fee} לפעולה` : "לא הוגדרה"}${f.fx != null ? `, המרה ${f.fx}%` : ""}

יומן הפעולות שלו (החדש ראשון):
${journal}

דברים שביקש שתזכור:
${notes}`;
  }

  const TOOLS = [
    {
      name: "log_action",
      description: "רושם ביומן של המשתמש פעולה שביצע ב-Blink או תוכנית לעתיד. השתמש כשהמשתמש מספר מה עשה או מה הוא מתכנן.",
      input_schema: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["buy", "sell", "deposit", "dividend", "plan", "note"], description: "סוג הפעולה" },
          symbol: { type: "string", description: "סימול, למשל VTI" },
          amount_usd: { type: "number", description: "סכום בדולרים" },
          units: { type: "number", description: "כמות יחידות, אם ידועה" },
          price: { type: "number", description: "מחיר ליחידה בדולרים, אם ידוע" },
          note: { type: "string", description: "הערה קצרה בעברית" },
        },
        required: ["type"],
      },
    },
    {
      name: "save_note",
      description: "שומר בזיכרון הקבוע עובדה, מטרה או העדפה של המשתמש, כדי לזכור אותה בשיחות הבאות.",
      input_schema: { type: "object", properties: { text: { type: "string", description: "המשפט לשמירה, בעברית" } }, required: ["text"] },
    },
  ];

  function runTool(name, input) {
    if (name === "log_action") {
      const clean = {};
      for (const k of ["type", "symbol", "note"]) if (input[k]) clean[k] = String(input[k]).slice(0, 200);
      for (const k of ["amount_usd", "units", "price"]) if (+input[k] > 0) clean[k] = +input[k];
      const { entry, holdingsUpdated } = V.addJournal({ ...clean, source: "bot" });
      const h = V.holdings();
      return { result: { ok: true, recorded: V.journalLine(entry), holdings_updated: holdingsUpdated, holdings_now: holdingsUpdated ? { units: h.units, avg_price: h.avg_price } : undefined }, chip: `נרשם ביומן: ${V.journalLine(entry)}${holdingsUpdated ? " · התיק עודכן" : ""}` };
    }
    if (name === "save_note") {
      V.addNote(input.text || "");
      return { result: { ok: true }, chip: `נשמר בזיכרון: ${String(input.text || "").slice(0, 80)}` };
    }
    return { result: { ok: false, error: "unknown tool" }, chip: null };
  }

  /* ---------- קריאה ל-API בזרימה ---------- */
  async function streamOnce(onText) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": getKey(),
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system: systemPrompt(), tools: TOOLS, messages, stream: true }),
    });
    if (!res.ok) {
      let msg = "";
      try { msg = (await res.json()).error?.message || ""; } catch {}
      const e = new Error(msg); e.status = res.status; throw e;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", stop = null;
    const blocks = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        if (ev.type === "content_block_start") {
          const b = ev.content_block;
          blocks[ev.index] = b.type === "tool_use" ? { type: "tool_use", id: b.id, name: b.name, _json: "" } : { type: "text", text: "" };
        } else if (ev.type === "content_block_delta") {
          const b = blocks[ev.index];
          if (ev.delta.type === "text_delta") { b.text += ev.delta.text; onText(ev.delta.text); }
          else if (ev.delta.type === "input_json_delta") b._json += ev.delta.partial_json;
        } else if (ev.type === "content_block_stop") {
          const b = blocks[ev.index];
          if (b && b.type === "tool_use") { try { b.input = b._json ? JSON.parse(b._json) : {}; } catch { b.input = {}; } delete b._json; }
        } else if (ev.type === "message_delta") {
          stop = ev.delta.stop_reason;
        } else if (ev.type === "error") {
          const e = new Error(ev.error?.message || ""); e.status = ev.error?.type === "overloaded_error" ? 529 : 500; throw e;
        }
      }
    }
    return { content: blocks.filter((b) => b && !(b.type === "text" && !b.text)), stop };
  }

  /* ---------- תצוגה ---------- */
  const log = () => $("#chatLog");
  function fmt(text) {
    return V.esc(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  }
  function bubble(role, text) {
    const el = document.createElement("div");
    el.className = "msg " + role;
    el.innerHTML = `<span class="txt">${fmt(text || "")}</span><div class="chips"></div>`;
    log().append(el);
    return el;
  }
  function addChip(el, text) {
    const c = document.createElement("span"); c.className = "chip"; c.textContent = "✓ " + text;
    el.querySelector(".chips").append(c);
  }
  function scrollDown() { requestAnimationFrame(() => scrollTo({ top: document.body.scrollHeight })); }

  function renderAll() {
    const keyMissing = !getKey();
    const setup = $("#botSetup");
    setup.hidden = !keyMissing;
    setup.innerHTML = keyMissing ? `<div class="setup"><h2>חיבור הבוט — פעם אחת</h2>
      <p class="muted">הבוט רץ על Claude של Anthropic, ישירות מהאייפון שלך. צריך מפתח אישי:</p>
      <ol><li>היכנס ל־<a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>, הירשם והוסף אמצעי תשלום (חיוב לפי שימוש; לשאלות קצרות זה לרוב סנטים בודדים).</li>
      <li>צור מפתח (Create Key) והעתק אותו.</li>
      <li>הדבק אותו ב־<a href="#botsettings">הגדרות הבוט</a>.</li></ol></div>` : "";
    const el = log();
    el.innerHTML = "";
    const visible = messages.filter((m) => typeof m.content === "string" || m.content.some((b) => b.type === "text"));
    if (!visible.length) {
      el.innerHTML = `<div class="hello"><b>שלום! מה תרצה לדעת?</b>אני מכיר את התיק שלך, את היומן ואת המחיר האחרון של VTI. ספר לי מה עשית ב־Blink ואזכור את זה.</div>`;
    }
    for (const m of visible) {
      const text = typeof m.content === "string" ? m.content : m.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      if (text) bubble(m.role === "user" ? "user" : "bot", text);
    }
    const sugg = ["מה המצב של התיק שלי?", "קניתי היום VTI ב־Blink", "כדאי לי לקנות עכשיו?", "מה עדיף: VTI או מניה של Apple?", "איך עובד מס על רווחים?"];
    $("#suggest").innerHTML = visible.length ? "" : sugg.map((s) => `<button type="button">${s}</button>`).join("");
    $("#chatForm .send").disabled = keyMissing;
    $("#chatInput").disabled = keyMissing;
  }

  async function send(text) {
    if (busy || !text.trim()) return;
    if (!getKey()) { location.hash = "#botsettings"; return; }
    busy = true; $("#chatForm .send").disabled = true;
    $("#suggest").innerHTML = "";
    if (!messages.length) log().innerHTML = "";
    const before = messages.length;
    messages.push({ role: "user", content: text.trim() });
    bubble("user", text.trim());
    const out = bubble("bot typing", "");
    const txt = out.querySelector(".txt");
    let shown = "";
    scrollDown();
    try {
      for (let round = 0; round < 4; round++) {
        const { content, stop } = await streamOnce((t) => { shown += t; txt.innerHTML = fmt(shown); scrollDown(); });
        messages.push({ role: "assistant", content });
        if (stop !== "tool_use") break;
        const results = [];
        for (const b of content.filter((x) => x.type === "tool_use")) {
          const { result, chip } = runTool(b.name, b.input || {});
          results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(result) });
          if (chip) addChip(out, chip);
        }
        messages.push({ role: "user", content: results });
        if (shown && !shown.endsWith("\n")) shown += "\n";
      }
      out.classList.remove("typing");
      if (!shown.trim()) txt.innerHTML = fmt("רשמתי.");
    } catch (e) {
      out.remove();
      // מחזיר את השיחה למצב שלפני השאלה שנכשלה (פעולות שכבר נרשמו ביומן נשארות)
      messages.length = before;
      const m = e.status === 401 ? "המפתח לא תקין. בדוק אותו בהגדרות הבוט."
        : e.status === 400 && /credit|balance/i.test(e.message) ? "אין יתרה בחשבון Anthropic. הוסף קרדיט ב־console.anthropic.com."
        : e.status === 429 ? "יותר מדי שאלות ברצף. חכה דקה ונסה שוב."
        : e.status === 529 || e.status >= 500 ? "השרת של Anthropic עמוס כרגע. נסה שוב בעוד רגע."
        : e.status ? `השאלה לא נשלחה (${e.status}). ${e.message || ""}`
        : "אין חיבור לאינטרנט. השאלה לא נשלחה.";
      const er = bubble("err", m);
      er.setAttribute("role", "alert");
      $("#chatInput").value = text;
    } finally {
      busy = false; $("#chatForm .send").disabled = !getKey();
      saveSession(); scrollDown();
    }
  }

  /* ---------- אירועים ---------- */
  const input = $("#chatInput");
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(140, input.scrollHeight) + "px"; });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(hover:hover)").matches) { e.preventDefault(); $("#chatForm").requestSubmit(); } });
  $("#chatForm").addEventListener("submit", (e) => { e.preventDefault(); const t = input.value; input.value = ""; input.style.height = "auto"; send(t); });
  $("#suggest").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { if (b.textContent.startsWith("קניתי")) { input.value = "קניתי היום VTI ב־Blink: "; input.focus(); } else send(b.textContent); } });
  $("#newChat").addEventListener("click", () => { messages = []; saveSession(); renderAll(); V.toast("שיחה חדשה. היומן והזיכרון נשמרו"); });

  $("#keyForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const k = e.target.key.value.trim();
    if (!/^sk-ant-[\w-]{20,}$/.test(k)) { $("#keyError").textContent = "המפתח צריך להתחיל ב־sk-ant- . העתק אותו שוב מ־console.anthropic.com."; return; }
    $("#keyError").textContent = "";
    V.store.set(KEY, k); e.target.key.value = "";
    V.toast("המפתח נשמר. אפשר לשאול את הבוט");
    location.hash = "#bot";
  });
  $("#removeKey").addEventListener("click", () => { V.store.del(KEY); V.toast("המפתח הוסר מהמכשיר"); renderAll(); });

  window.VTIBot = {
    show() { loadSession(); renderAll(); scrollDown(); },
    prefill(t) { input.value = t; setTimeout(() => input.focus(), 50); },
    reset() { messages = []; try { sessionStorage.removeItem(SESSION); } catch {} renderAll(); },
  };
  if (location.hash === "#bot") window.VTIBot.show();
})();
