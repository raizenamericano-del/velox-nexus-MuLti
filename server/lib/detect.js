'use strict';

/**
 * Single source of truth for supported platforms.
 * `test` = regex used for auto-detection, `tier` matches the product brief.
 * Also feeds /api/platforms so the UI never drifts from the backend.
 */
const PLATFORMS = [
  {
    id: 'tiktok', name: 'TikTok', tier: 1, color: '#25F4EE', accent: '#FE2C55',
    kinds: ['Video', 'Photo Slide', 'MP3', 'No Watermark'],
    test: /(^|\.)tiktok\.com$/i,
    sample: 'https://www.tiktok.com/@tiktok/video/7460937381265411370',
    engine: 'tikwm + yt-dlp',
  },
  {
    id: 'instagram', name: 'Instagram', tier: 1, color: '#E1306C', accent: '#F77737',
    kinds: ['Reels', 'Post', 'Carousel', 'IGTV', 'Story'],
    test: /(^|\.)instagram\.com$/i,
    sample: 'https://www.instagram.com/reel/C1x2y3z/',
    engine: 'API cadangan + yt-dlp',
  },
  {
    id: 'youtube', name: 'YouTube', tier: 1, color: '#FF0000', accent: '#FF4E45',
    kinds: ['MP4', 'MP3', 'Shorts', 'Thumbnail', 'Playlist'],
    test: /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i,
    sample: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    engine: 'yt-dlp + API cadangan',
  },
  {
    id: 'facebook', name: 'Facebook', tier: 1, color: '#1877F2', accent: '#42A5F5',
    kinds: ['Video', 'Reels', 'Watch'],
    test: /(^|\.)(facebook\.com|fb\.watch|fb\.com|m\.facebook\.com)$/i,
    sample: 'https://www.facebook.com/watch/?v=1234567890',
    engine: 'yt-dlp + API cadangan',
  },
  {
    id: 'twitter', name: 'X / Twitter', tier: 1, color: '#E7E9EA', accent: '#1D9BF0',
    kinds: ['Video', 'GIF', 'Image'],
    test: /(^|\.)(twitter\.com|x\.com|fxtwitter\.com|vxtwitter\.com)$/i,
    sample: 'https://x.com/i/status/1580661436132757506',
    engine: 'syndication + yt-dlp',
  },
  {
    id: 'pinterest', name: 'Pinterest', tier: 2, color: '#E60023', accent: '#FF5252',
    kinds: ['Video', 'Image HD', 'GIF'],
    test: /(^|\.)(pinterest\.com|pinterest\.co\.id|pin\.it)$/i,
    sample: 'https://www.pinterest.com/pin/123456789/',
    engine: 'yt-dlp + API cadangan',
  },
  {
    id: 'rednote', name: 'RedNote / 小红书', tier: 2, color: '#FF2442', accent: '#FF6B81',
    kinds: ['Video', 'Image'],
    test: /(^|\.)(xiaohongshu\.com|xhslink\.com)$/i,
    sample: 'https://www.xiaohongshu.com/explore/000000000000000000000000',
    engine: 'yt-dlp + API cadangan (terbatas)',
  },
  {
    id: 'snapchat', name: 'Snapchat', tier: 2, color: '#FFFC00', accent: '#FCE100',
    kinds: ['Spotlight', 'Story'],
    test: /(^|\.)(snapchat\.com|t\.snapchat\.com)$/i,
    sample: 'https://www.snapchat.com/spotlight/abcdef',
    engine: 'yt-dlp (SnapchatSpotlight)',
  },
  {
    id: 'threads', name: 'Threads', tier: 2, color: '#D8D8D8', accent: '#9B9B9B',
    kinds: ['Video', 'Image'],
    test: /(^|\.)(threads\.net|threads\.com)$/i,
    sample: 'https://www.threads.net/@user/post/ABC123',
    engine: 'yt-dlp + API cadangan',
  },
  {
    id: 'linkedin', name: 'LinkedIn', tier: 2, color: '#0A66C2', accent: '#4A9EFF',
    kinds: ['Video', 'Post'],
    test: /(^|\.)(linkedin\.com|lnkd\.in)$/i,
    sample: 'https://www.linkedin.com/posts/user_activity-000',
    engine: 'yt-dlp',
  },
  {
    id: 'vimeo', name: 'Vimeo', tier: 3, color: '#1AB7EA', accent: '#5BC8F0',
    kinds: ['Video HD'],
    test: /(^|\.)(vimeo\.com|player\.vimeo\.com)$/i,
    sample: 'https://vimeo.com/76979871',
    engine: 'yt-dlp',
  },
  {
    id: 'dailymotion', name: 'Dailymotion', tier: 3, color: '#0066DC', accent: '#3D8BFF',
    kinds: ['Video'],
    test: /(^|\.)(dailymotion\.com|dai\.ly)$/i,
    sample: 'https://www.dailymotion.com/video/x8abcde',
    engine: 'yt-dlp',
  },
  {
    id: 'twitch', name: 'Twitch', tier: 3, color: '#9146FF', accent: '#B084FF',
    kinds: ['Clip', 'VOD'],
    test: /(^|\.)(twitch\.tv|clips\.twitch\.tv)$/i,
    sample: 'https://clips.twitch.tv/SomeClipName',
    engine: 'yt-dlp',
  },
  {
    id: 'soundcloud', name: 'SoundCloud', tier: 3, color: '#FF5500', accent: '#FF8533',
    kinds: ['MP3'],
    test: /(^|\.)(soundcloud\.com|snd\.sc)$/i,
    sample: 'https://soundcloud.com/artist/track',
    engine: 'yt-dlp',
  },
  {
    id: 'spotify', name: 'Spotify', tier: 2, color: '#1DB954', accent: '#1ED760',
    kinds: ['Provider Audio', 'Info', 'Official Preview'], mode: 'provider-audio',
    test: /(^|\.)(open\.spotify\.com|spotify\.link|spoti\.fi)$/i,
    sample: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
    engine: 'scrapr adapters + official metadata fallback',
    limitation: 'Audio track dari provider pihak ketiga jika tersedia, bukan jaminan file asli Spotify. Album/playlist: info; fallback resmi: info/preview.',
  },
  {
    id: 'reddit', name: 'Reddit', tier: 2, color: '#FF5700', accent: '#FF7840',
    kinds: ['Video', 'Image', 'Gallery'],
    test: /(^|\.)(reddit\.com|redd\.it)$/i,
    sample: 'https://www.reddit.com/r/videos/comments/POST_ID/',
    engine: 'Public JSON + scrapr RapidSave + yt-dlp',
    limitation: 'Konten publik; video dan audio dapat memerlukan penggabungan ffmpeg.',
  },
  {
    id: 'bluesky', name: 'Bluesky', tier: 2, color: '#449AFF', accent: '#76B4FF',
    kinds: ['Video', 'Image'],
    test: /(^|\.)bsky\.app$/i,
    sample: 'https://bsky.app/profile/handle.bsky.social/post/POST_ID',
    engine: 'Public AT Protocol API + yt-dlp',
    limitation: 'Post foto/video publik. Unduhan video memerlukan yt-dlp.',
  },
  {
    id: 'tumblr', name: 'Tumblr', tier: 3, color: '#9AACC5', accent: '#B2C6E4',
    kinds: ['Video', 'Audio'],
    test: /(^|\.)tumblr\.com$/i,
    sample: 'https://blog.tumblr.com/post/POST_ID', engine: 'yt-dlp (Tumblr)',
    limitation: 'Video/audio publik yang didukung extractor. Post foto saja belum didukung.',
  },
  {
    id: 'bilibili', name: 'Bilibili', tier: 3, color: '#48C4EA', accent: '#71D7F6',
    kinds: ['Video', 'Audio'],
    test: /(^|\.)(bilibili\.com|b23\.tv)$/i,
    sample: 'https://www.bilibili.com/video/BV1xx411c7mD/', engine: 'scrapr Bilibili API + yt-dlp',
    limitation: 'Video publik; kualitas/akses mengikuti pembatasan wilayah dan sumber.',
  },
  // ── NEXUS expansion: extractors shipped by yt-dlp, verified against the
  //    engine's site list. Everything here resolves through the generic engine
  //    chain, so a platform that breaks only costs one attempt, never a whole
  //    request.
  {
    id: 'douyin', name: 'Douyin', tier: 3, color: '#FE2C55', accent: '#25F4EE', isNew: true,
    kinds: ['Video', 'No Watermark'],
    test: /(^|\.)(douyin\.com|iesdouyin\.com)$/i,
    sample: 'https://www.douyin.com/video/7300000000000000000',
    engine: 'yt-dlp (Douyin)',
    limitation: 'Link publik; beberapa video butuh cookies dari region asal.',
  },
  {
    id: 'capcut', name: 'CapCut', tier: 3, color: '#0B0B0F', accent: '#7AE1FF', isNew: true,
    kinds: ['Template Video'],
    test: /(^|\.)(capcut\.com|capcut\.cn)$/i,
    sample: 'https://www.capcut.com/template-detail/7000000000000000000',
    engine: 'yt-dlp (CapCut)',
  },
  {
    id: 'likee', name: 'Likee', tier: 3, color: '#FF0F50', accent: '#FF7A93', isNew: true,
    kinds: ['Video'],
    test: /(^|\.)(likee\.video|likee\.com)$/i,
    sample: 'https://likee.video/@user/video/123456789',
    engine: 'yt-dlp (Likee)',
  },
  {
    id: 'kwai', name: 'Kwai', tier: 3, color: '#FF7300', accent: '#FFA14E', isNew: true,
    kinds: ['Video'],
    test: /(^|\.)(kwai\.com|kwai-video\.com|kwaicdn\.com)$/i,
    sample: 'https://www.kwai.com/@user/video/1234567890',
    engine: 'yt-dlp (Kwai)',
  },
  {
    id: 'streamable', name: 'Streamable', tier: 3, color: '#0F9D58', accent: '#4BD98F', isNew: true,
    kinds: ['Video'],
    test: /(^|\.)streamable\.com$/i,
    sample: 'https://streamable.com/abcdef',
    engine: 'yt-dlp (Streamable)',
  },
  {
    id: 'rumble', name: 'Rumble', tier: 3, color: '#85C742', accent: '#A8E06E', isNew: true,
    kinds: ['Video', 'Audio'],
    test: /(^|\.)rumble\.com$/i,
    sample: 'https://rumble.com/v5abcde-title.html',
    engine: 'yt-dlp (Rumble)',
  },
  {
    id: 'vk', name: 'VK', tier: 3, color: '#0077FF', accent: '#5EA8FF', isNew: true,
    kinds: ['Video', 'Audio'],
    test: /(^|\.)(vk\.com|vkvideo\.ru|vk\.ru)$/i,
    sample: 'https://vk.com/video-123456789_456239017',
    engine: 'yt-dlp (VK)',
  },
  {
    id: 'okru', name: 'OK.ru', tier: 3, color: '#EE8208', accent: '#FFA94D', isNew: true,
    kinds: ['Video'],
    test: /(^|\.)(ok\.ru|odnoklassniki\.ru)$/i,
    sample: 'https://ok.ru/video/1234567890',
    engine: 'yt-dlp (Odnoklassniki)',
  },
  {
    id: 'weibo', name: 'Weibo', tier: 3, color: '#E6162D', accent: '#FF5A6E', isNew: true,
    kinds: ['Video'],
    test: /(^|\.)(weibo\.com|weibo\.cn)$/i,
    sample: 'https://weibo.com/tv/show/1034:abcdef',
    engine: 'yt-dlp (Weibo)',
    limitation: 'Sebagian video butuh login; yang publik tetap bisa diambil.',
  },
  {
    id: 'bandcamp', name: 'Bandcamp', tier: 3, color: '#629AA9', accent: '#8FC3D2', isNew: true,
    kinds: ['MP3', 'Album'],
    test: /(^|\.)bandcamp\.com$/i,
    sample: 'https://artist.bandcamp.com/track/song-name',
    engine: 'yt-dlp (Bandcamp)',
  },
  {
    id: 'mixcloud', name: 'Mixcloud', tier: 3, color: '#5000FF', accent: '#8A66FF', isNew: true,
    kinds: ['Audio', 'Mix'],
    test: /(^|\.)mixcloud\.com$/i,
    sample: 'https://www.mixcloud.com/artist/mix-name/',
    engine: 'yt-dlp (Mixcloud)',
  },
  {
    id: 'audiomack', name: 'Audiomack', tier: 3, color: '#FFA200', accent: '#FFC24D', isNew: true,
    kinds: ['MP3'],
    test: /(^|\.)audiomack\.com$/i,
    sample: 'https://audiomack.com/artist/song/song-name',
    engine: 'yt-dlp (Audiomack)',
  },
  {
    id: 'coub', name: 'Coub', tier: 3, color: '#0B9BE3', accent: '#5BC4F5', isNew: true,
    kinds: ['Video', 'Audio Loop'],
    test: /(^|\.)coub\.com$/i,
    sample: 'https://coub.com/view/abcdef',
    engine: 'yt-dlp (Coub)',
  },
  {
    id: 'imgur', name: 'Imgur', tier: 3, color: '#1BB76E', accent: '#5ADFA0', isNew: true,
    kinds: ['Image', 'GIF', 'Video'],
    test: /(^|\.)(imgur\.com|i\.imgur\.com)$/i,
    sample: 'https://imgur.com/abcdefg',
    engine: 'yt-dlp (Imgur)',
  },
  {
    id: 'nicovideo', name: 'Niconico', tier: 3, color: '#F5F5F5', accent: '#9E9E9E', isNew: true,
    kinds: ['Video'],
    test: /(^|\.)(nicovideo\.jp|nico\.ms)$/i,
    sample: 'https://www.nicovideo.jp/watch/sm9',
    engine: 'yt-dlp (Niconico)',
  },
];

const BY_ID = Object.fromEntries(PLATFORMS.map((p) => [p.id, p]));

/** Normalise + validate a user-supplied link. Throws a friendly AppError on junk. */
function normalizeUrl(input) {
  const { AppError } = require('./errors');
  let raw = String(input || '').trim();
  if (!raw) throw new AppError('EMPTY_URL', { status: 400, title: 'Linknya kosong 🙃', message: 'Tempel dulu link videonya di kolom di atas.' });

  // strip surrounding quotes / trailing junk from chat apps
  raw = raw.replace(/^["'`<]+|["'`>]+$/g, '');

  // Reject foreign schemes up front. Without this, "ftp://x/a" would be
  // prefixed into "https://ftp://x/a", which URL() happily parses with the
  // host "ftp" — a bogus link that only fails deep inside the engine.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) {
    throw new AppError('INVALID_URL', { status: 400, title: 'Protokol tidak didukung', message: 'VELOX hanya menerima link http/https.' });
  }

  // "lihat ini https://..." → grab the first token that looks like a URL
  if (!/^https?:\/\//i.test(raw)) {
    const found = raw.match(/https?:\/\/[^\s"'<>]+/i);
    if (found) raw = found[0];
    else raw = `https://${raw}`;
  }

  let u;
  try { u = new URL(raw); } catch {
    throw new AppError('INVALID_URL', { status: 400, title: 'Linknya tidak valid 😅', message: 'Itu bukan URL yang bisa dibaca. Pastikan formatnya seperti https://...' });
  }
  if (!/^https?:$/.test(u.protocol)) {
    throw new AppError('INVALID_URL', { status: 400, title: 'Protokol tidak didukung', message: 'VELOX hanya menerima link http/https.' });
  }
  // require a real domain (at least one dot) so "https://foo" or a bare
  // hostname never reaches the engine or the SSRF-filtered proxy
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(u.hostname)) {
    throw new AppError('INVALID_URL', {
      status: 400,
      title: 'Domainnya tidak lengkap 🤔',
      message: 'Link itu tidak punya nama domain yang valid (mis. tiktok.com).',
      hint: 'Salin ulang linknya langsung dari tombol Share di aplikasinya.',
    });
  }
  return u;
}

/** Detect which platform a URL belongs to (falls back to "generic"). */
function detect(url) {
  const u = typeof url === 'string' ? (() => { try { return new URL(url); } catch { return null; } })() : url;
  if (!u) return { id: 'generic', name: 'Website', tier: 3, kinds: ['Video', 'Audio'], color: '#8b8b9a', accent: '#8b8b9a', engine: 'yt-dlp generic' };
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  for (const p of PLATFORMS) {
    if (p.test.test(host)) return { ...p, host };
  }
  return { id: 'generic', name: host || 'Website', tier: 3, kinds: ['Video', 'Audio', 'Image'], color: '#8b8b9a', accent: '#8b8b9a', engine: 'yt-dlp generic', host };
}

const isPlaylistUrl = (u) => /[?&]list=/.test(u.href) || /\/playlist\b/.test(u.pathname) || /\/channel\b/.test(u.pathname);

module.exports = { PLATFORMS, BY_ID, normalizeUrl, detect, isPlaylistUrl };
