#!/usr/bin/env python3
"""
VTI | סוכן ההשקעות שלי — איסוף נתונים, דוח שבועי והתראות.

רץ ב-GitHub Actions. ללא ספריות חיצוניות.
- מושך מחיר והיסטוריה של VTI (Yahoo Finance, גיבוי: Stooq)
- מחשב את התיק לפי data/portfolio.json
- כותב data/vti.json (לאפליקציה ולווידג'ט)
- ביום שישי ב-19:00 שעון ישראל יוצר דוח שבועי ב-data/reports/
- שולח התראת Push לאייפון דרך ntfy.sh, רק אם הוגדר NTFY_TOPIC, ורק על אירועים מהותיים

עקרון: אם לא הצלחנו להשיג מחיר — לא ממציאים. הקובץ הקודם נשאר כמו שהוא.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
REPORTS = DATA / "reports"
IL = ZoneInfo("Asia/Jerusalem")
NY = ZoneInfo("America/New_York")
UA = {"User-Agent": "Mozilla/5.0 (VTI personal tracker; +https://github.com)"}
SYMBOL = "VTI"


def log(*a):
    print("[vti]", *a, file=sys.stderr)


def get(url: str, timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def read_json(p: Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ---------- מקורות מחיר ----------

def from_yahoo() -> dict:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}?range=1y&interval=1d&includePrePost=false"
    j = json.loads(get(url))
    res = j["chart"]["result"][0]
    meta = res["meta"]
    ts = res.get("timestamp") or []
    closes = res["indicators"]["quote"][0].get("close") or []
    hist = []
    for t, c in zip(ts, closes):
        if c is None:
            continue
        d = datetime.fromtimestamp(t, NY).date().isoformat()
        if hist and hist[-1]["d"] == d:
            hist[-1]["c"] = round(c, 4)
        else:
            hist.append({"d": d, "c": round(c, 4)})
    price = meta.get("regularMarketPrice")
    ptime = meta.get("regularMarketTime")
    if not price or not ptime or len(hist) < 2:
        raise ValueError("Yahoo: missing price")
    pdate = datetime.fromtimestamp(ptime, NY).date().isoformat()
    # היום האחרון בהיסטוריה = המחיר העדכני
    if hist[-1]["d"] == pdate:
        hist[-1]["c"] = round(price, 4)
    else:
        hist.append({"d": pdate, "c": round(price, 4)})
    return {
        "price": round(price, 4),
        "price_time": datetime.fromtimestamp(ptime, timezone.utc).isoformat(),
        "history": hist,
        "source": "Yahoo Finance",
    }


def from_stooq() -> dict:
    raw = get("https://stooq.com/q/d/l/?s=vti.us&i=d").decode()
    rows = list(csv.DictReader(io.StringIO(raw)))
    if not rows or "Close" not in rows[0]:
        raise ValueError("Stooq: bad csv")
    cutoff = (datetime.now(NY).date() - timedelta(days=370)).isoformat()
    hist = [{"d": r["Date"], "c": round(float(r["Close"]), 4)} for r in rows if r["Date"] >= cutoff and r.get("Close")]
    last = hist[-1]
    # Stooq נותן מחיר סגירה יומי. זמן הסגירה: 16:00 ניו יורק
    t = datetime.fromisoformat(last["d"]).replace(hour=16, tzinfo=NY)
    return {"price": last["c"], "price_time": t.astimezone(timezone.utc).isoformat(), "history": hist, "source": "Stooq (מחיר סגירה)"}


def fetch_market() -> dict:
    for fn in (from_yahoo, from_stooq):
        try:
            m = fn()
            log("price from", m["source"], m["price"])
            return m
        except Exception as e:  # noqa: BLE001
            log(fn.__name__, "failed:", e)
    raise RuntimeError("לא הצלחתי להשיג מחיר מאף מקור")


def fetch_headlines(limit: int = 5) -> list[dict]:
    try:
        raw = get(f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={SYMBOL},SPY&region=US&lang=en-US")
        root = ET.fromstring(raw)
    except Exception as e:  # noqa: BLE001
        log("headlines failed:", e)
        return []
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    out, seen = [], set()
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        if not title or not link.startswith("http") or title in seen:
            continue
        try:
            dt = parsedate_to_datetime(it.findtext("pubDate") or "")
        except Exception:  # noqa: BLE001
            dt = None
        if dt and dt < week_ago:
            continue
        seen.add(title)
        out.append({"title": title, "link": link, "source": "Yahoo Finance", "date": dt.isoformat() if dt else None})
        if len(out) >= limit:
            break
    return out


# ---------- חישובים ----------

def pct_change(hist: list[dict], back: int) -> float | None:
    if len(hist) <= back:
        return None
    a, b = hist[-1 - back]["c"], hist[-1]["c"]
    return round((b / a - 1) * 100, 3)


def portfolio(price: float) -> dict:
    p = read_json(DATA / "portfolio.json", {})
    units, avg = float(p.get("units", 0)), float(p.get("avg_price", 0))
    cost = round(units * avg, 4)
    value = round(units * price, 4)
    pnl = round(value - cost, 4)
    return {
        "units": units, "avg_price": avg, "cost": cost, "broker": p.get("broker", "Blink"),
        "value": value, "pnl": pnl, "pnl_pct": round(pnl / cost * 100, 3) if cost else 0.0,
    }


def signal(price: float, day, week, high, pnl_pct) -> dict:
    """אותם כללים כמו באפליקציה."""
    day, week = day or 0.0, week or 0.0
    dd = (price / high - 1) * 100 if high else 0.0
    if abs(day) >= 5 or dd <= -20:
        reason = f"תנועה חריגה של \u2066{day:+.2f}%\u2069 ביום אחד." if abs(day) >= 5 else f"הקרן {abs(dd):.1f}% מתחת לשיא השנתי."
        return {"level": "risk", "title": "סיכון משמעותי — כדאי לבדוק", "reason": reason}
    if abs(day) >= 3 or abs(week) >= 5 or pnl_pct <= -10:
        if abs(day) >= 3:
            reason = f"תנועה יומית גדולה מהרגיל: \u2066{day:+.2f}%\u2069."
        elif abs(week) >= 5:
            reason = f"תנועה שבועית גדולה מהרגיל: \u2066{week:+.2f}%\u2069."
        else:
            reason = f"התשואה שלך: \u2066{pnl_pct:+.2f}%\u2069 ממחיר הקנייה."
        return {"level": "check", "title": "כדאי לבדוק", "reason": reason}
    return {"level": "ok", "title": "אין צורך בפעולה", "reason": "תנודות רגילות. האסטרטגיה לטווח ארוך לא משתנה בגלל שבוע אחד."}


# ---------- התראות ----------

def notify(title: str, body: str, click: str | None, priority: str = "default") -> bool:
    """שולח Push דרך ntfy.sh. מחזיר True רק אם השרת אישר (HTTP 200)."""
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if not topic:
        log("NTFY_TOPIC not set — no notification sent")
        return False
    server = os.environ.get("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
    payload = {"topic": topic, "title": title, "message": body, "priority": {"default": 3, "high": 4}.get(priority, 3), "tags": ["chart_with_upwards_trend"]}
    if click:
        payload["click"] = click
    req = urllib.request.Request(server, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", **UA}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            ok = r.status == 200
    except Exception as e:  # noqa: BLE001
        log("notify failed:", e)
        ok = False
    log("notification", "confirmed" if ok else "NOT confirmed")
    return ok


def site_url() -> str | None:
    u = os.environ.get("SITE_URL", "").strip()
    if u:
        return u.rstrip("/") + "/"
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if "/" in repo:
        owner, name = repo.split("/", 1)
        return f"https://{owner.lower()}.github.io/{name}/"
    return None


# ---------- דוח שבועי ----------

def conclusion(sig: dict, week_pct, pnl_pct) -> str:
    if sig["level"] == "ok":
        return ("אין צורך בפעולה. " + (f"הקרן זזה \u2066{week_pct:+.2f}%\u2069 השבוע — בטווח הרגיל. " if week_pct is not None else "")
                + "אם תכננת להוסיף כסף, אפשר להמשיך לפי התוכנית שלך ולא לפי מצב השוק השבוע.")
    if sig["level"] == "check":
        return ("כדאי לבדוק: " + sig["reason"] + " קרא את הכותרות מהשבוע כדי להבין מה הניע את התנועה. "
                "לרוב אין סיבה לשנות אסטרטגיה ארוכת טווח בגלל שבוע אחד, אבל זה זמן טוב לוודא שהסכום מתאים לך.")
    return ("סיכון משמעותי: " + sig["reason"] + " זו לא קריאה למכור. ירידות חדות הן חלק מהשקעה במניות. "
            "שאל את עצמך אם תוכל להחזיק גם אם ההפסד יגדל, ואל תקבל החלטה ביום של פאניקה.")


def make_report(m: dict, port: dict, sig: dict, heads: list, force: bool) -> dict | None:
    now = datetime.now(IL)
    date = now.date().isoformat()
    path = REPORTS / f"{date}.json"
    if path.exists() and not force:
        log("report already exists for", date)
        return None
    hist = m["history"]
    week = hist[-6:] if len(hist) >= 6 else hist
    base = week[0]["c"]
    close = hist[-1]["c"]
    idx = read_json(REPORTS / "index.json", [])
    prev = next((x for x in idx if x["date"] != date), None)
    rep = {
        "date": date,
        "created_at": now.isoformat(),
        "trading_date": hist[-1]["d"],
        "source": m["source"],
        "close": close,
        "week_usd": round(close - base, 4),
        "week_pct": round((close / base - 1) * 100, 3),
        "week": week[1:] if len(week) > 1 else week,
        "portfolio": port,
        "signal": sig,
        "headlines": heads,
        "previous": {"date": prev["date"], "value": prev["value"]} if prev else None,
    }
    rep["conclusion"] = conclusion(sig, rep["week_pct"], port["pnl_pct"])
    write_json(path, rep)
    idx = [x for x in idx if x["date"] != date]
    idx.insert(0, {"date": date, "week_pct": rep["week_pct"], "value": port["value"], "verdict": sig["title"]})
    write_json(REPORTS / "index.json", idx[:104])
    log("weekly report written:", path.name)
    return rep


# ---------- ראשי ----------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["auto", "daily", "weekly"], default="auto")
    ap.add_argument("--force-report", action="store_true")
    a = ap.parse_args()

    now_il = datetime.now(IL)
    weekly = a.mode == "weekly" or a.force_report or (
        a.mode == "auto" and now_il.weekday() == 4 and (now_il.hour, now_il.minute) >= (18, 45) and now_il.hour <= 21
    )

    prev = read_json(DATA / "vti.json", {})
    try:
        m = fetch_market()
    except RuntimeError as e:
        log(str(e), "— keeping previous data untouched")
        return 1

    hist = m["history"]
    price = m["price"]
    high = max(x["c"] for x in hist)
    day, wk, mo = pct_change(hist, 1), pct_change(hist, 5), pct_change(hist, 21)
    port = portfolio(price)
    sig = signal(price, day, wk, high, port["pnl_pct"])
    heads = fetch_headlines()

    out = {
        "status": "ok",
        "symbol": SYMBOL,
        "name": "Vanguard Total Stock Market ETF",
        "price": price,
        "price_time": m["price_time"],
        "source": m["source"],
        "change_day_pct": day,
        "change_week_pct": wk,
        "change_month_pct": mo,
        "high_52w": round(high, 4),
        "history": hist,
        "portfolio": port,
        "signal": sig,
        "headlines": heads,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "alerts": prev.get("alerts", {}),
    }

    url = site_url()

    # התראה על אירוע חריג — פעם אחת ליום מסחר, ורק כשהרמה עולה
    trade_day = hist[-1]["d"]
    market_move = abs(day or 0) >= 3 or abs(wk or 0) >= 5 or sig["level"] == "risk"  # לא מתריעים על תנודה רגילה
    if market_move and out["alerts"].get(trade_day) != sig["level"]:
        if notify(f"VTI · {sig['title']}", f"{sig['reason']}\nמחיר: ${price:.2f} · היום \u2066{(day or 0):+.2f}%\u2069\nעודכן {now_il:%d/%m %H:%M}",
                  url + "#home" if url else None, "high" if sig["level"] == "risk" else "default"):
            out["alerts"][trade_day] = sig["level"]
    out["alerts"] = dict(sorted(out["alerts"].items())[-30:])

    write_json(DATA / "vti.json", out)

    if weekly:
        rep = make_report(m, port, sig, heads, a.force_report)
        if rep:
            notify(
                "VTI · הדוח השבועי מוכן",
                f"שבוע: {rep['week_pct']:+.2f}% · שווי: ${port['value']:.2f} ({port['pnl_pct']:+.2f}%)\n{sig['title']}",
                url + f"#report/{rep['date']}" if url else None,
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
