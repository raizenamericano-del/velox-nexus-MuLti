# MULAI DI SINI

Panduan 5 menit. Kalau baru pertama kali, baca ini saja dulu.

## 1. Jalankan di laptop

```bash
npm install
npm start
```

Buka `http://localhost:3000`. Kalau tombol MP3 tidak muncul, itu artinya `ffmpeg` belum terpasang:

```bash
sudo apt install ffmpeg     # Debian/Ubuntu
brew install ffmpeg         # macOS
```

## 2. Coba downloader

Tempel link TikTok / YouTube / Instagram di kolom besar → tekan **Ambil media** → pilih format.

Link contoh ada di chip kecil di bawah kolom, atau klik kartu platform mana pun untuk mengisi contoh link otomatis.

## 3. Coba push ke GitHub

1. Buka tab **Push**.
2. Buat token: [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   - Repository access → **All repositories** (perlu untuk buat repo baru)
   - Permissions → **Contents: Read and write** + **Administration: Read and write**
3. Tempel token → **Validasi & lanjut**.
4. Lepas file `.zip` proyekmu (atau pilih folder).
5. Isi nama repo → **Push ke GitHub**.

Token hanya hidup di tab itu dan hilang saat tab ditutup. Server tidak pernah menerimanya.

## 4. Push kode ini ke GitHub

```bash
git init
git add .
git commit -m "feat: VELOX NEXUS 3.0"
git branch -M main
git remote add origin https://github.com/USERNAME/velox-nexus.git
git push -u origin main
```

Pastikan `.env` **tidak** ikut ter-commit (sudah ada di `.gitignore`).

## 5. Deploy ke Railway

1. Railway → **New Project** → **Deploy from GitHub repo** → pilih repo di atas.
2. Railway otomatis memakai `Dockerfile` + `railway.json`.
3. Tambah variable `NODE_ENV=production` (opsional: `SECURITY_CONTACT`).
4. Tunggu build (~2–3 menit, mengunduh yt-dlp + ffmpeg).
5. Buka domain dari Railway → health check harus hijau di `/api/health`.

## Kalau ada yang aneh

| Gejala | Penyebab paling sering |
|---|---|
| Semua platform gagal | IP server diblokir platform → set `YTDLP_COOKIES`, atau cek `/api/health` |
| MP3 tidak tersedia | `ffmpeg` tidak ada di server |
| Push 403 | Token kurang izin **Administration** atau akses repo bukan *All* |
| Push 413 / file dilewati | File > 45 MB — GitHub Blob API menolaknya; naikkan `GH_MAX_FILE_MB` dengan risiko |
| Halaman kosong + error CSP di console | Ada tambahan script/CDN eksternal — tidak didukung, semua aset harus `self` |

Bantuan lebih lengkap: `README.md` · kebijakan keamanan: `SECURITY.md`.
