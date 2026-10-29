# Siteyi sunucuya (ekinkarincali.com) gönderir.
# Kullanım (ekin-site klasöründe, PowerShell'de):
#   powershell -ExecutionPolicy Bypass -File .\deploy.ps1           -> gönder
#   powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -Deneme   -> sadece paketi hazırla, gönderme
param([switch]$Deneme)
$ErrorActionPreference = "Stop"

$Sunucu = "ekin@100.104.1.97"
$Kok = $PSScriptRoot
$Gecici = Join-Path $env:TEMP "ekin-site-paket"
$Paket = Join-Path $env:TEMP "ekin-site.tgz"

# 1) Sadece sitenin ihtiyaç duyduğu dosyaları topla (.env, veritabanı, yedekler gitmez)
if (Test-Path $Gecici) { Remove-Item $Gecici -Recurse -Force }
New-Item -ItemType Directory $Gecici | Out-Null
foreach ($d in "css", "js", "img") { Copy-Item (Join-Path $Kok $d) $Gecici -Recurse }
New-Item -ItemType Directory (Join-Path $Gecici "server") | Out-Null
Copy-Item (Join-Path $Kok "server\notlar.py") (Join-Path $Gecici "server")

# 2) CSS/JS bağlantılarına yeni sürüm numarası ver: Cloudflare ve tarayıcılar eski dosyayı göstermesin
$Surum = Get-Date -Format "yyyyMMddHHmm"
$html = [IO.File]::ReadAllText((Join-Path $Kok "index.html"))
$html = [regex]::Replace($html, '\?v=[0-9A-Za-z]+', "?v=$Surum")
[IO.File]::WriteAllText((Join-Path $Gecici "index.html"), $html, (New-Object Text.UTF8Encoding $false))

if (Test-Path $Paket) { Remove-Item $Paket -Force }
tar -czf $Paket -C $Gecici .
if ($LASTEXITCODE -ne 0) { throw "Paket hazirlanamadi" }
Write-Host "Paket hazir (surum $Surum):"
tar -tzf $Paket | Where-Object { $_ -notmatch '/$' }

if ($Deneme) { Write-Host "Deneme modu: sunucuya gonderilmedi."; exit 0 }

# 3) Sunucuya gönder ve yerine aç (sudo şifren sorulur)
scp $Paket "${Sunucu}:~/ekin-site.tgz"
if ($LASTEXITCODE -ne 0) { throw "Dosya sunucuya gonderilemedi" }
$Komut = 'sudo tar -xzf ~/ekin-site.tgz -C /opt/ekin-site --no-same-owner && ' +
         'sudo find /opt/ekin-site -path /opt/ekin-site/server/.env -prune -o -type d -exec chmod 755 {} + -o -type f -exec chmod 644 {} + && ' +
         'sudo systemctl restart ekin-notlar && rm ~/ekin-site.tgz && echo Site guncellendi: https://ekinkarincali.com'
ssh -t $Sunucu $Komut
if ($LASTEXITCODE -ne 0) { throw "Sunucuda guncelleme basarisiz" }
