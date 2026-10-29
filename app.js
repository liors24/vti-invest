/* VTI | סוכן ההשקעות שלי — אפליקציה ראשית
   נתוני שוק: data/vti.json (מתעדכן ע"י GitHub Actions). אין כאן נתונים מומצאים.
   תיק, יומן, הערות ומפתח הבוט — נשמרים רק במכשיר (localStorage). */
(() => {
  "use strict";

  const K = { hold: "vti.holdings", fees: "vti.fees", journal: "vti.journal", notes: "vti.notes", theme: "vti.theme" };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = {
    get(k, d = null) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  let DATA = null;
  let RANGE = 63;

  /* ---------- עיצוב מספרים ---------- */
  const usd = (n, d = 2) => (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const signedUsd = (n, d = 2) => (n > 0 ? "+" : "") + usd(n, d);
  const pct = (n) => (n == null || isNaN(n)) ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(2) + "%";
  const dirClass = (n) => n == null ? "flat" : Math.abs(n) < 0.005 ? "flat" : n > 0 ? "up" : "down";
  const ilTime = (iso) => new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const ilDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const iso = (s) => `<span class="num">${s}</span>`;
  const bidi = (s) => esc(s).replace(/⁦/g, '<span class="num">').replace(/⁩/g, "</span>");
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[,$\s]/g, "")); return isFinite(n) ? n : NaN; };
  const daysAgo = (ts) => (Date.now() - new Date(ts).getTime()) / 864e5;

  /* ---------- ערכת צבעים ---------- */
  function applyTheme(t) {
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    $$("#themeSeg button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.theme === (t || "auto"))));
  }
  applyTheme(store.get(K.theme));

  /* ---------- תיק, עמלות, יומן, הערות ---------- */
  function holdings() {
    const local = store.get(K.hold);
    const base = (DATA && DATA.portfolio) || { units: 0.0264, avg_price: 377.91 };
    const h = local || base;
    const units = +h.units, avg = +h.avg_price;
    return { units, avg_price: avg, cost: +(units * avg).toFixed(4), local: !!local, broker: base.broker || "Blink" };
  }
  function portfolioNow() {
    const h = holdings();
    if (!DATA || DATA.status !== "ok") return { ...h, value: null, pnl: null, pnl_pct: null };
    const value = h.units * DATA.price, pnl = value - h.cost;
    return { ...h, value, pnl, pnl_pct: h.cost ? (pnl / h.cost) * 100 : 0 };
  }
  const fees = () => store.get(K.fees, {});
  const journal = () => store.get(K.journal, []);
  const notes = () => store.get(K.notes, []);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function addJournal(e) {
    const entry = { id: uid(), ts: new Date().toISOString(), ...e };
    if (entry.symbol) entry.symbol = String(entry.symbol).toUpperCase();
    const j = journal(); j.unshift(entry); store.set(K.journal, j.slice(0, 300));
    let holdingsUpdated = false;
    // פעולה על VTI עם כמות ומחיר → מעדכן את התיק במכשיר
    if (entry.symbol === "VTI" && entry.units > 0 && entry.price > 0 && (entry.type === "buy" || entry.type === "sell")) {
      const h = holdings();
      if (entry.type === "buy") {
        const u = h.units + entry.units;
        store.set(K.hold, { units: +u.toFixed(6), avg_price: +((h.units * h.avg_price + entry.units * entry.price) / u).toFixed(4) });
      } else {
        store.set(K.hold, { units: +Math.max(0, h.units - entry.units).toFixed(6), avg_price: h.avg_price });
      }
      holdingsUpdated = true;
    }
    renderJournal(); if (DATA) renderHome();
    return { entry, holdingsUpdated };
  }
  function removeJournal(id) { store.set(K.journal, journal().filter((x) => x.id !== id)); renderJournal(); renderNotes(); }
  function addNote(text) { const n = notes(); n.unshift({ id: uid(), ts: new Date().toISOString(), text: String(text).slice(0, 400) }); store.set(K.notes, n.slice(0, 100)); renderNotes(); }
  function removeNote(id) { store.set(K.notes, notes().filter((x) => x.id !== id)); renderNotes(); }

  const TYPE_HE = { buy: "קנייה", sell: "מכירה", deposit: "הפקדה", plan: "תוכנית", note: "הערה", dividend: "דיבידנד" };
  function journalLine(e) {
    const bits = [TYPE_HE[e.type] || e.type];
    if (e.symbol) bits.push(e.symbol);
    if (e.amount_usd) bits.push(usd(e.amount_usd));
    if (e.units) bits.push(`${(+e.units).toFixed(4)} יח׳`);
    if (e.price) bits.push(`ב־${usd(e.price)}`);
    return bits.join(" · ") + (e.note ? ` — ${e.note}` : "");
  }
  function renderJournal() {
    const el = $("#journalList"); if (!el) return;
    const j = journal();
    el.innerHTML = j.length ? j.map((e) => `<li><span>${esc(journalLine(e))}<br><span class="when">${new Date(e.ts).toLocaleDateString("he-IL")}${e.source === "bot" ? " · נרשם ע״י הבוט" : ""}</span></span><button class="x" data-del="${e.id}" aria-label="מחיקת הרשומה">✕</button></li>`).join("")
      : `<li class="empty">עוד אין פעולות. בדוק תוכנית למעלה ורשום אותה, או ספר לבוט מה עשית.</li>`;
  }
  function renderNotes() {
    const el = $("#notesList"); if (!el) return;
    const items = [...notes().map((n) => ({ ...n, kind: "note" })), ...journal().slice(0, 10).map((e) => ({ ...e, kind: "j", text: journalLine(e) }))];
    el.innerHTML = items.length ? items.map((n) => `<li><span>${esc(n.text)}<br><span class="when">${n.kind === "note" ? "זיכרון" : "יומן"} · ${new Date(n.ts).toLocaleDateString("he-IL")}</span></span><button class="x" data-${n.kind === "note" ? "delnote" : "del"}="${n.id}" aria-label="מחיקה">✕</button></li>`).join("")
      : `<li class="empty">הבוט עוד לא זוכר כלום. ספר לו על הפעולות והמטרות שלך.</li>`;
  }
  document.addEventListener("click", (e) => {
    const d = e.target.closest("[data-del]"); if (d) removeJournal(d.dataset.del);
    const n = e.target.closest("[data-delnote]"); if (n) removeNote(n.dataset.delnote);
  });

  /* ---------- כללי המלצת מעקב (זהים לסקריפט בגיטהאב) ---------- */
  function signal(d, p) {
    const day = d.change_day_pct, week = d.change_week_pct;
    const dd = d.high_52w ? (d.price / d.high_52w - 1) * 100 : 0;
    if (Math.abs(day ?? 0) >= 5 || dd <= -20)
      return { level: "risk", title: "סיכון משמעותי — כדאי לבדוק", reason: Math.abs(day ?? 0) >= 5 ? `תנועה חריגה של ${iso(pct(day))} ביום אחד.` : `הקרן נמצאת ${iso(Math.abs(dd).toFixed(1) + "%")} מתחת לשיא השנתי — מצב של שוק דובי.`, extra: "זה לא סימן למכור. ירידות כאלה קרו בעבר. בדוק שהסכום שהשקעת עדיין מתאים לך.", dd };
    if (Math.abs(day ?? 0) >= 3 || Math.abs(week ?? 0) >= 5 || p.pnl_pct <= -10)
      return { level: "check", title: "כדאי לבדוק", reason: Math.abs(day ?? 0) >= 3 ? `תנועה יומית גדולה מהרגיל: ${iso(pct(day))}.` : Math.abs(week ?? 0) >= 5 ? `תנועה שבועית גדולה מהרגיל: ${iso(pct(week))}.` : `התשואה שלך: ${iso(pct(p.pnl_pct))} ממחיר הקנייה.`, extra: "קרא מה קרה בשוק לפני כל החלטה. החלטות רגשיות הן הטעות הנפוצה ביותר.", dd };
    return { level: "ok", title: "אין צורך בפעולה", reason: "תנודות רגילות. האסטרטגיה לטווח ארוך לא משתנה בגלל שבוע אחד.", extra: "", dd };
  }

  /* ---------- "מה כדאי לעשות עכשיו" — הסבר והצעה בכל כניסה ---------- */
  function advice(d, p, s) {
    const out = [];
    const f = fees();
    const j = journal();
    const lastBuy = j.find((x) => x.type === "buy");

    if (s.level === "risk") out.push({ ic: "⚠", t: "לא לפעול בלחץ", b: "השוק בתנועה חדה. אם אתה שוקל למכור — בדוק קודם את התוכנית במסך ״תוכנית״ וחכה לפחות יום אחד." });
    else if (s.level === "check" && (d.change_day_pct ?? 0) < 0) out.push({ ic: "↘", t: "ירידה — לא בהכרח בעיה", b: "למשקיע לטווח ארוך, ירידות הן חלק מהדרך. אם תכננת לקנות ממילא, זה לא סיבה לדחות; אם לא תכננת — אין סיבה להיכנס עכשיו בגלל הירידה." });
    else if ((d.change_week_pct ?? 0) >= 3) out.push({ ic: "↗", t: "עלייה חדה השבוע", b: "אל תקנה רק כי זה עולה (FOMO). קנייה מתוכננת וקבועה עדיפה על תזמון השוק." });
    else out.push({ ic: "✓", t: "אין צורך בפעולה היום", b: "המצב רגיל. הדבר הכי טוב שאפשר לעשות כרגע הוא להמשיך לפי התוכנית שלך." });

    if (!(f.fee >= 0) || f.fee === "") out.push({ ic: "$", t: "הגדר את העמלה של Blink", b: "בסכומים קטנים, עמלה קבועה יכולה לאכול אחוזים מהתשואה. הזן אותה במסך ״התיק שלי״ ותקבל חישוב לכל תוכנית." });
    else if (f.fee > 0) out.push({ ic: "$", t: `קנייה מינימלית משתלמת: ${usd(Math.ceil(f.fee * 100))}`, b: `בעמלה של ${usd(f.fee)} לפעולה, סכום כזה שומר על העמלה עד 1%. במקום לקנות כל שבוע בסכום קטן — שקול לצבור ולקנות פעם בחודש.` });

    if (!lastBuy) out.push({ ic: "✎", t: "רשום את הפעולות שלך", b: "כשאתה רושם קניות ביומן (או מספר לבוט), הוא זוכר אותן ונותן עצות לפי מה שעשית בפועל." });
    else if (daysAgo(lastBuy.ts) > 30) out.push({ ic: "◷", t: `עברו ${Math.floor(daysAgo(lastBuy.ts))} ימים מהקנייה האחרונה`, b: "אם יש לך תוכנית הפקדה חודשית — זה הזמן להמשיך, לפי התוכנית ולא לפי מצב השוק." });

    // ריכוזיות במניות בודדות לפי היומן
    const single = j.filter((x) => x.type === "buy" && x.symbol && x.symbol !== "VTI").reduce((a, x) => a + (+x.amount_usd || 0), 0);
    if (single > 0 && p.value && single / (single + p.value) > 0.2) out.push({ ic: "◔", t: "יותר מ־20% במניות בודדות", b: "לפי היומן שלך, חלק גדול מהכסף במניות בודדות. זה מעלה סיכון. ודא שזו בחירה מודעת." });

    return out.slice(0, 3);
  }

  /* ---------- מצב שוק ---------- */
  function marketState() {
    const ny = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = ny.getDay(), mins = ny.getHours() * 60 + ny.getMinutes();
    if (day === 0 || day === 6) return "הבורסה בניו יורק סגורה (סוף שבוע).";
    if (mins >= 570 && mins < 960) return "הבורסה בניו יורק פתוחה עכשיו (לפי שעות רגילות).";
    if (mins < 570) return "הבורסה בניו יורק עוד לא נפתחה היום — נפתחת ב־16:30 שעון ישראל בערך.";
    return "הבורסה בניו יורק נסגרה להיום.";
  }

  /* ---------- טעינה ---------- */
  async function load(showSpin) {
    const btn = $("#refreshBtn");
    if (showSpin) btn.classList.add("spin");
    if (!DATA) $("#homeState").innerHTML = `<div aria-busy="true"><div class="skeleton" style="width:40%;margin-top:30px"></div><div class="skeleton" style="height:56px;width:70%"></div><div class="skeleton" style="height:160px"></div></div>`;
    try {
      const r = await fetch("data/vti.json?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("http " + r.status);
      DATA = await r.json();
      renderHome(); renderWidgetPreview();
      if (showSpin) toast("הנתונים עודכנו מהקובץ האחרון בגיטהאב");
    } catch {
      if (!DATA) $("#homeState").innerHTML = stateBox("אין חיבור לנתונים", "<p>לא הצלחתי לקרוא את <code>data/vti.json</code>. בדוק חיבור לאינטרנט ונסה שוב.</p>");
      else toast("לא הצלחתי לרענן. מוצגים הנתונים האחרונים שנטענו.");
    } finally { btn.classList.remove("spin"); }
  }
  const stateBox = (t, body) => `<div class="state"><h2>${t}</h2>${body}</div>`;

  /* ---------- מסך מצב ---------- */
  function renderHome() {
    const d = DATA;
    if (!d || d.status !== "ok" || !d.price) {
      $("#homeContent").hidden = true;
      $("#homeState").innerHTML = stateBox("עוד אין מחיר מאומת", `
        <p>האפליקציה לא מציגה מחירים בלי מקור. הנתונים נאספים על ידי GitHub Actions.</p>
        <ol><li>בגיטהאב, פתח את הלשונית <b>Actions</b>.</li><li>בחר <b>Update VTI data</b> ולחץ <b>Run workflow</b>.</li><li>חכה כדקה ורענן כאן.</li></ol>
        <p style="margin-top:12px">בינתיים אפשר לבדוק תוכנית, לרשום פעולות ולשאול את הבוט.</p>`);
      return;
    }
    $("#homeState").innerHTML = "";
    $("#homeContent").hidden = false;

    const p = portfolioNow();
    $("#heroValue").textContent = usd(p.value);
    $("#heroPnl").innerHTML = `<span class="${dirClass(p.pnl)} num">${signedUsd(p.pnl)} (${pct(p.pnl_pct)})</span> <span class="muted">מאז הקנייה</span>`;

    const set = (id, txt, cls) => { const el = $(id); el.textContent = txt; el.className = "num " + (cls || ""); };
    set("#kPrice", usd(d.price));
    set("#kDay", pct(d.change_day_pct), dirClass(d.change_day_pct));
    set("#kWeek", pct(d.change_week_pct), dirClass(d.change_week_pct));
    set("#kMonth", pct(d.change_month_pct), dirClass(d.change_month_pct));
    set("#kUnits", p.units.toFixed(4));
    set("#kAvg", usd(p.avg_price));
    set("#kCost", usd(p.cost));
    set("#kPnl", pct(p.pnl_pct), dirClass(p.pnl));

    const s = signal(d, p);
    const v = $("#verdict");
    v.dataset.level = s.level;
    v.innerHTML = `<div class="verdict-head"><span class="verdict-dot" aria-hidden="true"></span>${s.title}</div><p>${s.reason}</p>${s.extra ? `<p class="muted">${s.extra}</p>` : ""}`;

    $("#adviceList").innerHTML = advice(d, p, s).map((a) => `<li><span class="ic" aria-hidden="true">${a.ic}</span><div><b>${a.t}</b><p>${a.b}</p></div></li>`).join("");

    $("#marketState").textContent = marketState();
    const news = d.headlines || [];
    $("#newsList").innerHTML = news.length
      ? news.map((n) => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="meta">${esc(n.source || "")}${n.date ? " · " + new Date(n.date).toLocaleDateString("en-GB") : ""}</div></li>`).join("") +
        `<li class="muted small" style="border:0">כותרות מהמקור, באנגלית. אלו כותרות בלבד ולא ניתוח — אפשר לבקש מהבוט להסביר.</li>`
      : `<li class="muted small">אין כותרות חדשות מהשבוע האחרון.</li>`;

    const stale = daysAgo(d.price_time) > 4;
    $("#stamp").innerHTML = `מחיר מ־${esc(d.source)} · נכון ל־${ilTime(d.price_time)} (שעון ישראל)${stale ? ` · <b class="down">הנתונים ישנים — בדוק שה־Action רץ</b>` : ""}<br>חישוב משוער, לא היתרה הרשמית ב־${esc(p.broker)}. לא כולל עמלות, מס והמרת מטבע.${p.local ? "<br>משתמש בנתוני תיק שעדכנת במכשיר." : ""}`;

    drawChart();
  }

  /* ---------- גרף ---------- */
  function drawChart() {
    const pts = (DATA.history || []).filter((x) => x.c != null).slice(-RANGE);
    const box = $("#chart");
    if (pts.length < 2) { box.innerHTML = `<p class="muted small">אין מספיק היסטוריה לגרף.</p>`; $("#chartCap").textContent = ""; return; }
    const h = holdings();
    const W = box.clientWidth || 340, H = box.clientHeight || 190, padT = 22, padB = 8;
    const vals = pts.map((p) => p.c).concat([h.avg_price]);
    const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
    const x = (i) => (i / (pts.length - 1)) * W;
    const y = (v) => padT + (1 - (v - min) / span) * (H - padT - padB);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join("");
    const chg = (pts.at(-1).c / pts[0].c - 1) * 100;
    const col = `var(--${dirClass(chg)})`;
    const ay = y(h.avg_price);
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="גרף מחיר VTI בטווח הנבחר, שינוי של ${pct(chg)}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".18"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      <path d="${line}L${W},${H}L0,${H}Z" fill="url(#g)"/>
      <line x1="0" x2="${W}" y1="${ay}" y2="${ay}" stroke="var(--muted)" stroke-dasharray="4 4" stroke-width="1"/>
      <text x="${W}" y="${ay - 6}" text-anchor="end" font-size="11" fill="var(--muted)" style="direction:ltr;unicode-bidi:plaintext">המחיר שקנית ${usd(h.avg_price)}</text>
      <path d="${line}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(pts.length - 1)}" cy="${y(pts.at(-1).c)}" r="4" fill="${col}"/>
      <line id="cur" x1="0" x2="0" y1="${padT}" y2="${H}" stroke="var(--ink)" stroke-width="1" opacity="0"/>
    </svg><div class="tip" id="tip" hidden></div>`;
    const labels = { 21: "בחודש האחרון", 63: "ב־3 החודשים האחרונים", 252: "בשנה האחרונה" };
    $("#chartCap").innerHTML = `מחיר הקרן ${labels[RANGE]}: <span class="num ${dirClass(chg)}">${pct(chg)}</span>`;

    const svg = box.querySelector("svg"), tip = $("#tip"), cur = $("#cur");
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      const i = Math.max(0, Math.min(pts.length - 1, Math.round((cx / r.width) * (pts.length - 1))));
      cur.setAttribute("x1", x(i)); cur.setAttribute("x2", x(i)); cur.setAttribute("opacity", ".35");
      tip.hidden = false; tip.style.left = Math.max(40, Math.min(r.width - 40, (x(i) / W) * r.width)) + "px";
      tip.textContent = `${new Date(pts[i].d + "T12:00:00Z").toLocaleDateString("he-IL", { day: "numeric", month: "numeric" })} · ${usd(pts[i].c)}`;
    };
    const leave = () => { tip.hidden = true; cur.setAttribute("opacity", "0"); };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("touchmove", move, { passive: true });
    svg.addEventListener("pointerleave", leave);
    svg.addEventListener("touchend", leave);
  }
  $$(".range button").forEach((b) => b.addEventListener("click", () => {
    RANGE = +b.dataset.range;
    $$(".range button").forEach((o) => o.setAttribute("aria-selected", String(o === b)));
    if (DATA && DATA.status === "ok") drawChart();
  }));
  let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => DATA && DATA.status === "ok" && !$("#view-home").hidden && drawChart(), 150); });

  /* ---------- בודק תוכניות ---------- */
  let planType = "buy";
  $$("#planType button").forEach((b) => b.addEventListener("click", () => {
    planType = b.dataset.v;
    $$("#planType button").forEach((o) => o.setAttribute("aria-checked", String(o === b)));
  }));

  function evaluatePlan({ type, symbol, amount, cushion, calm }) {
    const pts = []; // [level, text]
    const f = fees(); const p = portfolioNow(); const d = DATA && DATA.status === "ok" ? DATA : null;
    const isVTI = symbol === "VTI";
    const feeUsd = (f.fee > 0 ? +f.fee : 0) + (f.fx > 0 ? amount * f.fx / 100 : 0);

    if (f.fee === undefined || f.fee === "" || isNaN(f.fee)) pts.push(["check", "לא הגדרת עמלה. בדוק בתעריפון של Blink כמה עולה פעולה, והזן אותה במסך ״התיק שלי״ — בסכומים קטנים זה משמעותי."]);
    else if (feeUsd > 0) {
      const fp = feeUsd / amount * 100;
      pts.push([fp > 2 ? "risk" : fp > 1 ? "check" : "ok", `העמלות יעלו בערך ${usd(feeUsd)} — ${iso(fp.toFixed(1) + "%")} מהסכום. ${fp > 1 ? (f.fee > 0 ? `כדי שהעמלה הקבועה תרד ל־1%, צבור לסכום של לפחות ${usd(Math.ceil(f.fee * 100), 0)} ובצע פעולה אחת.` : "שקול לצבור לסכום גדול יותר.") : "עמלה סבירה ביחס לסכום."}`]);
    }
    if (!cushion) pts.push(["check", "לא סימנת שיש לך כרית ביטחון. כסף שאולי תצטרך בקרוב לא כדאי להשקיע במניות — הוא עלול להיות בירידה בדיוק כשתצטרך אותו."]);
    if (!calm) pts.push(["check", "אם ההחלטה הגיעה מכותרת, התלהבות או פחד — חכה 24 שעות ובדוק שוב. החלטות רגשיות הן הטעות הנפוצה ביותר."]);

    if (type === "buy") {
      if (isVTI) {
        pts.push(["ok", "VTI היא קרן מפוזרת על כל השוק האמריקאי — מתאימה לאסטרטגיה ארוכת טווח ולמשקיע מתחיל."]);
        if (d) {
          const units = Math.max(0, amount - feeUsd) / d.price;
          pts.push(["ok", `לפי המחיר האחרון (${usd(d.price)}) תקבל בערך ${iso(units.toFixed(4))} יחידות. המחיר בפועל ב־Blink יכול להיות מעט שונה.`]);
          if ((d.change_week_pct ?? 0) >= 3) pts.push(["check", `הקרן עלתה ${iso(pct(d.change_week_pct))} השבוע. אם הקנייה מתוכננת — היא בסדר. אם היא רק בגלל העלייה — זה FOMO.`]);
          if ((d.change_week_pct ?? 0) <= -3) pts.push(["ok", `הקרן ירדה ${iso(pct(d.change_week_pct))} השבוע. קנייה בירידה עקבית עם טווח ארוך — בתנאי שהסכום מתוכנן ולא כל הכסף בבת אחת.`]);
        }
      } else {
        const share = p.value != null ? amount / (p.value + amount) * 100 : null;
        pts.push(["check", `${symbol} היא מניה בודדת — סיכון גבוה יותר מקרן. אם זו חברה אמריקאית גדולה, סביר שהיא כבר בתוך VTI, וקנייה ישירה מגדילה את החשיפה אליה.`]);
        if (share != null) pts.push([share > 20 ? "risk" : "check", `היא תהיה בערך ${iso(share.toFixed(0) + "%")} מהתיק שלך. ${share > 20 ? "למתחיל, מעל 20% במניה אחת זה ריכוז גבוה." : "חשיפה מתונה."}`]);
        pts.push(["check", "אל תקנה רק בגלל הכרזה על מוצר או קפיצה במחיר. שאל את הבוט על החברה: הכנסות, רווחיות, חוב ותמחור."]);
      }
    } else {
      if (isVTI && p.value != null) {
        if (amount > p.value + 0.01) pts.push(["risk", `הסכום גדול מהשווי המשוער שלך (${usd(p.value)}).`]);
        if (p.pnl < 0) pts.push([(DATA && signal(DATA, p).level !== "ok") ? "risk" : "check", "מכירה עכשיו תממש הפסד. אם הסיבה היא ירידה בשוק — זו בדיוק ההחלטה הרגשית שכדאי להימנע ממנה בהשקעה לטווח ארוך."]);
        else if (p.pnl > 0) pts.push(["check", `יש לך רווח. על רווח הון בישראל חל בדרך כלל מס של 25% על הרווח הריאלי. במכירה של ${usd(amount)} זה בערך ${usd(amount * (p.pnl / p.value) * 0.25)}. בדוק מול רואה חשבון.`]);
      }
      pts.push(["check", "מכירה היא החלטה גדולה יותר מקנייה. שאל את עצמך: מה השתנה בתוכנית שלי? אם התשובה היא ״השוק ירד״ — זו לא סיבה."]);
    }

    const rank = { ok: 0, check: 1, risk: 2 };
    const level = pts.reduce((m, [l]) => (rank[l] > rank[m] ? l : m), "ok");
    const title = { ok: "נראה סביר", check: "שווה לחשוב רגע", risk: "לא מומלץ כרגע" }[level];
    return { level, title, pts, feeUsd };
  }

  $("#planForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const symbol = String(fd.get("symbol") || "").trim().toUpperCase().replace(/[^A-Z.]/g, "");
    const amount = num(fd.get("amount"));
    if (!symbol) return ($("#planError").textContent = "כתוב סימול, למשל VTI.");
    if (!(amount > 0)) return ($("#planError").textContent = "כתוב סכום בדולרים, למשל 20.");
    $("#planError").textContent = "";
    const plan = { type: planType, symbol, amount, cushion: !!fd.get("cushion"), calm: !!fd.get("calm") };
    const r = evaluatePlan(plan);
    const d = DATA && DATA.status === "ok" ? DATA : null;
    const estUnits = symbol === "VTI" && d ? Math.max(0, amount - r.feeUsd) / d.price : "";
    const box = $("#planResult");
    box.hidden = false; box.dataset.level = r.level;
    box.innerHTML = `<h2><span class="verdict-dot" aria-hidden="true"></span>${r.title}</h2>
      <p class="muted small" style="margin-top:4px">${TYPE_HE[plan.type]} של ${esc(symbol)} ב־${usd(amount)}</p>
      <ul>${r.pts.map(([l, t]) => `<li>${t}</li>`).join("")}</ul>
      <form class="form" id="doneForm" style="margin-top:16px">
        <p class="small"><b>ביצעת ב־Blink?</b> כתוב מה קיבלת בפועל, והיומן והתיק יתעדכנו.</p>
        <div class="row">
          <label style="flex:1">יחידות<input name="units" inputmode="decimal" value="${estUnits ? estUnits.toFixed(4) : ""}"></label>
          <label style="flex:1">מחיר ליחידה ($)<input name="price" inputmode="decimal" value="${symbol === "VTI" && d ? d.price.toFixed(2) : ""}"></label>
        </div>
        <div class="row">
          <button class="btn primary" type="submit">רשום ביומן</button>
          <button class="btn" type="button" id="askBotPlan">שאל את הבוט</button>
        </div>
      </form>
      <p class="muted small" style="margin-top:12px">הסבר לימודי לפי כללים קבועים, לא ייעוץ השקעות.</p>`;
    $("#doneForm").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const u = num(ev.target.units.value), pr = num(ev.target.price.value);
      const { holdingsUpdated } = addJournal({ type: plan.type, symbol, amount_usd: amount, units: u > 0 ? u : undefined, price: pr > 0 ? pr : undefined, source: "plan" });
      toast(holdingsUpdated ? "נרשם ביומן, והתיק עודכן" : "נרשם ביומן");
      box.hidden = true; e.target.reset(); e.target.symbol.value = "VTI";
    });
    $("#askBotPlan").addEventListener("click", () => {
      window.VTIBot && window.VTIBot.prefill(`אני מתכנן ${TYPE_HE[plan.type]} של ${symbol} בסכום של $${amount} דרך Blink. מה דעתך? ${plan.cushion ? "יש לי כרית ביטחון." : "אין לי כרית ביטחון מסודרת."}`);
      location.hash = "#bot";
    });
    box.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  });

  /* ---------- דוחות ---------- */
  async function renderReports(date) {
    const list = $("#reportsList"), det = $("#reportDetail");
    $("#reportsIntro").hidden = !!date; $("#h-reports").hidden = !!date;
    if (date) {
      list.hidden = true; det.hidden = false;
      det.innerHTML = `<div class="skeleton" style="margin-top:30px"></div>`;
      try {
        const r = await fetch(`data/reports/${encodeURIComponent(date)}.json?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) throw 0;
        det.innerHTML = reportHtml(await r.json());
      } catch { det.innerHTML = `<a class="back" href="#reports">› לכל הדוחות</a>` + stateBox("הדוח לא נמצא", "<p>ייתכן שהוא עוד לא נוצר.</p>"); }
      return;
    }
    list.hidden = false; det.hidden = true;
    try {
      const r = await fetch("data/reports/index.json?t=" + Date.now(), { cache: "no-store" });
      const idx = r.ok ? await r.json() : [];
      list.innerHTML = idx.length
        ? idx.map((x) => `<a class="report-row" href="#report/${esc(x.date)}"><span><strong>${ilDate(x.date)}</strong><br><span class="muted small">${esc(x.verdict || "")}</span></span><span class="num ${dirClass(x.week_pct)}">${pct(x.week_pct)}</span></a>`).join("")
        : stateBox("עוד אין דוחות", "<p>הדוח הראשון ייווצר ביום שישי הקרוב ב־19:00. אפשר גם להריץ ידנית: Actions ← Update VTI data ← Run workflow ← לסמן <b>force_report</b>.</p>");
    } catch { list.innerHTML = stateBox("אין חיבור", "<p>לא הצלחתי לטעון את רשימת הדוחות.</p>"); }
  }
  function reportHtml(r) {
    const bars = r.week || [];
    const mn = Math.min(...bars.map((b) => b.c)), mx = Math.max(...bars.map((b) => b.c)), sp = mx - mn || 1;
    const barHtml = bars.length > 1 ? `<div class="week-bars" role="img" aria-label="מחירי סגירה בשבוע">${bars.map((b, i) => {
      const prev = i ? bars[i - 1].c : b.c;
      const c = b.c > prev ? "var(--up)" : b.c < prev ? "var(--down)" : "var(--flat)";
      return `<div><small class="num">${b.c.toFixed(2)}</small><span style="height:${20 + ((b.c - mn) / sp) * 60}%;background:${c}"></span><small>${new Date(b.d + "T12:00:00Z").toLocaleDateString("he-IL", { weekday: "short" })}</small></div>`;
    }).join("")}</div>` : "";
    const cmp = r.previous ? `<p>בדוח הקודם (${ilDate(r.previous.date)}) השווי היה <span class="num">${usd(r.previous.value)}</span>. השינוי מאז: <span class="num ${dirClass(r.portfolio.value - r.previous.value)}">${signedUsd(r.portfolio.value - r.previous.value)}</span>.</p>` : `<p class="muted">זה הדוח הראשון — אין עדיין למה להשוות.</p>`;
    return `<a class="back" href="#reports">› לכל הדוחות</a>
    <div class="report-body">
      <h2>דוח שבועי · ${ilDate(r.date)}</h2>
      <p class="muted small">מחיר סגירה מיום מסחר ${ilDate(r.trading_date)} · מקור: ${esc(r.source)}</p>
      <section class="verdict" data-level="${esc(r.signal.level)}" style="margin-top:16px"><div class="verdict-head"><span class="verdict-dot"></span>${esc(r.signal.title)}</div><p>${bidi(r.signal.reason)}</p></section>
      <dl class="kv" style="margin-top:18px">
        <div><dt>מחיר סגירה</dt><dd class="num">${usd(r.close)}</dd></div>
        <div><dt>שינוי שבועי בקרן</dt><dd class="num ${dirClass(r.week_pct)}">${signedUsd(r.week_usd)} (${pct(r.week_pct)})</dd></div>
        <div><dt>שווי ההחזקה המשוער</dt><dd class="num">${usd(r.portfolio.value)}</dd></div>
        <div><dt>רווח/הפסד אישי</dt><dd class="num ${dirClass(r.portfolio.pnl)}">${signedUsd(r.portfolio.pnl)} (${pct(r.portfolio.pnl_pct)})</dd></div>
      </dl>
      <h3>השבוע בגרף</h3>${barHtml || '<p class="muted">אין מספיק נתונים לגרף.</p>'}
      <h3>השוואה לדוח הקודם</h3>${cmp}
      <h3>כותרות מהשבוע</h3>
      ${(r.headlines || []).length ? `<ul class="news">${r.headlines.map((n) => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="meta">${esc(n.source || "")}</div></li>`).join("")}</ul>` : '<p class="muted">לא נמצאו כותרות מהותיות.</p>'}
      <h3>מסקנה</h3><p>${bidi(r.conclusion)}</p>
      <p class="muted small" style="margin-top:20px">מידע לימודי בלבד, לא ייעוץ השקעות. חישוב משוער ללא עמלות, מס והמרת מטבע.</p>
    </div>`;
  }

  /* ---------- מונחים ---------- */
  const TERMS = [
    ["מה זה VTI?", "קרן סל של Vanguard שמחזיקה כמעט את כל המניות הנסחרות בארה״ב — אלפי חברות, קטנות וגדולות. קנייה של יחידה אחת היא כמו לקנות פרוסה קטנה מכל השוק האמריקאי."],
    ["קרן סל (ETF)", "קרן שנסחרת בבורסה כמו מניה, ועוקבת אחרי מדד. היתרון: פיזור רחב בעלות נמוכה, בלי לבחור מניות בודדות."],
    ["למה מחיר הקרן ≠ התשואה שלי?", "שינוי יומי במחיר הקרן מודד את השוק. התשואה שלך מודדת את המחיר היום מול המחיר שבו *אתה* קנית. לכן הן מוצגות בנפרד."],
    ["רווח לא ממומש", "רווח (או הפסד) על הנייר. הוא הופך לאמיתי רק כשמוכרים. עד אז הוא משתנה כל יום."],
    ["הפקדה קבועה (DCA)", "לקנות בסכום קבוע כל תקופה, בלי לנסות לנחש מתי השוק בשפל. כך קונים יותר יחידות כשזול ופחות כשיקר, ומורידים את הלחץ מתזמון."],
    ["איך מחושב השווי?", "שווי = כמות יחידות × מחיר אחרון. רווח = שווי פחות עלות הקנייה. תשואה = רווח חלקי עלות × 100. זה חישוב משוער, לא היתרה הרשמית ב־Blink."],
    ["מס על רווחים בישראל", "על רווח הון ממניות וקרנות חל בדרך כלל מס בשיעור 25% על הרווח הריאלי, בעת המכירה. הכללים משתנים לפי מצבך — כדאי לוודא מול רואה חשבון."],
    ["חשיפה לדולר", "ההשקעה בדולרים. אם השקל מתחזק מול הדולר, השווי בשקלים יורד גם אם המחיר בדולרים לא זז — ולהפך."],
    ["עמלות", "כל קנייה ומכירה עשויה לעלות עמלה, וגם המרת שקלים לדולרים. בסכומים קטנים, עמלה קבועה אוכלת אחוז גדול מהתשואה — בדוק את תעריפי Blink."],
    ["למה לא להגיב לכל ירידה?", "השוק האמריקאי ירד בחדות כמה פעמים בעשורים האחרונים ובסופו של דבר עלה מעל השיא הקודם. מי שמכר בפאניקה לרוב פספס את ההתאוששות. אין ערובה שזה יחזור על עצמו."],
  ];
  $("#glossary").innerHTML = TERMS.map(([q, a]) => `<details><summary>${q}</summary><p>${a.replace(/\*(.+?)\*/g, "<b>$1</b>")}</p></details>`).join("") +
    `<p class="muted small" style="margin-top:20px">מידע לימודי כללי. אינני יועץ השקעות מורשה ואין כאן הבטחה לרווח.</p>`;

  /* ---------- התיק שלי ---------- */
  const form = $("#holdingsForm");
  function fillForm() {
    const h = holdings(), f = fees();
    form.units.value = h.units; form.avg_price.value = h.avg_price;
    form.fee.value = f.fee ?? ""; form.fx.value = f.fx ?? "";
    previewCost();
  }
  function previewCost() {
    const u = num(form.units.value), a = num(form.avg_price.value);
    $("#costPreview").textContent = u > 0 && a > 0 ? `עלות מחושבת: ${usd(u * a, 4)}` : "";
  }
  form.addEventListener("input", previewCost);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const u = num(form.units.value), a = num(form.avg_price.value);
    const fee = form.fee.value.trim() === "" ? undefined : num(form.fee.value);
    const fx = form.fx.value.trim() === "" ? undefined : num(form.fx.value);
    if (!(u >= 0)) return ($("#formError").textContent = "כמות היחידות צריכה להיות מספר, למשל 0.0264.");
    if (!(a > 0)) return ($("#formError").textContent = "מחיר הקנייה צריך להיות מספר גדול מאפס, למשל 377.91.");
    if (fee !== undefined && !(fee >= 0)) return ($("#formError").textContent = "העמלה צריכה להיות מספר, למשל 1.5 — או השאר ריק.");
    if (fx !== undefined && !(fx >= 0)) return ($("#formError").textContent = "עמלת ההמרה צריכה להיות באחוזים, למשל 0.5 — או השאר ריק.");
    $("#formError").textContent = "";
    store.set(K.hold, { units: u, avg_price: a });
    store.set(K.fees, { fee, fx });
    toast("התיק נשמר במכשיר");
    if (DATA) renderHome();
  });
  $("#resetHoldings").addEventListener("click", () => { store.del(K.hold); fillForm(); if (DATA) renderHome(); toast("חזרת לנתוני התיק מגיטהאב"); });
  $("#wipeLocal").addEventListener("click", () => {
    if (!confirm("למחוק מהמכשיר את התיק, היומן, הזיכרון של הבוט, המפתח וההעדפות? הקבצים בגיטהאב לא יימחקו.")) return;
    try { Object.keys(localStorage).filter((k) => k.startsWith("vti.")).forEach((k) => localStorage.removeItem(k)); sessionStorage.clear(); } catch {}
    applyTheme(null); renderJournal(); renderNotes(); if (DATA) renderHome();
    window.VTIBot && window.VTIBot.reset();
    toast("כל הנתונים נמחקו מהמכשיר");
  });
  $$("#themeSeg button").forEach((b) => b.addEventListener("click", () => {
    const t = b.dataset.theme === "auto" ? null : b.dataset.theme;
    t ? store.set(K.theme, t) : store.del(K.theme);
    applyTheme(t);
  }));

  /* ---------- ווידג'ט ---------- */
  function renderWidgetPreview() {
    const el = $("#widgetPreview"); if (!el) return;
    if (!DATA || DATA.status !== "ok") { el.innerHTML = `<div class="wcard"><b>VTI</b><p class="muted small" style="margin-top:8px">התצוגה תופיע אחרי שיהיה מחיר מאומת.</p></div>`; return; }
    const p = portfolioNow();
    const pts = DATA.history.slice(-63).map((x) => x.c), mn = Math.min(...pts), mx = Math.max(...pts), sp = mx - mn || 1;
    const path = pts.map((v, i) => `${i ? "L" : "M"}${(i / (pts.length - 1) * 300).toFixed(1)},${(3 + (1 - (v - mn) / sp) * 28).toFixed(1)}`).join("");
    const chg = (pts.at(-1) / pts[0] - 1) * 100;
    el.innerHTML = `<div class="wcard" dir="rtl">
      <div class="wr"><b>VTI</b><span class="muted">שווי משוער</span></div>
      <div class="wv num" style="text-align:right">${usd(p.value)}</div>
      <div class="num ${dirClass(p.pnl)}" style="text-align:right;font-size:.82rem">${signedUsd(p.pnl)} (${pct(p.pnl_pct)})</div>
      <svg viewBox="0 0 300 34" width="100%" height="34" aria-hidden="true"><path d="${path}" fill="none" stroke="var(--${dirClass(chg)})" stroke-width="2.2" stroke-linejoin="round"/></svg>
      <div class="wr"><span>קרן היום <span class="num ${dirClass(DATA.change_day_pct)}">${pct(DATA.change_day_pct)}</span></span><span class="muted">${new Date(DATA.price_time).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}</span></div>
    </div>`;
  }
  $("#copyWidget").addEventListener("click", async () => {
    try {
      const r = await fetch("widget/vti-widget.js", { cache: "no-store" });
      let code = await r.text();
      const site = location.origin + location.pathname.replace(/index\.html$/, "");
      code = code.replace(/const SITE = ".*?";/, `const SITE = "${site}";`);
      await navigator.clipboard.writeText(code);
      toast("הקוד הועתק. עכשיו פתח את Scriptable והדבק");
    } catch { toast("ההעתקה נכשלה. פתח את widget/vti-widget.js בגיטהאב והעתק משם"); }
  });

  /* ---------- גיבוי זיכרון ---------- */
  $("#exportMem").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ version: 1, exported_at: new Date().toISOString(), holdings: store.get(K.hold), fees: fees(), journal: journal(), notes: notes() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `vti-memory-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $("#importMem").addEventListener("change", async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const m = JSON.parse(await file.text());
      if (!Array.isArray(m.journal) || !Array.isArray(m.notes)) throw 0;
      if (!confirm(`לשחזר ${m.journal.length} פעולות ו־${m.notes.length} הערות? זה יחליף את מה שיש עכשיו במכשיר.`)) return;
      store.set(K.journal, m.journal); store.set(K.notes, m.notes);
      if (m.holdings) store.set(K.hold, m.holdings);
      if (m.fees) store.set(K.fees, m.fees);
      renderJournal(); renderNotes(); if (DATA) renderHome();
      toast("הזיכרון שוחזר");
    } catch { toast("הקובץ לא נראה כמו גיבוי של האפליקציה הזו"); }
    e.target.value = "";
  });

  /* ---------- ניווט ---------- */
  const TAB_OF = { home: "home", plan: "plan", bot: "bot", reports: "reports", report: "reports", more: "more", holdings: "more", widget: "more", learn: "more", botsettings: "more" };
  function route() {
    const [tab, arg] = (location.hash.slice(1) || "home").split("/");
    const view = tab === "report" ? "reports" : (TAB_OF[tab] ? tab : "home");
    $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
    const active = TAB_OF[view];
    $$(".tabs a").forEach((a) => a.dataset.tab === active ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
    if (view === "reports") renderReports(tab === "report" ? arg : null);
    if (view === "holdings") fillForm();
    if (view === "plan") renderJournal();
    if (view === "botsettings") renderNotes();
    if (view === "widget") renderWidgetPreview();
    if (view === "home" && DATA && DATA.status === "ok") requestAnimationFrame(drawChart);
    if (view === "bot") window.VTIBot && window.VTIBot.show();
    else scrollTo(0, 0);
  }
  addEventListener("hashchange", route);

  /* ---------- כללי ---------- */
  let toastT;
  function toast(msg) {
    let t = $(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2800);
  }
  $("#refreshBtn").addEventListener("click", () => load(true));
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && DATA && load(false));
  if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

  // ממשק לבוט (bot.js)
  window.VTI = {
    data: () => DATA, holdings: portfolioNow, fees, journal, notes, addJournal, addNote, signal: () => (DATA && DATA.status === "ok" ? signal(DATA, portfolioNow()) : null),
    evaluatePlan, toast, usd, pct, esc, journalLine, store,
  };

  route();
  load(false);
})();
