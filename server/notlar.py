#!/usr/bin/env python3
"""Ekin'in defteri: sitedeki defterden bırakılan notları SQLite'a kaydeder ve mail atar.

Sadece Python standart kütüphanesi kullanır (kurulacak paket yok).

  POST /api/notes   {"name": "...", "message": "...", "website": ""}  -> not kaydeder
  GET  /api/notes   (Authorization: Bearer <ADMIN_TOKEN>)             -> notları listeler
  GET  /api/health                                                     -> {"ok": true}

Ayarlar ortam değişkenlerinden ya da bu dosyanın yanındaki .env dosyasından okunur
(bkz. .env.example). Komut satırı:

  python3 notlar.py                     # sunucuyu başlat
  python3 notlar.py --static ..         # geliştirme: siteyi de aynı porttan servis et
  python3 notlar.py --list              # kayıtlı notları terminalde göster
"""
import argparse
import hashlib
import json
import os
import smtplib
import sqlite3
import ssl
import sys
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
TR = timezone(timedelta(hours=3))  # Türkiye yıl boyu UTC+3

MAX_NAME = 40
MAX_MESSAGE = 1000
MAX_BODY = 8 * 1024


def load_env(path):
    """Basit .env okuyucu: ANAHTAR=değer satırları, # ile başlayanlar yorum."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            val = val.strip().strip('"').strip("'")
            os.environ.setdefault(key.strip(), val)


def cfg(key, default=""):
    return os.environ.get(key, default)


# ------------------------------------------------------------------ veritabanı
_db_lock = threading.Lock()


def db_connect():
    path = cfg("DB_PATH", os.path.join(HERE, "notlar.db"))
    con = sqlite3.connect(path, check_same_thread=False)
    con.execute(
        """CREATE TABLE IF NOT EXISTS notes (
               id         INTEGER PRIMARY KEY AUTOINCREMENT,
               created_at TEXT    NOT NULL,
               name       TEXT    NOT NULL DEFAULT '',
               message    TEXT    NOT NULL,
               ip_hash    TEXT    NOT NULL DEFAULT '',
               user_agent TEXT    NOT NULL DEFAULT '',
               mailed     INTEGER NOT NULL DEFAULT 0
           )"""
    )
    con.commit()
    return con


DB = None


def save_note(name, message, ip_hash, ua):
    created = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with _db_lock:
        cur = DB.execute(
            "INSERT INTO notes (created_at, name, message, ip_hash, user_agent) VALUES (?, ?, ?, ?, ?)",
            (created, name, message, ip_hash, ua[:200]),
        )
        DB.commit()
        return cur.lastrowid, created


def mark_mailed(note_id):
    with _db_lock:
        DB.execute("UPDATE notes SET mailed = 1 WHERE id = ?", (note_id,))
        DB.commit()


def list_notes(limit=200):
    with _db_lock:
        rows = DB.execute(
            "SELECT id, created_at, name, message, mailed FROM notes ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(zip(("id", "created_at", "name", "message", "mailed"), r)) for r in rows]


# ------------------------------------------------------------------ mail
def tr_time(iso):
    return datetime.fromisoformat(iso).astimezone(TR).strftime("%d.%m.%Y %H:%M")


def send_mail(note_id, created, name, message):
    to = cfg("MAIL_TO")
    host = cfg("SMTP_HOST")
    body = (
        "Sitendeki deftere yeni bir not bırakıldı!\n\n"
        f"Zaman : {tr_time(created)} (Türkiye saati)\n"
        f"İsim  : {name or '(isim yazmadı)'}\n"
        f"Not #{note_id}:\n\n{message}\n"
    )
    if not (to and host):
        print(f"[mail] SMTP ayarı yok, mail yerine buraya yazıyorum:\n{body}", flush=True)
        return
    msg = EmailMessage()
    msg["Subject"] = "Defterine yeni bir not var" + (f" ({name})" if name else "")
    msg["From"] = cfg("MAIL_FROM") or cfg("SMTP_USER") or to
    msg["To"] = to
    msg.set_content(body)
    port = int(cfg("SMTP_PORT", "465"))
    security = cfg("SMTP_SECURITY", "ssl" if port == 465 else "starttls").lower()
    user, password = cfg("SMTP_USER"), cfg("SMTP_PASS")
    try:
        if security == "ssl":
            server = smtplib.SMTP_SSL(host, port, context=ssl.create_default_context(), timeout=20)
        else:
            server = smtplib.SMTP(host, port, timeout=20)
            if security == "starttls":
                server.starttls(context=ssl.create_default_context())
        with server:
            if user:
                server.login(user, password)
            server.send_message(msg)
        mark_mailed(note_id)
        print(f"[mail] not #{note_id} için mail gönderildi", flush=True)
    except Exception as exc:  # not kaydedildi; mail hatası ziyaretçiyi etkilemesin
        print(f"[mail] not #{note_id} için mail gönderilemedi: {exc!r}", file=sys.stderr, flush=True)


# ------------------------------------------------------------------ hız sınırı
class RateLimiter:
    def __init__(self, per_ip, window, daily):
        self.per_ip, self.window, self.daily = per_ip, window, daily
        self.hits = defaultdict(deque)
        self.day = deque()
        self.lock = threading.Lock()

    def allow(self, key):
        now = time.time()
        with self.lock:
            q = self.hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            while self.day and now - self.day[0] > 86400:
                self.day.popleft()
            if len(q) >= self.per_ip or len(self.day) >= self.daily:
                return False
            q.append(now)
            self.day.append(now)
            if len(self.hits) > 5000:  # hafızayı temiz tut
                for k in [k for k, v in self.hits.items() if not v]:
                    del self.hits[k]
            return True


LIMITER = None


# ------------------------------------------------------------------ HTTP
class Handler(SimpleHTTPRequestHandler):
    server_version = "EkinDefter/1.0"
    static_root = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=self.static_root or HERE, **kwargs)

    # --- yardımcılar
    def client_ip(self):
        ip = self.client_address[0]
        if cfg("TRUST_PROXY", "1") == "1" and ip in ("127.0.0.1", "::1"):
            fwd = self.headers.get("X-Real-IP") or (self.headers.get("X-Forwarded-For") or "").split(",")[0]
            if fwd.strip():
                ip = fwd.strip()
        return ip

    def cors(self):
        origin = self.headers.get("Origin")
        allowed = [o.strip() for o in cfg("ALLOWED_ORIGINS").split(",") if o.strip()]
        if origin and origin in allowed:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def json(self, status, data):
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.cors()
        self.end_headers()
        self.wfile.write(raw)

    def end_headers(self):
        if self.static_root and not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            sys.stderr.write("%s - %s\n" % (self.log_date_time_string(), fmt % args))

    # --- yönlendirme
    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.cors()
        self.end_headers()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/health":
            return self.json(200, {"ok": True})
        if path == "/api/notes":
            token = cfg("ADMIN_TOKEN")
            auth = self.headers.get("Authorization", "")
            if not token or auth != f"Bearer {token}":
                return self.json(401, {"error": "Yetkisiz"})
            return self.json(200, {"notes": list_notes()})
        if self.static_root:
            return super().do_GET()
        return self.json(404, {"error": "Bulunamadı"})

    def do_HEAD(self):
        if self.static_root:
            return super().do_HEAD()
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if urlsplit(self.path).path != "/api/notes":
            return self.json(404, {"error": "Bulunamadı"})
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            return self.json(415, {"error": "JSON bekleniyordu"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            return self.json(413, {"error": "Not çok uzun"})
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(data, dict):
                raise ValueError
        except (ValueError, UnicodeDecodeError):
            return self.json(400, {"error": "Geçersiz istek"})

        # Bot tuzağı: gizli alan doluysa sessizce "tamam" de, kaydetme
        if str(data.get("website") or "").strip():
            return self.json(200, {"ok": True})

        name = " ".join(str(data.get("name") or "").split())[:MAX_NAME]
        message = str(data.get("message") or "").replace("\r\n", "\n").strip()
        message = "".join(ch for ch in message if ch == "\n" or ch == "\t" or ord(ch) >= 32)
        if not message:
            return self.json(400, {"error": "Not boş olamaz"})
        if len(message) > MAX_MESSAGE:
            return self.json(400, {"error": f"Not en fazla {MAX_MESSAGE} karakter olabilir"})

        ip = self.client_ip()
        if not LIMITER.allow(ip):
            return self.json(429, {"error": "Çok fazla not gönderildi, biraz sonra tekrar dene"})

        ip_hash = hashlib.sha256((cfg("IP_SALT", "defter") + ip).encode()).hexdigest()[:16]
        note_id, created = save_note(name, message, ip_hash, self.headers.get("User-Agent", ""))
        threading.Thread(target=send_mail, args=(note_id, created, name, message), daemon=True).start()
        return self.json(201, {"ok": True, "id": note_id, "created_at": created})


def main():
    global DB, LIMITER
    load_env(os.path.join(HERE, ".env"))
    ap = argparse.ArgumentParser(description="Ekin'in defteri: not API'si")
    ap.add_argument("--host", default=cfg("HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(cfg("PORT", "8787")))
    ap.add_argument("--static", help="geliştirme için siteyi de bu klasörden servis et")
    ap.add_argument("--list", action="store_true", help="kayıtlı notları yazdır ve çık")
    args = ap.parse_args()

    DB = db_connect()
    if args.list:
        for n in reversed(list_notes(1000)):
            print(f"#{n['id']}  {tr_time(n['created_at'])}  {n['name'] or '(isimsiz)'}\n    {n['message']}\n")
        return

    LIMITER = RateLimiter(
        per_ip=int(cfg("RATE_PER_IP", "3")),
        window=int(cfg("RATE_WINDOW_SEC", "600")),
        daily=int(cfg("RATE_DAILY", "300")),
    )
    if args.static:
        Handler.static_root = os.path.abspath(args.static)
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    where = f" + site ({Handler.static_root})" if args.static else ""
    print(f"Defter API http://{args.host}:{args.port}/api/notes{where}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
