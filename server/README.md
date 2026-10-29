# Defter (not) sunucusu

Sitedeki deftere bırakılan notları zamanlarıyla birlikte SQLite veritabanına kaydeder
ve her yeni notta sana mail atar. Sadece Python 3 standart kütüphanesi kullanır,
`pip install` gerekmez.

## Bilgisayarında denemek

```bash
python server/notlar.py --static . --port 8765
```

Sonra http://localhost:8765 adresini aç. SMTP ayarlamadıysan mail yerine notlar terminale yazılır.
Gece görünümünü denemek için: http://localhost:8765/?saat=22:30

## Linux sunucuya kurulum (Ubuntu/Debian + nginx)

```bash
# 0) Windows'ta (PowerShell): proje klasörünü sunucuya gönder
cd C:\Users\ekin\Desktop
scp -r ekin-site ekin@100.104.1.97:~/

# 1) Sunucuda: dosyaları yerine koy ve okunabilir yap
cd ~/ekin-site
sudo mkdir -p /opt/ekin-site /var/lib/ekin-notlar
sudo cp -r index.html css js img server /opt/ekin-site/
sudo rm -f /opt/ekin-site/server/notlar.db          # yerel test veritabanı, sunucuda gereksiz
sudo find /opt/ekin-site -type d -exec chmod 755 {} +
sudo find /opt/ekin-site -type f -exec chmod 644 {} +
sudo chown -R www-data:www-data /var/lib/ekin-notlar

# 2) Ayarlar
cd /opt/ekin-site/server
sudo cp .env.example .env
sudo nano .env            # SMTP_PASS, ADMIN_TOKEN, IP_SALT... doldur
sudo chown www-data:www-data .env && sudo chmod 600 .env

# 3) Servis
sudo cp ekin-notlar.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ekin-notlar
curl http://127.0.0.1:8787/api/health      # {"ok": true}

# 4) nginx
sudo cp nginx-ornek.conf /etc/nginx/sites-available/ekin-site
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/ekin-site /etc/nginx/sites-enabled/ekin-site
sudo nginx -t && sudo systemctl reload nginx
```

## Yayın: ekinkarincali.com (Cloudflare Tunnel)

Alan adı Cloudflare'de; sunucudaki `cloudflared` Docker konteyneri (`~/sunucu/website`)
token ile çalışır, yönlendirme ayarı Cloudflare panelindedir:

- Zero Trust → Networks → Tunnels → tünel → Public Hostname
- `ekinkarincali.com` ve `www.ekinkarincali.com` → Service: `HTTP` / `localhost:80`
- Eski site `localhost:8081`'deki `website` Docker konteyneriydi; kaldırıldı. Tünel konteyneri
  (`cloudflared`) aynı klasördeki `docker-compose.yml` ile çalışmaya devam ediyor; eski dosyanın yedeği
  `docker-compose.yml.yedek`, eski sitenin dosyaları `~/sunucu/website/html` klasöründe duruyor.

## Siteyi güncellemek

Windows'ta, `ekin-site` klasöründe PowerShell aç ve tek komut çalıştır:

```bash
powershell -ExecutionPolicy Bypass -File .\deploy.ps1
```

Betik `index.html`, `css`, `js`, `img` ve `server/notlar.py` dosyalarını paketler, sunucuya gönderir,
`/opt/ekin-site` içine açar, izinleri düzeltir ve not servisini yeniden başlatır. Sunucu `sudo` şifreni sorar.
CSS/JS sürüm numarasını (`?v=...`) her seferinde kendisi yeniler; Cloudflare önbelleği için bir şey yapmana gerek yok.
`.env` ve not veritabanına dokunmaz. Göndermeden sadece paketi görmek için: `.\deploy.ps1 -Deneme`

Not: Sunucudaki zsh, içinde web adresi geçen satırları yapıştırırken `;` gibi karakterlerin önüne `\` ekleyebiliyor.
nginx ayarını değiştirdikten sonra mutlaka `sudo nginx -t` ile kontrol et.

## Notları okumak

- Her not mail olarak gelir.
- Sunucuda: `sudo -u www-data python3 /opt/ekin-site/server/notlar.py --list`
- Uzaktan (ADMIN_TOKEN ayarlıysa):
  `curl -H "Authorization: Bearer <ADMIN_TOKEN>" https://ekinkarincali.com/api/notes`
- Servis logları: `journalctl -u ekin-notlar -f`

## API başka bir adresteyse

Site GitHub Pages gibi başka bir yerde, API senin sunucundaysa:
`index.html` içindeki `<meta name="notlar-api" content="/api/notes">` satırını
`https://api.alanadin.com/api/notes` gibi tam adresle değiştir ve `.env` içinde
`ALLOWED_ORIGINS=https://sitenin-adresi.com` yaz.

## Koruma

- Gizli bir "bot tuzağı" alanı var; botlar doldurursa not kaydedilmez.
- Bir IP 10 dakikada en fazla 3 not, günde toplam en fazla 300 not gönderebilir (`.env`'den değişir).
- İsim en fazla 40, not en fazla 1000 karakter. IP adresleri açık saklanmaz.
- Mail gönderilemese bile not veritabanına kaydedilir; hata `journalctl`'da görünür.
