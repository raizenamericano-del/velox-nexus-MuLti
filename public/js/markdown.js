/* ==========================================================================
   VELOX NEXUS — tiny markdown renderer
   Escapes first, then formats. No raw HTML ever reaches the DOM, because the
   input comes from other people's README files.
   ========================================================================== */
'use strict';

(() => {
  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const inline = (text) => text
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, label, href) => {
      const safe = /^(https?:|mailto:|#|\/)/i.test(href) ? href : null;
      if (!safe) return label;
      const external = /^https?:/i.test(safe);
      return `<a href="${safe}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
    })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');

  function render(markdown, { maxLength = 24_000 } = {}) {
    let src = String(markdown || '').slice(0, maxLength).replace(/\r\n?/g, '\n');
    src = escape(src);

    const blocks = [];
    src = src.replace(/```([a-z0-9+#-]*)\n([\s\S]*?)```/gi, (m, lang, code) => {
      blocks.push(`<pre class="md-code"><code>${code.replace(/\n$/, '')}</code></pre>`);
      return `\u0000B${blocks.length - 1}\u0000`;
    });

    const out = [];
    let listType = null;
    let inQuote = false;

    const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
    const closeQuote = () => { if (inQuote) { out.push('</blockquote>'); inQuote = false; } };

    for (const rawLine of src.split('\n')) {
      const line = rawLine.trimEnd();

      if (/^\u0000B\d+\u0000$/.test(line.trim())) { closeList(); closeQuote(); out.push(line.trim()); continue; }
      if (!line.trim()) { closeList(); closeQuote(); continue; }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        closeList(); closeQuote();
        const level = Math.min(4, heading[1].length + 1); // h1 → h2: the drawer already has an h2
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        continue;
      }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { closeList(); closeQuote(); out.push('<hr>'); continue; }

      if (/^>\s?/.test(line)) {
        closeList();
        if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
        out.push(`<p>${inline(line.replace(/^>\s?/, ''))}</p>`);
        continue;
      }
      closeQuote();

      const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (bullet || ordered) {
        const wantType = bullet ? 'ul' : 'ol';
        if (listType !== wantType) { closeList(); out.push(`<${wantType}>`); listType = wantType; }
        out.push(`<li>${inline((bullet || ordered)[1])}</li>`);
        continue;
      }
      closeList();

      if (/^\s*\|.*\|\s*$/.test(line)) { out.push(`<p class="md-row">${inline(line.trim())}</p>`); continue; }
      out.push(`<p>${inline(line)}</p>`);
    }
    closeList(); closeQuote();

    return out.join('\n').replace(/\u0000B(\d+)\u0000/g, (m, i) => blocks[Number(i)] || '');
  }

  window.MiniMarkdown = { render };
})();
