(() => {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function slugify(value) {
    return String(value ?? '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  function sanitizeUrl(value) {
    const url = String(value ?? '').trim();
    if (!url) return '';
    if (/^(https?:|mailto:|tel:|\/(?!\/)|#)/i.test(url)) return url;
    return '';
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/Toronto',
    }).format(date);
  }

  function renderBasicInline(value) {
    let html = escapeHtml(value);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return html;
  }

  function renderInline(value) {
    const raw = String(value ?? '');
    const tokenPattern = /(!?)\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;
    let html = '';
    let lastIndex = 0;
    let match;

    while ((match = tokenPattern.exec(raw)) !== null) {
      html += renderBasicInline(raw.slice(lastIndex, match.index));
      const isImage = match[1] === '!';
      const label = match[2];
      const url = sanitizeUrl(match[3]);
      const title = match[4] ? ` title="${escapeAttribute(match[4])}"` : '';

      if (!url) {
        html += renderBasicInline(match[0]);
      } else if (isImage) {
        html += `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(label)}"${title} loading="lazy" />`;
      } else {
        html += `<a href="${escapeAttribute(url)}"${title}>${renderBasicInline(label)}</a>`;
      }

      lastIndex = tokenPattern.lastIndex;
    }

    html += renderBasicInline(raw.slice(lastIndex));
    return html;
  }

  function renderList(lines, ordered) {
    const tag = ordered ? 'ol' : 'ul';
    const items = lines.map((line) => {
      const text = ordered ? line.replace(/^\d+\.\s+/, '') : line.replace(/^[-*]\s+/, '');
      return `<li>${renderInline(text)}</li>`;
    });
    return `<${tag}>\n${items.join('\n')}\n</${tag}>`;
  }

  function renderSafeMarkdown(markdown) {
    const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();

      if (!trimmed) {
        index += 1;
        continue;
      }

      if (/^#{1,4}\s+/.test(trimmed)) {
        const markerLength = (trimmed.match(/^#+/) || ['##'])[0].length;
        const depth = Math.min(Math.max(markerLength, 2), 4);
        const text = trimmed.replace(/^#{1,4}\s+/, '');
        blocks.push(`<h${depth}>${renderInline(text)}</h${depth}>`);
        index += 1;
        continue;
      }

      if (/^[-*]\s+/.test(trimmed)) {
        const items = [];
        while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
          items.push(lines[index].trim());
          index += 1;
        }
        blocks.push(renderList(items, false));
        continue;
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        const items = [];
        while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
          items.push(lines[index].trim());
          index += 1;
        }
        blocks.push(renderList(items, true));
        continue;
      }

      if (/^>\s?/.test(trimmed)) {
        const quotes = [];
        while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
          quotes.push(lines[index].trim().replace(/^>\s?/, ''));
          index += 1;
        }
        blocks.push(`<blockquote>${quotes.map(renderInline).join('<br />')}</blockquote>`);
        continue;
      }

      const paragraph = [];
      while (
        index < lines.length
        && lines[index].trim()
        && !/^#{1,4}\s+/.test(lines[index].trim())
        && !/^[-*]\s+/.test(lines[index].trim())
        && !/^\d+\.\s+/.test(lines[index].trim())
        && !/^>\s?/.test(lines[index].trim())
      ) {
        paragraph.push(lines[index].trim());
        index += 1;
      }
      blocks.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    }

    return blocks.join('\n\n');
  }

  const api = {
    escapeHtml,
    escapeAttribute,
    slugify,
    sanitizeUrl,
    formatDate,
    renderSafeMarkdown,
  };

  if (typeof window !== 'undefined') window.EastCordBlog = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
