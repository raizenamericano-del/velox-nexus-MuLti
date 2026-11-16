# Changelog

Semua perubahan penting dicatat di sini. Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/) dan [SemVer](https://semver.org/lang/id/).

## [3.0.0] — 2026-11-16

Rilis pertama VELOX NEXUS: penggabungan **VeloxXhastag-Dl 2.2** dan **Agus-Push-V2 2.1** menjadi satu workspace, dengan desain ulang dan lapisan keamanan yang jauh lebih ketat.

### Ditambahkan
- **Tab Push ke GitHub.** ZIP, folder, atau multi-file → repository via Git Data API (`blob → tree → commit → ref`), konsol progres per file, mode *Gabung* dan *Timpa total*, README otomatis, kartu hasil dengan tombol deploy Railway/Vercel.
- **Tab Repo saya.** Daftar repo (search, filter, sort), statistik, detail dengan README ter-render, daftar file, riwayat commit, hapus repo dengan konfirmasi nama.
- **Tab Docs & API.** Endpoint, model keamanan, panduan deploy, dan rantai resolver per platform.
- **15 platform baru**: Douyin, CapCut, Likee, Kwai, Streamable, Rumble, VK, OK.ru, Weibo, Bandcamp, Mixcloud, Audiomack, Coub, Imgur, Niconico (total 34).
- **Provider baru**: FxTwitter & VxTwitter untuk X (JSON keyless, multi-variant), Piped & Invidious untuk YouTube saat `yt-dlp` diblokir.
- **Routing adaptif** (`server/lib/health.js`): skor keberhasilan/latensi per jalur resolver, diurutkan ulang tiap request dengan decay 30 menit.
- **Anti-SSRF lapis kedua** (`server/lib/netguard.js`): validasi hasil resolusi DNS terhadap RFC1918/loopback/link-local/CGNAT/metadata.
- **`/api/capabilities`** — fitur aktif + guard rail push, satu sumber kebenaran untuk frontend.
- **`/.well-known/security.txt`**, `robots.txt`, dan halaman `404` yang didesain.
- **Rate limit global** per IP di samping limit per-route.
- **Test UI baru** (jsdom): boot bersih, 34 kartu platform, routing view, render hasil, filter format, error card, penolakan URL tidak valid, dan kebijakan penyimpanan token.

### Diubah
- **Desain total**: design system baru (palette olive-black + lime, hairline grid, tipografi editorial), hero art berlapis, panel download yang lebih lapang, konsol push, kartu repo, dan navigasi bawah untuk mobile. Struktur visual Velox dipertahankan, eksekusinya dinaikkan.
- **Token GitHub tidak lagi disimpan di `localStorage`.** Default memori; opsi "ingat di tab ini" memakai `sessionStorage`; kunci otomatis 30 menit.
- **CSP dipersempit**: `script-src 'self'` (tanpa CDN/inline), `connect-src` hanya origin sendiri + `api.github.com`, `frame-ancestors 'none'` di produksi.
- **CORS default `self`** (sebelumnya `*`).
- Body JSON dibatasi 16 KB dan wajib `application/json` untuk request tulis.
- Logger memakai URL yang sudah dibersihkan dan pesan yang sudah diredaksi.
- `CHANGELOG`, `SECURITY.md`, `README`, dan `.env.example` ditulis ulang untuk arsitektur gabungan.

### Diperbaiki
- Nama platform dan penghitung di UI tidak lagi hardcode; semuanya membaca `/api/platforms`, jadi tidak bisa melenceng dari backend.
- Riwayat unduhan memakai kunci versi baru (`velox.history.v3`) dengan validasi URL, plus undo saat dihapus.
- Unduhan divalidasi harus menunjuk ke `/api/dl` milik origin ini, mencegah tombol berisi URL eksternal.
- Baseline test statis 2.1 yang menghalangi perubahan diganti dengan test provenance yang bermakna.

### Dihapus
- Test browser berbasis Playwright (tidak lagi jadi dependensi) — digantikan test jsdom yang berjalan di CI tanpa unduhan browser.
- `public/js/icons.js` (sprite ikon kini satu blok SVG di `index.html`).

---

## Riwayat sebelum penggabungan

### VeloxXhastag-Dl 2.2
- Integrasi scrapr untuk Spotify, Reddit, Bilibili; caption & hashtag; engine auto-update; circuit breaker; `/api/dl` multi-mode (direct, engine, lazy audio).

### Agus-Push-V2 2.1
- ZIP → repo GitHub dengan progress real-time; dashboard repo; 6 template starter; token gate.
