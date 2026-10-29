// VTI | סוכן ההשקעות שלי — ווידג'ט למסך הבית באייפון (אפליקציית Scriptable)
// 1. החלף את SITE בכתובת ה-GitHub Pages שלך (עם / בסוף).
// 2. גדלים נתמכים: קטן, בינוני, ומסך נעילה (מלבני).
// הווידג'ט קורא את data/vti.json — אותו קובץ שהאפליקציה קוראת.

const SITE = "https://liors24.github.io/vti-invest/";

// עדכון תיק מקומי (לא חובה): השאר null כדי להשתמש ב-data/portfolio.json מגיטהאב
const OVERRIDE = null; // לדוגמה: { units: 0.0264, avg_price: 377.91 }

const C = {
  bg: Color.dynamic(new Color("#EEF1EC"), new Color("#101816")),
  ink: Color.dynamic(new Color("#16231F"), new Color("#E5ECE7")),
  muted: Color.dynamic(new Color("#5B6863"), new Color("#93A29B")),
  up: Color.dynamic(new Color("#1D7549"), new Color("#4CC38A")),
  down: Color.dynamic(new Color("#B2352E"), new Color("#F07167")),
  flat: Color.dynamic(new Color("#78837E"), new Color("#8A9893")),
  warn: Color.dynamic(new Color("#8A5A00"), new Color("#F2C46D")),
};

const usd = (n) => (n < 0 ? "−$" : "$") + Math.abs(n).toFixed(2);
const pct = (n) => n == null ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(2) + "%";
const col = (n) => n == null || Math.abs(n) < 0.005 ? C.flat : n > 0 ? C.up : C.down;

async function load() {
  const fm = FileManager.local();
  const cache = fm.joinPath(fm.cacheDirectory(), "vti-widget.json");
  try {
    const r = new Request(SITE + "data/vti.json?t=" + Date.now());
    r.timeoutInterval = 15;
    const d = await r.loadJSON();
    fm.writeString(cache, JSON.stringify(d));
    return { d, offline: false };
  } catch (e) {
    if (fm.fileExists(cache)) return { d: JSON.parse(fm.readString(cache)), offline: true };
    return { d: null, offline: true };
  }
}

function calc(d) {
  const h = OVERRIDE || d.portfolio;
  const cost = h.units * h.avg_price;
  const value = h.units * d.price;
  const pnl = value - cost;
  return { value, pnl, pnlPct: cost ? (pnl / cost) * 100 : 0 };
}

function text(stack, s, font, color, align = "right") {
  const t = stack.addText(s);
  t.font = font; t.textColor = color; t.lineLimit = 1; t.minimumScaleFactor = 0.6;
  if (align === "right") t.rightAlignText(); else t.leftAlignText();
  return t;
}

function row(stack) {
  const r = stack.addStack();
  r.layoutHorizontally(); r.centerAlignContent();
  return r;
}

function sparkline(hist, w, h, color) {
  const pts = hist.slice(-63).map((x) => x.c);
  const ctx = new DrawContext();
  ctx.size = new Size(w, h); ctx.opaque = false; ctx.respectScreenScale = true;
  const mn = Math.min(...pts), mx = Math.max(...pts), sp = mx - mn || 1;
  const p = new Path();
  pts.forEach((v, i) => {
    const pt = new Point((i / (pts.length - 1)) * w, 3 + (1 - (v - mn) / sp) * (h - 6));
    i ? p.addLine(pt) : p.move(pt);
  });
  ctx.addPath(p); ctx.setStrokeColor(color); ctx.setLineWidth(2.2); ctx.strokePath();
  return ctx.getImage();
}

async function build() {
  const { d, offline } = await load();
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.url = SITE + "#home";
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
  const fam = config.widgetFamily || "medium";

  if (!d || d.status !== "ok") {
    if (fam === "accessoryRectangular") { text(w, "VTI · אין נתונים", Font.semiboldSystemFont(13), Color.white()); return w; }
    text(w, "VTI", Font.boldSystemFont(16), C.ink);
    w.addSpacer(6);
    text(w, "עוד אין מחיר מאומת.", Font.systemFont(13), C.muted);
    text(w, "הרץ את ה־Action בגיטהאב.", Font.systemFont(13), C.muted);
    return w;
  }

  const p = calc(d);
  const when = new Date(d.price_time).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

  // מסך נעילה
  if (fam === "accessoryRectangular") {
    w.addAccessoryWidgetBackground = true;
    text(w, `VTI  ${usd(d.price)}  ${pct(d.change_day_pct)}`, Font.semiboldSystemFont(13), Color.white());
    text(w, `שלך ${usd(p.value)} · ${pct(p.pnlPct)}`, Font.systemFont(12), Color.white());
    text(w, when, Font.systemFont(10), Color.white());
    return w;
  }

  w.setPadding(14, 16, 12, 16);

  const head = row(w);
  text(head, "VTI", Font.boldSystemFont(14), C.ink);
  head.addSpacer();
  const sig = d.signal || { level: "ok" };
  const dot = head.addText("●");
  dot.font = Font.systemFont(10);
  dot.textColor = sig.level === "risk" ? C.down : sig.level === "check" ? C.warn : C.up;

  w.addSpacer(4);
  text(w, "שווי משוער", Font.systemFont(11), C.muted);
  const v = text(w, usd(p.value), new Font("Georgia-Bold", fam === "small" ? 30 : 32), C.ink);
  text(w, `${p.pnl >= 0 ? "+" : ""}${usd(p.pnl)}  (${pct(p.pnlPct)})`, Font.mediumSystemFont(12), col(p.pnl));

  if (fam !== "small" && d.history && d.history.length > 2) {
    w.addSpacer(6);
    const chg = (d.history.at(-1).c / d.history.slice(-63)[0].c - 1) * 100;
    const img = w.addImage(sparkline(d.history, 300, 34, col(chg)));
    img.imageSize = new Size(300, 34);
  }

  w.addSpacer();
  const foot = row(w);
  text(foot, `קרן היום ${pct(d.change_day_pct)}`, Font.systemFont(11), col(d.change_day_pct));
  foot.addSpacer();
  text(foot, (offline ? "שמור · " : "") + when, Font.systemFont(10), C.muted);
  return w;
}

const widget = await build();
if (config.runsInWidget || config.runsInAccessoryWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
