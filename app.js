/* VTI | סוכן ההשקעות שלי
   קורא נתונים מ-data/vti.json (מתעדכן ע"י GitHub Actions) ומחשב את התיק במכשיר.
   אין כאן שום נתון מומצא: אם אין נתונים — מוצג מסך הסבר. */
(() => {
  "use strict";

  const LS_HOLD = "vti.holdings";
  const LS_THEME = "vti.theme";
  const $ = (s, r = document) => r.querySelector(s);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
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
  const iso = (s) => `<span class="num">${s}</span>`;
  const bidi = (s) => esc(s).replace(/\u2066/g, '<span class="num">').replace(/\u2069/g, "</span>");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- ערכת צבעים ---------- */
  function applyTheme(t) {
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    document.querySelectorAll("#themeSeg button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.theme === (t || "auto"))));
  }
  applyTheme(store.get(LS_THEME));

  /* ---------- תיק ---------- */
  function holdings() {
    const local = store.get(LS_HOLD);
    const base = (DATA && DATA.portfolio) || { units: 0.0264, avg_price: 377.91 };
    const h = local || base;
    const cost = +(h.units * h.avg_price).toFixed(4);
    return { units: +h.units, avg_price: +h.avg_price, cost, local: !!local, broker: base.broker || "Blink" };
  }

  /* ---------- כללי המלצת מעקב (זהים לסקריפט בגיטהאב) ---------- */
  function signal(d, p) {
    const day = d.change_day_pct, week = d.change_week_pct;
    const dd = d.high_52w ? (d.price / d.high_52w - 1) * 100 : 0;
    if (Math.abs(day ?? 0) >= 5 || dd <= -20)
      return { level: "risk", title: "סיכון משמעותי — כדאי לבדוק", reason: Math.abs(day ?? 0) >= 5 ? `תנועה חריגה של ${iso(pct(day))} ביום אחד.` : `הקרן נמצאת ${Math.abs(dd).toFixed(1)}% מתחת לשיא השנתי — מצב של שוק דובי.`, extra: "זה לא סימן למכור. בטווח ארוך ירידות כאלה קרו בעבר. בדוק שהסכום שהשקעת עדיין מתאים לך." };
    if (Math.abs(day ?? 0) >= 3 || Math.abs(week ?? 0) >= 5 || p.pnl_pct <= -10)
      return { level: "check", title: "כדאי לבדוק", reason: Math.abs(day ?? 0) >= 3 ? `תנועה יומית גדולה מהרגיל: ${iso(pct(day))}.` : Math.abs(week ?? 0) >= 5 ? `תנועה שבועית גדולה מהרגיל: ${iso(pct(week))}.` : `התשואה שלך: ${iso(pct(p.pnl_pct))} ממחיר הקנייה.`, extra: "קרא מה קרה בשוק לפני כל החלטה. החלטות רגשיות הן הטעות הנפוצה ביותר." };
    return { level: "ok", title: "אין צורך בפעולה", reason: "תנודות רגילות. האסטרטגיה לטווח ארוך לא משתנה בגלל שבוע אחד.", extra: "" };
  }

  /* ---------- מצב שוק (לפי שעות מסחר רגילות בניו יורק, בלי חגים) ---------- */
  function marketState() {
    const ny = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = ny.getDay(), mins = ny.getHours() * 60 + ny.getMinutes();
    if (day === 0 || day === 6) return "הבורסה בניו יורק סגורה (סוף שבוע).";
    if (mins >= 570 && mins < 960) return "הבורסה בניו יורק פתוחה עכשיו (לפי שעות רגילות).";
    if (mins < 570) return "הבורסה בניו יורק עוד לא נפתחה היום — נפתחת ב־16:30 שעון ישראל בערך.";
    return "הבורסה בניו יורק נסגרה להיום.";
  }

  /* ---------- טעינת נתונים ---------- */
  async function load(showSpin) {
    const btn = $("#refreshBtn");
    if (showSpin) btn.classList.add("spin");
    if (!DATA) $("#homeState").innerHTML = `<div aria-busy="true"><div class="skeleton" style="width:40%;margin-top:30px"></div><div class="skeleton" style="height:56px;width:70%"></div><div class="skeleton" style="height:160px"></div></div>`;
    try {
      const r = await fetch("data/vti.json?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("http " + r.status);
      DATA = await r.json();
      renderHome();
      if (showSpin) toast("הנתונים עודכנו מהקובץ האחרון בגיטהאב");
    } catch (e) {
      if (!DATA) $("#homeState").innerHTML = stateBox("אין חיבור לנתונים", "<p>לא הצלחתי לקרוא את <code>data/vti.json</code>. בדוק חיבור לאינטרנט ונסה שוב. אם האתר חדש — ודא ש־GitHub Pages מופעל.</p>");
      else toast("לא הצלחתי לרענן. מוצגים הנתונים האחרונים שנטענו.");
    } finally { btn.classList.remove("spin"); }
  }

  const stateBox = (t, body) => `<div class="state"><h2>${t}</h2>${body}</div>`;

  /* ---------- מסך בית ---------- */
  function renderHome() {
    const d = DATA;
    if (!d || d.status !== "ok" || !d.price) {
      $("#homeContent").hidden = true;
      $("#homeState").innerHTML = stateBox("עוד אין מחיר מאומת", `
        <p>האפליקציה לא מציגה מחירים בלי מקור. הנתונים נאספים על ידי GitHub Actions.</p>
        <ol><li>בגיטהאב, פתח את הלשונית <b>Actions</b>.</li><li>בחר <b>Update VTI data</b> ולחץ <b>Run workflow</b>.</li><li>חכה כדקה ורענן כאן.</li></ol>`);
      return;
    }
    $("#homeState").innerHTML = "";
    $("#homeContent").hidden = false;

    const h = holdings();
    const value = h.units * d.price;
    const pnl = value - h.cost;
    const pnlPct = h.cost ? (pnl / h.cost) * 100 : 0;
    const p = { value, pnl, pnl_pct: pnlPct };

    $("#heroValue").textContent = usd(value);
    const pc = dirClass(pnl);
    $("#heroPnl").innerHTML = `<span class="${pc} num">${signedUsd(pnl)} (${pct(pnlPct)})</span> <span class="muted">מאז הקנייה</span>`;

    const set = (id, txt, cls) => { const el = $(id); el.textContent = txt; el.className = "num " + (cls || ""); };
    set("#kPrice", usd(d.price));
    set("#kDay", pct(d.change_day_pct), dirClass(d.change_day_pct));
    set("#kWeek", pct(d.change_week_pct), dirClass(d.change_week_pct));
    set("#kMonth", pct(d.change_month_pct), dirClass(d.change_month_pct));
    set("#kUnits", h.units.toFixed(4));
    set("#kAvg", usd(h.avg_price));
    set("#kCost", usd(h.cost));
    set("#kPnl", pct(pnlPct), dirClass(pnl));

    const s = signal(d, p);
    const v = $("#verdict");
    v.dataset.level = s.level;
    v.innerHTML = `<div class="verdict-head"><span class="verdict-dot" aria-hidden="true"></span>${s.title}</div><p>${s.reason}</p>${s.extra ? `<p class="muted">${s.extra}</p>` : ""}`;

    $("#marketState").textContent = marketState();
    const news = d.headlines || [];
    $("#newsList").innerHTML = news.length
      ? news.map((n) => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="meta">${esc(n.source || "")}${n.date ? " · " + new Date(n.date).toLocaleDateString("en-GB") : ""}</div></li>`).join("") +
        `<li class="muted small" style="border:0">כותרות מהמקור, באנגלית. אלו כותרות בלבד ולא ניתוח — קרא את הכתבה לפני שאתה מסיק מסקנות.</li>`
      : `<li class="muted small">אין כותרות חדשות מהשבוע האחרון.</li>`;

    const stale = (Date.now() - new Date(d.price_time).getTime()) / 864e5 > 4;
    $("#stamp").innerHTML = `מחיר מ־${esc(d.source)} · נכון ל־${ilTime(d.price_time)} (שעון ישראל)${stale ? ` · <b class="down">הנתונים ישנים — בדוק שה־Action רץ</b>` : ""}<br>חישוב משוער, לא היתרה הרשמית ב־${esc(h.broker)}. לא כולל עמלות, מס והמרת מטבע.${h.local ? "<br>משתמש בנתוני תיק שעדכנת במכשיר." : ""}`;

    drawChart();
  }

  /* ---------- גרף ---------- */
  function drawChart() {
    const all = (DATA.history || []).filter((x) => x.c != null);
    const pts = all.slice(-RANGE);
    const box = $("#chart");
    if (pts.length < 2) { box.innerHTML = `<p class="muted small">אין מספיק היסטוריה לגרף.</p>`; $("#chartCap").textContent = ""; return; }
    const h = holdings();
    const W = box.clientWidth || 340, H = box.clientHeight || 190, padT = 22, padB = 8;
    const vals = pts.map((p) => p.c).concat([h.avg_price]);
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = max - min || 1;
    // ציר הזמן משמאל לימין (כמו בכל גרף פיננסי), גם בממשק RTL
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
      const px = (x(i) / W) * r.width;
      cur.setAttribute("x1", x(i)); cur.setAttribute("x2", x(i)); cur.setAttribute("opacity", ".35");
      tip.hidden = false; tip.style.left = Math.max(40, Math.min(r.width - 40, px)) + "px";
      tip.textContent = `${new Date(pts[i].d + "T12:00:00Z").toLocaleDateString("he-IL", { day: "numeric", month: "numeric" })} · ${usd(pts[i].c)}`;
    };
    const leave = () => { tip.hidden = true; cur.setAttribute("opacity", "0"); };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("touchmove", move, { passive: true });
    svg.addEventListener("pointerleave", leave);
    svg.addEventListener("touchend", leave);
  }

  document.querySelectorAll(".range button").forEach((b) => b.addEventListener("click", () => {
    RANGE = +b.dataset.range;
    document.querySelectorAll(".range button").forEach((o) => o.setAttribute("aria-selected", String(o === b)));
    if (DATA && DATA.status === "ok") drawChart();
  }));
  let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => DATA && DATA.status === "ok" && drawChart(), 150); });

  /* ---------- דוחות ---------- */
  async function renderReports(date) {
    const list = $("#reportsList"), det = $("#reportDetail");
    if (date) {
      list.hidden = true; det.hidden = false;
      det.innerHTML = `<div class="skeleton" style="margin-top:30px"></div>`;
      try {
        const r = await fetch(`data/reports/${encodeURIComponent(date)}.json?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) throw 0;
        det.innerHTML = reportHtml(await r.json());
      } catch { det.innerHTML = `<a class="back" href="#reports">› לכל הדוחות</a>` + stateBox("הדוח לא נמצא", "<p>ייתכן שהוא עוד לא נוצר. חזור לרשימה.</p>"); }
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
    const bars = (r.week || []);
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
    ["איך מחושב השווי?", "שווי = כמות יחידות × מחיר אחרון. רווח = שווי פחות עלות הקנייה. תשואה = רווח חלקי עלות × 100. זה חישוב משוער, לא היתרה הרשמית ב־Blink."],
    ["מס על רווחים בישראל", "על רווח הון ממניות וקרנות חל בדרך כלל מס בשיעור 25% על הרווח הריאלי, בעת המכירה. הכללים משתנים לפי מצבך — כדאי לוודא מול רואה חשבון או יועץ מס."],
    ["חשיפה לדולר", "ההשקעה בדולרים. אם השקל מתחזק מול הדולר, השווי בשקלים יורד גם אם המחיר בדולרים לא זז — ולהפך."],
    ["עמלות", "כל קנייה ומכירה עשויה לעלות עמלה, וגם המרת שקלים לדולרים. בסכומים קטנים, עמלה קבועה אוכלת אחוז גדול מהתשואה — בדוק את תעריפי Blink."],
    ["למה לא להגיב לכל ירידה?", "השוק האמריקאי ירד בחדות כמה פעמים בעשורים האחרונים ובסופו של דבר עלה מעל השיא הקודם. מי שמכר בפאניקה לרוב פספס את ההתאוששות. אין ערובה שזה יחזור על עצמו."],
  ];
  $("#glossary").innerHTML = TERMS.map(([q, a]) => `<details><summary>${q}</summary><p>${a.replace(/\*(.+?)\*/g, "<b>$1</b>")}</p></details>`).join("") +
    `<p class="muted small" style="margin-top:20px">מידע לימודי כללי. אינני יועץ השקעות מורשה ואין כאן הבטחה לרווח.</p>`;

  /* ---------- הגדרות ---------- */
  const form = $("#holdingsForm");
  function fillForm() {
    const h = holdings();
    form.units.value = h.units; form.avg_price.value = h.avg_price;
    previewCost();
  }
  function previewCost() {
    const u = parseFloat(form.units.value), a = parseFloat(form.avg_price.value);
    $("#costPreview").textContent = u > 0 && a > 0 ? `עלות מחושבת: ${usd(u * a, 4)}` : "";
  }
  form.addEventListener("input", previewCost);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const u = parseFloat(form.units.value), a = parseFloat(form.avg_price.value);
    if (!(u > 0)) return ($("#formError").textContent = "כמות היחידות צריכה להיות מספר גדול מאפס, למשל 0.0264.");
    if (!(a > 0)) return ($("#formError").textContent = "מחיר הקנייה צריך להיות מספר גדול מאפס, למשל 377.91.");
    $("#formError").textContent = "";
    store.set(LS_HOLD, { units: u, avg_price: a });
    toast("התיק נשמר במכשיר");
    renderHome();
  });
  $("#resetHoldings").addEventListener("click", () => { store.del(LS_HOLD); fillForm(); renderHome(); toast("חזרת לנתוני התיק מגיטהאב"); });
  $("#wipeLocal").addEventListener("click", () => {
    if (!confirm("למחוק מהמכשיר את נתוני התיק וההעדפות? הקבצים בגיטהאב לא יימחקו.")) return;
    store.del(LS_HOLD); store.del(LS_THEME); applyTheme(null); fillForm(); renderHome(); toast("הנתונים נמחקו מהמכשיר");
  });
  document.querySelectorAll("#themeSeg button").forEach((b) => b.addEventListener("click", () => {
    const t = b.dataset.theme === "auto" ? null : b.dataset.theme;
    t ? store.set(LS_THEME, t) : store.del(LS_THEME);
    applyTheme(t);
    if (DATA && DATA.status === "ok") drawChart();
  }));

  /* ---------- ניווט ---------- */
  function route() {
    const hash = location.hash.slice(1) || "home";
    const [tab, arg] = hash.split("/");
    const name = tab === "report" ? "reports" : (["home", "reports", "learn", "settings"].includes(tab) ? tab : "home");
    document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + name));
    document.querySelectorAll(".tabs a").forEach((a) => {
      if (a.dataset.tab === name) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    if (name === "reports") renderReports(tab === "report" ? arg : null);
    if (name === "settings") fillForm();
    if (name === "home" && DATA) requestAnimationFrame(() => DATA.status === "ok" && drawChart());
    scrollTo(0, 0);
  }
  addEventListener("hashchange", route);

  /* ---------- כללי ---------- */
  let toastT;
  function toast(msg) {
    let t = $(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600);
  }
  $("#refreshBtn").addEventListener("click", () => load(true));
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && DATA && load(false));

  if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

  route();
  load(false);
})();
