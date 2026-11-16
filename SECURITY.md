# Kebijakan & model keamanan — VELOX NEXUS

Dokumen ini menjelaskan **apa yang dilindungi, dari apa, dan dengan cara apa**. Kalau kamu menemukan celah, bagian terakhir menjelaskan cara melaporkannya.

---

## 1. Aset yang dilindungi

| Aset | Di mana | Siapa yang boleh melihat |
|---|---|---|
| **Token GitHub pengguna** | Memori tab / `sessionStorage` | Hanya tab itu, dan hanya `api.github.com` |
| Isi file yang di-push | Memori tab → GitHub | Hanya GitHub |
| Riwayat link | `localStorage` | Hanya perangkat itu |
| Media hasil unduhan | Streaming (tidak disimpan) | Klien yang meminta |
| Kredensial upstream (cookie, API key Spotify) | Environment server | Hanya proses server |

**Yang tidak kami simpan:** tidak ada database, tidak ada akun, tidak ada log request yang berisi URL lengkap atau header.

---

## 2. Model ancaman

### 2.1 Token GitHub dicuri

Ini risiko terbesar pada alat "ZIP → repo", karena token itu bisa menulis ke repository.

**Yang kami lakukan:**

1. **Token tidak pernah dikirim ke server aplikasi.** Modul push memanggil `https://api.github.com` langsung dari browser. Tidak ada endpoint di server ini yang menerima token. Artinya: tidak ada payload, log, atau memory dump server yang bisa membocorkannya. Kamu bisa memverifikasinya — cari string `Authorization` di `server/`: tidak ada satu pun.
2. **Bukan `localStorage`.** Versi awal proyek ini menyimpan token di `localStorage`, yang berarti token tetap ada setelah tab ditutup dan bisa dibaca skrip mana pun yang berjalan di origin yang sama. Sekarang default-nya **memori saja**; opsi "ingat di tab ini" memakai `sessionStorage` yang hilang bersama tab.
3. **Kunci otomatis.** Setelah 30 menit tanpa aktivitas, token dihapus dari memori dan UI kembali ke layar token.
4. **Tombol "Kunci & hapus token"** menghapus memory + `sessionStorage` sekaligus.
5. **Redaksi di jalur error.** `server/security.js` membersihkan pola `ghp_*`, `github_pat_*`, `Bearer …` dari pesan error dan log.
6. **Rekomendasi token minimal.** UI menyarankan *fine-grained token* dengan `Contents: Read and write` (+ `Administration: Read and write` hanya kalau ingin membuat repo baru) dan bukan token classic dengan scope `repo` penuh.

### 2.2 XSS (skrip pihak ketiga berjalan di origin kita)

Kalau penyerang bisa menjalankan skrip di halaman ini, ia bisa membaca token yang sedang aktif.

**Yang kami lakukan:**

- **CSP tanpa pengecualian skrip:** `script-src 'self'` — tidak ada CDN, tidak ada inline script, tidak ada `eval`. Semua handler terpasang lewat `addEventListener`.
- **Tanpa `unsafe-eval`**, tanpa `wasm-unsafe-eval`.
- **Semua data dinamis di-escape.** Renderer memakai `textContent` atau fungsi `esc()` sebelum masuk `innerHTML`. Judul video, caption, nama file, isi README — semuanya diperlakukan sebagai teks.
- **README dirender oleh parser sendiri** (`public/js/markdown.js`) yang meng-escape lebih dulu, lalu memformat; HTML mentah tidak pernah dieksekusi. Tautan dibatasi ke `http(s)`, `mailto`, `#`, dan path relatif.
- **Tidak ada `innerHTML` dari payload jaringan tanpa escape** — termasuk pesan error dari provider.
- **CSP tambahan:** `object-src 'none'`, `base-uri 'none'`, `frame-src 'none'`, `form-action 'self'`.

### 2.3 SSRF (server dipakai memindai jaringan internal)

`/api/dl` meneruskan URL dari pengguna. Tanpa penjagaan, itu jadi proxy untuk menjangkau `169.254.169.254` (metadata cloud) atau service internal Railway.

**Yang kami lakukan (dua lapis):**

1. **Allowlist hostname.** Hanya CDN platform yang dikenal (TikTok, Instagram, Google Video, …) ditambah host yang dikonfigurasi operator (instance Piped/Invidious/cobalt). IP literal dan host acak selalu ditolak.
2. **Pemeriksaan DNS.** `server/lib/netguard.js` me-resolve nama dan menolak bila ada jawaban di RFC1918, loopback, link-local, CGNAT, multicast, atau reserved. Ini menutup trik "nama publik yang mengarah ke alamat privat" dan DNS rebinding sederhana (hasil di-cache 60 detik untuk membatasi TOCTOU).
3. Skema dibatasi `http`/`https`; `ftp://`, `file://`, `gopher://` ditolak sebelum dipakai.

### 2.4 ZIP berbahaya

Arsip bisa mencoba menulis di luar folder tujuan (zip-slip) atau menghabiskan memori (zip bomb).

**Yang kami lakukan** (`public/js/push.js`):

- Path dinormalisasi; `..`, path absolut, backslash, drive letter Windows, dan segmen kosong dibuang. Entri yang tidak lolos validasi **tidak diunggah**.
- `__MACOSX/`, `.git/`, `.DS_Store`, `Thumbs.db`, `desktop.ini` dilewati.
- Batas: **jumlah file**, **ukuran per file**, dan **total** — ditegakkan di browser dan dicerminkan dari server (`/api/capabilities`) supaya tidak ada dua sumber kebenaran.
- File melebihi batas ditandai dan dilewati, bukan menggagalkan seluruh push.

### 2.5 Penyalahgunaan API & biaya

**Yang kami lakukan:**

- Rate limit per IP pada `/api/resolve`, `/api/dl`, dan sebuah lapisan global untuk seluruh `/api`.
- `trust proxy` + `X-Forwarded-For` di belakang Railway agar limit melihat IP klien, bukan IP proxy.
- Cache TTL 10 menit agar link populer tidak memicu resolve berulang.
- Semaphore + batas konkurensi engine sehingga satu klien tidak bisa menghabiskan semua worker.
- Timeout keras per resolve dan per request upstream.

### 2.6 CSRF

API ini tidak memakai cookie, jadi serangan berbasis cookie tidak berlaku. Sebagai lapisan tambahan, `originGuard` menolak request `POST`/`PUT`/`PATCH`/`DELETE` ke `/api` yang membawa `Origin`/`Referer` asing (kecuali `CORS_ORIGIN` dibuka eksplisit).

### 2.7 Kebocoran data di respon error

- Pesan error dipetakan ke pesan yang ramah (`server/lib/errors.js`) — stack trace tidak pernah keluar ke klien.
- `security.redact()` dan `security.redactBody()` membersihkan token/secret/cookie dari log dan body.
- `security.safeUrl()` membuang query string sebelum URL dicatat, karena banyak CDN menaruh tanda tangan di sana.

### 2.8 Container & deployment

- Image berjalan sebagai **non-root** (`useradd -u 1001`).
- `tini` sebagai PID 1, jadi proses `yt-dlp`/`ffmpeg` yatim tidak menumpuk.
- Hanya `package*.json` + `server` + `public` masuk image; test, docs, dan `.env` tidak.
- `.env` masuk `.gitignore` dan `.dockerignore`.
- Healthcheck bawaan; restart policy `ON_FAILURE`.

---

## 3. Header yang dikirim

```
Content-Security-Policy: default-src 'self'; script-src 'self';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:;
  connect-src 'self' https://api.github.com; frame-ancestors 'none'; …
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), …
Strict-Transport-Security: max-age=15552000; includeSubDomains   (produksi)
X-Frame-Options: DENY                                            (produksi)
```

`style-src 'unsafe-inline'` adalah satu-satunya konsesi, dibutuhkan untuk atribut `style` pada progress bar dan thumbnail. Skrip tetap terkunci ke `'self'`.

---

## 4. Yang secara sadar **tidak** kami janjikan

Jujur soal batas:

- **Bukan alat anonim.** Server melihat IP-mu saat resolve (seperti situs mana pun), dan platform tujuan melihat IP server.
- **Bukan pengganti password manager.** Token tetap kredensial; kalau perangkatmu sudah terkompromi, CSP tidak menolong.
- **Bukan jaminan konten selalu bisa diunduh.** Platform mengubah pertahanannya terus-menerus.
- **Tidak ada audit keamanan pihak ketiga.** Kode ini terbuka; baca dan verifikasi sendiri.
- **`ALLOW_EMBED_PREVIEW=true` melemahkan perlindungan framing.** Jangan diaktifkan di produksi publik.

---

## 5. Melaporkan celah

Kalau kamu menemukan masalah keamanan, jangan buka issue publik. Kirim ke kontak yang tercantum di `/.well-known/security.txt` (diatur lewat `SECURITY_CONTACT`) dengan:

- langkah reproduksi,
- dampak yang mungkin,
- versi/commit yang diuji.

Kami akan mengonfirmasi penerimaan, lalu memberi tahu saat perbaikan tersedia. Tidak ada program bounty, tapi kredit akan dicantumkan bila diinginkan.
