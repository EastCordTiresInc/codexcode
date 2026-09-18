const fs = require('fs');
const path = require('path');

const root = process.cwd();
const contentDir = path.join(root, 'content', 'blog');
const outputDir = path.join(root, 'blog');
const sourceFooterPath = path.join(root, 'proudly-canadian', 'index.html');

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

function stripWrappingQuotes(value) {
  const trimmed = String(value ?? '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontMatter(fileContent) {
  const normalized = fileContent.replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---')) {
    return { data: {}, body: normalized };
  }

  const closingMarker = normalized.indexOf('\n---', 3);
  if (closingMarker === -1) {
    return { data: {}, body: normalized };
  }

  const rawMatter = normalized.slice(3, closingMarker).trim();
  const body = normalized.slice(closingMarker).replace(/^\n---\r?\n?/, '');
  const data = {};

  rawMatter.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) return;
    const key = match[1];
    const rawValue = stripWrappingQuotes(match[2]);
    if (/^(true|false)$/i.test(rawValue)) {
      data[key] = rawValue.toLowerCase() === 'true';
      return;
    }
    data[key] = rawValue;
  });

  return { data, body };
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

function readFooter() {
  const page = fs.readFileSync(sourceFooterPath, 'utf8');
  const footerMatch = page.match(/<footer class="site-footer">[\s\S]*?<\/footer>/);
  if (!footerMatch) throw new Error('Unable to find source footer markup.');
  return footerMatch[0];
}

function siteHeader(active = 'blog') {
  const current = (key) => (key === active ? ' aria-current="page"' : '');
  return `    <header class="site-header">
      <div class="nav-shell">
        <a class="brand brand-logo" href="/" aria-label="EastCord Tires home">
          <img src="/assets/eastcord-logo-red-black.svg" alt="EastCord Tires" />
        </a>
        <button
          class="menu-toggle"
          type="button"
          aria-expanded="false"
          aria-controls="primary-navigation"
          aria-label="Open navigation menu"
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
        <nav class="main-nav" id="primary-navigation" aria-label="Main navigation">
          <a href="/"${current('home')}>Home</a>
          <div class="nav-dropdown">
            <button class="nav-dropdown-toggle" type="button" aria-expanded="false" aria-haspopup="true">Tires</button>
            <div class="nav-dropdown-menu">
              <a href="/used-tires">Used Tires</a>
              <a href="/new-tires">New Tires</a>
            </div>
          </div>
          <a href="/appointment">Appointment</a>
          <a href="/local-installers">Installers</a>
          <a href="/proudly-canadian">Proudly Canadian</a>
          <a href="/blog"${current('blog')}>Blog</a>
          <a href="/#contact">Contact</a>
          <span class="nav-carts" aria-label="Shopping carts">
            <a href="/cart">Appointment Cart</a>
          </span>
          <span class="auth-nav-group" data-auth-logged-out>
            <a href="/signup">Sign Up</a>
            <a href="/login">Log In</a>
          </span>
          <span class="auth-nav-group" data-auth-logged-in hidden>
            <div class="nav-dropdown nav-account-dropdown">
              <button class="nav-dropdown-toggle" type="button" aria-expanded="false" aria-haspopup="true">My Account</button>
              <div class="nav-dropdown-menu">
                <small class="nav-account-email" data-account-email hidden></small>
                <a href="/account">View Account</a>
                <button class="auth-link-button" type="button" data-logout-button>Log Out</button>
              </div>
            </div>
          </span>
        </nav>
      </div>
    </header>`;
}

function pageShell({ title, description, bodyClass, main }) {
  const footer = readFooter();
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeAttribute(description)}" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/styles.css?v=8" />
    <link rel="stylesheet" href="/footer-section.css?v=5" />
    <link rel="stylesheet" href="/heading-balance.css" />
    <link rel="stylesheet" href="/auth.css" />
    <link rel="stylesheet" href="/blog.css?v=1" />
  </head>
  <body class="${escapeAttribute(bodyClass)}">
    <a class="skip-link" href="#main-content">Skip to main content</a>
${siteHeader('blog')}
    <main id="main-content">
${main}
    </main>

${footer}
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script src="/auth-config.js?v=3"></script>
    <script src="/account.js?v=58"></script>
    <script src="/mobile-menu.js?v=2" defer></script>
  </body>
</html>
`;
}

function readPosts() {
  if (!fs.existsSync(contentDir)) return [];

  return fs.readdirSync(contentDir)
    .filter((file) => /\.md$/i.test(file))
    .map((file) => {
      const filePath = path.join(contentDir, file);
      const { data, body } = parseFrontMatter(fs.readFileSync(filePath, 'utf8'));
      const title = String(data.title || '').trim();
      const slug = slugify(data.slug || title || path.basename(file, path.extname(file)));
      const date = data.date || '';
      const status = String(data.status || '').toLowerCase();
      const draft = data.draft === true || status !== 'published';

      return {
        title,
        slug,
        date,
        dateValue: new Date(date).getTime() || 0,
        formattedDate: formatDate(date),
        description: String(data.description || '').trim(),
        featuredImage: sanitizeUrl(data.featured_image || ''),
        featuredImageAlt: String(data.featured_image_alt || title || 'EastCord Tires blog image').trim(),
        category: String(data.category || 'Tire Tips').trim(),
        draft,
        status,
        html: renderSafeMarkdown(body),
        source: file,
      };
    })
    .filter((post) => post.title && post.slug && !post.draft)
    .sort((a, b) => b.dateValue - a.dateValue || a.title.localeCompare(b.title));
}

function postUrl(post) {
  return `/blog/${post.slug}/`;
}

function postImage(post, className = '') {
  if (!post.featuredImage) return '';
  const classAttribute = className ? ` class="${className}"` : '';
  return `<img${classAttribute} src="${escapeAttribute(post.featuredImage)}" alt="${escapeAttribute(post.featuredImageAlt)}" loading="lazy" />`;
}

function meta(post) {
  return `<p class="blog-post-meta"><span>${escapeHtml(post.category)}</span><span>${escapeHtml(post.formattedDate)}</span></p>`;
}

function renderFeatured(post) {
  if (!post) {
    return `<section class="blog-featured" aria-label="Latest blog article">
        <div class="shell">
          <div class="blog-empty-state">
            <h2>Helpful tire advice is coming soon.</h2>
            <p>Check back for tire-care tips, seasonal guidance, and updates from EastCord Tires.</p>
            <div class="blog-empty-actions">
              <a class="button button-primary" href="/new-tires">Shop Tires</a>
              <a class="button button-secondary" href="/appointment">Book Appointment</a>
            </div>
          </div>
        </div>
      </section>`;
  }

  return `<section class="blog-featured" aria-labelledby="blog-featured-title">
        <div class="shell">
          <article class="blog-featured-card">
            <div>
              ${meta(post)}
              <h2 id="blog-featured-title">${escapeHtml(post.title)}</h2>
              <p>${escapeHtml(post.description)}</p>
              <a class="blog-read-link" href="${postUrl(post)}">Read Article</a>
            </div>
            <a href="${postUrl(post)}" aria-label="Read ${escapeAttribute(post.title)}">
              ${postImage(post)}
            </a>
          </article>
        </div>
      </section>`;
}

function renderPostCard(post) {
  return `<article class="blog-card">
            <a href="${postUrl(post)}" aria-label="Read ${escapeAttribute(post.title)}">
              ${postImage(post)}
            </a>
            <div class="blog-card-body">
              ${meta(post)}
              <h2>${escapeHtml(post.title)}</h2>
              <p>${escapeHtml(post.description)}</p>
              <a class="blog-read-link" href="${postUrl(post)}">Read Article</a>
            </div>
          </article>`;
}

function renderListing(posts) {
  const [featured, ...remaining] = posts;
  const cards = remaining.length
    ? `<section class="blog-list-section" aria-labelledby="blog-list-title">
        <div class="shell">
          <div class="blog-section-heading">
            <h2 id="blog-list-title">More From EastCord</h2>
            <p>Helpful tire information, service notes, and seasonal reminders for busy drivers.</p>
          </div>
          <div class="blog-card-grid">
            ${remaining.map(renderPostCard).join('\n')}
          </div>
        </div>
      </section>`
    : '';

  const cta = posts.length
    ? `<section class="blog-cta-section" aria-labelledby="blog-cta-title">
        <div class="shell">
          <div class="blog-cta-panel">
            <div>
              <h2 id="blog-cta-title">Need Tires or Service?</h2>
              <p>Shop available tires or book a convenient appointment with EastCord Tires.</p>
            </div>
            <div class="blog-cta-actions">
              <a class="button button-primary" href="/new-tires">Shop Tires</a>
              <a class="button button-secondary" href="/appointment">Book Appointment</a>
            </div>
          </div>
        </div>
      </section>`
    : '';

  const sections = [
    `<section class="blog-hero" aria-labelledby="blog-page-title">
        <div class="shell">
          <h1 id="blog-page-title">EastCord Tires Blog</h1>
          <p>Practical tire advice, service updates, and seasonal guidance from the EastCord Tires team.</p>
        </div>
      </section>`,
    renderFeatured(featured),
    cards,
    cta,
  ].filter(Boolean);

  const main = sections.map((section) => `      ${section}`).join('\n');

  return pageShell({
    title: 'Blog | EastCord Tires',
    description: 'EastCord Tires blog with tire tips, service updates, and seasonal tire advice.',
    bodyClass: 'blog-page',
    main,
  });
}

function renderPost(post) {
  const main = `      <article>
        <header class="blog-post-header">
          <div class="shell">
            ${meta(post)}
            <h1>${escapeHtml(post.title)}</h1>
            <p class="blog-post-description">${escapeHtml(post.description)}</p>
          </div>
        </header>
        <div class="blog-post-featured-image">
          <div class="shell">
            ${postImage(post)}
          </div>
        </div>
        <section class="blog-post-content-section">
          <div class="shell">
            <div class="blog-post-content">
              ${post.html}
              <div class="blog-post-actions">
                <a class="button button-secondary" href="/blog">Back to Blog</a>
                <a class="button button-primary" href="/appointment">Book Appointment</a>
              </div>
            </div>
          </div>
        </section>
      </article>`;

  return pageShell({
    title: `${post.title} | EastCord Tires`,
    description: post.description,
    bodyClass: 'blog-post-page',
    main,
  });
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function main() {
  const posts = readPosts();

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  writeFile(path.join(outputDir, 'index.html'), renderListing(posts));

  posts.forEach((post) => {
    writeFile(path.join(outputDir, post.slug, 'index.html'), renderPost(post));
  });

  console.log(`Generated ${posts.length} published blog post${posts.length === 1 ? '' : 's'}.`);
}

main();
