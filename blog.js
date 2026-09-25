(() => {
  const blog = window.EastCordBlog || {};

  function escapeHtml(value) {
    return blog.escapeHtml ? blog.escapeHtml(value) : String(value ?? '');
  }

  function escapeAttribute(value) {
    return blog.escapeAttribute ? blog.escapeAttribute(value) : escapeHtml(value);
  }

  function postImage(post) {
    if (!post.featuredImage) return '';
    return `<img src="${escapeAttribute(post.featuredImage)}" alt="${escapeAttribute(post.featuredImageAlt)}" loading="lazy" />`;
  }

  function meta(post) {
    return `<p class="blog-post-meta"><span>${escapeHtml(post.category)}</span><span>${escapeHtml(post.formattedDate)}</span></p>`;
  }

  function emptyState() {
    return `
      <div class="blog-empty-state">
        <h2>Helpful tire advice is coming soon.</h2>
        <p>Check back for tire-care tips, seasonal guidance, and updates from EastCord Tires.</p>
        <div class="blog-empty-actions">
          <a class="button button-primary" href="/new-tires">Shop Tires</a>
          <a class="button button-secondary" href="/appointment">Book Appointment</a>
        </div>
      </div>
    `;
  }

  function notFoundState() {
    return `
      <div class="blog-empty-state" data-blog-not-found>
        <h2>This article was not found.</h2>
        <p>That blog post is not on the EastCord site. It may have been unpublished or the link is out of date.</p>
        <div class="blog-empty-actions">
          <a class="button button-primary" href="/blog">Back to blog</a>
          <a class="button button-secondary" href="/appointment">Book Appointment</a>
        </div>
      </div>
    `;
  }

  function renderFeatured(post) {
    const host = document.querySelector('[data-blog-featured]');
    if (!host) return;
    if (!post) {
      host.innerHTML = `<div class="shell">${emptyState()}</div>`;
      return;
    }

    host.innerHTML = `
      <div class="shell">
        <article class="blog-featured-card">
          <div>
            ${meta(post)}
            <h2 id="blog-featured-title">${escapeHtml(post.title)}</h2>
            <p>${escapeHtml(post.description)}</p>
            <a class="blog-read-link" href="${escapeAttribute(post.url)}">Read Article</a>
          </div>
          <a href="${escapeAttribute(post.url)}" aria-label="Read ${escapeAttribute(post.title)}">
            ${postImage(post)}
          </a>
        </article>
      </div>
    `;
  }

  function renderList(posts) {
    const host = document.querySelector('[data-blog-list]');
    if (!host) return;
    if (!posts.length) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }

    host.hidden = false;
    host.innerHTML = `
      <div class="shell">
        <div class="blog-section-heading">
          <h2 id="blog-list-title">More From EastCord</h2>
          <p>Helpful tire information, service notes, and seasonal reminders for busy drivers.</p>
        </div>
        <div class="blog-card-grid">
          ${posts.map((post) => `
            <article class="blog-card">
              <a href="${escapeAttribute(post.url)}" aria-label="Read ${escapeAttribute(post.title)}">
                ${postImage(post)}
              </a>
              <div class="blog-card-body">
                ${meta(post)}
                <h2>${escapeHtml(post.title)}</h2>
                <p>${escapeHtml(post.description)}</p>
                <a class="blog-read-link" href="${escapeAttribute(post.url)}">Read Article</a>
              </div>
            </article>
          `).join('')}
        </div>
      </div>
    `;
  }

  async function loadListing() {
    const featured = document.querySelector('[data-blog-featured]');
    try {
      const response = await fetch('/.netlify/functions/get-blog-posts');
      const payload = await response.json().catch(() => ({ posts: [] }));
      const posts = Array.isArray(payload.posts) ? payload.posts : [];
      renderFeatured(posts[0] || null);
      renderList(posts.slice(1));
    } catch (error) {
      if (featured) featured.innerHTML = `<div class="shell">${emptyState()}</div>`;
    }
  }

  function readSlug() {
    const params = new URLSearchParams(location.search);
    const fromQuery = String(params.get('slug') || '').trim();
    if (fromQuery) return fromQuery;
    const parts = location.pathname.replace(/\/+$/, '').split('/');
    const last = parts[parts.length - 1];
    return last && last !== 'blog' && last !== 'blog-post.html' ? last : '';
  }

  async function loadPost() {
    const article = document.querySelector('[data-blog-post]');
    if (!article) return;
    const slug = readSlug();
    if (!slug) {
      document.title = 'Article not found | EastCord Tires';
      article.innerHTML = `<div class="shell">${notFoundState()}</div>`;
      return;
    }

    try {
      const response = await fetch(`/.netlify/functions/get-blog-posts?slug=${encodeURIComponent(slug)}`);
      const payload = await response.json().catch(() => ({}));
      const post = payload.post;
      if (!post) {
        document.title = 'Article not found | EastCord Tires';
        article.innerHTML = `<div class="shell">${notFoundState()}</div>`;
        return;
      }

      document.title = `${post.title} | EastCord Tires`;
      const description = document.querySelector('meta[name="description"]');
      if (description) description.setAttribute('content', post.description || post.title);

      article.innerHTML = `
        <header class="blog-post-header">
          <div class="shell">
            ${meta(post)}
            <h1>${escapeHtml(post.title)}</h1>
            <p class="blog-post-description">${escapeHtml(post.description)}</p>
          </div>
        </header>
        <div class="blog-post-featured-image">
          <div class="shell">${postImage(post)}</div>
        </div>
        <section class="blog-post-content-section">
          <div class="shell">
            <div class="blog-post-content">${post.html || ''}</div>
            <div class="blog-post-actions">
              <a class="button button-secondary" href="/blog">Back to blog</a>
              <a class="button button-primary" href="/appointment">Book Appointment</a>
            </div>
          </div>
        </section>
      `;
    } catch (error) {
      document.title = 'Article not found | EastCord Tires';
      article.innerHTML = `<div class="shell">${notFoundState()}</div>`;
    }
  }

  if (document.querySelector('[data-blog-featured]')) loadListing();
  if (document.querySelector('[data-blog-post]')) loadPost();
})();
