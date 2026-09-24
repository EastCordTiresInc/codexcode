(() => {
  const ADMIN_EMAIL = 'info@eastcordtires.ca';
  const blog = window.EastCordBlog || {};

  const els = {
    chrome: document.querySelector('[data-admin-chrome]'),
    staffEmail: document.querySelector('[data-admin-staff-email]'),
    loading: document.querySelector('[data-admin-loading]'),
    gate: document.querySelector('[data-admin-gate]'),
    gateMessage: document.querySelector('[data-admin-gate-message]'),
    dashboard: document.querySelector('[data-admin-dashboard]'),
    status: document.querySelector('[data-admin-status]'),
    list: document.querySelector('[data-admin-blog-list]'),
    filter: document.querySelector('[data-admin-blog-filter]'),
    form: document.querySelector('[data-admin-blog-form]'),
    id: document.querySelector('[data-admin-blog-id]'),
    title: document.querySelector('[data-admin-blog-title]'),
    slug: document.querySelector('[data-admin-blog-slug]'),
    category: document.querySelector('[data-admin-blog-category]'),
    date: document.querySelector('[data-admin-blog-date]'),
    description: document.querySelector('[data-admin-blog-description]'),
    image: document.querySelector('[data-admin-blog-image]'),
    imageAlt: document.querySelector('[data-admin-blog-image-alt]'),
    body: document.querySelector('[data-admin-blog-body]'),
    preview: document.querySelector('[data-admin-blog-preview]'),
    newPost: document.querySelector('[data-admin-new-post]'),
    saveDraft: document.querySelector('[data-admin-save-draft]'),
    publish: document.querySelector('[data-admin-publish]'),
    unpublish: document.querySelector('[data-admin-unpublish]'),
    deleteBtn: document.querySelector('[data-admin-delete]'),
  };

  let posts = [];
  let slugTouched = false;
  let currentStatus = 'draft';

  function escapeHtml(value) {
    return blog.escapeHtml ? blog.escapeHtml(value) : String(value ?? '');
  }

  function showGate(message) {
    if (els.loading) els.loading.hidden = true;
    if (els.dashboard) els.dashboard.hidden = true;
    if (els.chrome) els.chrome.hidden = true;
    if (els.gate) els.gate.hidden = false;
    if (els.gateMessage && message) els.gateMessage.textContent = message;
  }

  function showDashboard(email = '') {
    if (els.loading) els.loading.hidden = true;
    if (els.gate) els.gate.hidden = true;
    if (els.dashboard) els.dashboard.hidden = false;
    if (els.chrome) els.chrome.hidden = false;
    if (els.staffEmail) els.staffEmail.textContent = email || ADMIN_EMAIL;
  }

  function setStatus(message, tone = '') {
    if (!els.status) return;
    els.status.textContent = message;
    els.status.dataset.tone = tone;
  }

  async function token() {
    return window.EastCordAccount?.getAccessToken?.();
  }

  function readForm() {
    const dateValue = els.date?.value;
    return {
      id: els.id?.value || '',
      title: els.title?.value || '',
      slug: els.slug?.value || '',
      category: els.category?.value || 'Tire Tips',
      description: els.description?.value || '',
      featured_image: els.image?.value || '',
      featured_image_alt: els.imageAlt?.value || '',
      body: els.body?.value || '',
      published_at: dateValue ? `${dateValue}T12:00:00.000-04:00` : null,
    };
  }

  function fillForm(post = null) {
    slugTouched = Boolean(post?.slug);
    currentStatus = post?.status || 'draft';
    if (els.id) els.id.value = post?.id || '';
    if (els.title) els.title.value = post?.title || '';
    if (els.slug) els.slug.value = post?.slug || '';
    if (els.category) els.category.value = post?.category || 'Tire Tips';
    if (els.description) els.description.value = post?.description || '';
    if (els.image) els.image.value = post?.featuredImage || '';
    if (els.imageAlt) els.imageAlt.value = post?.featuredImageAlt || '';
    if (els.body) els.body.value = post?.body || '';
    if (els.date) {
      const raw = post?.publishedAt || post?.createdAt || '';
      els.date.value = raw ? String(raw).slice(0, 10) : '';
    }
    if (els.unpublish) els.unpublish.hidden = currentStatus !== 'published';
    if (els.deleteBtn) els.deleteBtn.hidden = !post?.id;
    renderPreview();
    renderList();
  }

  function renderPreview() {
    if (!els.preview) return;
    const html = blog.renderSafeMarkdown ? blog.renderSafeMarkdown(els.body?.value || '') : '';
    els.preview.innerHTML = html || '<p>Start writing to see a preview.</p>';
  }

  function visiblePosts() {
    const filter = els.filter?.value || 'all';
    return posts.filter((post) => filter === 'all' || post.status === filter);
  }

  function renderList() {
    if (!els.list) return;
    const currentId = els.id?.value || '';
    const items = visiblePosts();
    if (!items.length) {
      els.list.innerHTML = '<p class="admin-empty">No posts in this list yet.</p>';
      return;
    }

    els.list.innerHTML = items.map((post) => `
      <button
        type="button"
        class="admin-blog-item${post.id === currentId ? ' is-current' : ''}"
        data-edit-post="${escapeHtml(post.id)}"
      >
        <strong>${escapeHtml(post.title)}</strong>
        <span class="admin-badge ${post.status === 'published' ? 'is-confirmed' : 'is-sample'}">${escapeHtml(post.status)}</span>
        <small>${escapeHtml(post.formattedDate || 'No date')} · /blog/${escapeHtml(post.slug)}/</small>
      </button>
    `).join('');
  }

  async function request(method, body) {
    const access = await token();
    if (!access) {
      showGate('Log in with the EastCord staff account to open the admin dashboard.');
      return null;
    }

    const response = await fetch('/.netlify/functions/admin-blog-posts', {
      method,
      headers: {
        Authorization: `Bearer ${access}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch (error) {
      payload = {};
    }

    if (response.status === 401 || response.status === 403) {
      showGate(payload.message || 'This account is not allowed to open the admin dashboard.');
      return null;
    }

    return { response, payload };
  }

  async function loadPosts(email) {
    showDashboard(email);
    setStatus('Loading blog posts...');
    const result = await request('GET');
    if (!result) return;

    if (!result.response.ok) {
      posts = [];
      renderList();
      setStatus(result.payload.message || 'Blog posts could not be loaded.', 'error');
      return;
    }

    posts = Array.isArray(result.payload.posts) ? result.payload.posts : [];
    renderList();
    setStatus(posts.length ? `${posts.length} blog post${posts.length === 1 ? '' : 's'}.` : 'No blog posts yet. Write one and publish it to the site.');
  }

  async function save(status) {
    const payload = { ...readForm(), status };
    const method = payload.id ? 'PATCH' : 'POST';
    setStatus(status === 'published' ? 'Publishing to the public blog...' : 'Saving draft...');
    const result = await request(method, payload);
    if (!result) return;

    if (!result.response.ok) {
      setStatus(result.payload.message || 'The post could not be saved.', 'error');
      return;
    }

    const saved = result.payload.post;
    if (saved) {
      const index = posts.findIndex((post) => post.id === saved.id);
      if (index >= 0) posts[index] = saved;
      else posts.unshift(saved);
      fillForm(saved);
    }
    setStatus(result.payload.message || 'Saved.');
  }

  async function removePost() {
    const id = els.id?.value;
    if (!id) return;
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    setStatus('Deleting post...');
    const result = await request('DELETE', { id });
    if (!result) return;
    if (!result.response.ok) {
      setStatus(result.payload.message || 'The post could not be deleted.', 'error');
      return;
    }
    posts = posts.filter((post) => post.id !== id);
    fillForm(null);
    setStatus(result.payload.message || 'Post deleted.');
  }

  function bind() {
    els.newPost?.addEventListener('click', () => {
      fillForm(null);
      els.title?.focus();
      setStatus('New post.');
    });
    els.filter?.addEventListener('change', renderList);
    els.title?.addEventListener('input', () => {
      if (!slugTouched && els.slug && blog.slugify) {
        els.slug.value = blog.slugify(els.title.value);
      }
    });
    els.slug?.addEventListener('input', () => {
      slugTouched = true;
    });
    els.body?.addEventListener('input', renderPreview);
    els.saveDraft?.addEventListener('click', () => save('draft'));
    els.publish?.addEventListener('click', () => save('published'));
    els.unpublish?.addEventListener('click', () => save('draft'));
    els.deleteBtn?.addEventListener('click', removePost);
    els.list?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-edit-post]');
      if (!button) return;
      const post = posts.find((item) => item.id === button.dataset.editPost);
      if (post) {
        fillForm(post);
        setStatus(`Editing “${post.title}”.`);
      }
    });
    document.querySelector('[data-logout-button]')?.addEventListener('click', async () => {
      await window.EastCordAccount?.signOut?.();
      window.location.href = '/login.html?redirect=/admin/blog';
    });
  }

  async function initialize() {
    bind();
    fillForm(null);

    if (!window.EastCordAccount?.isAuthConfigured?.()) {
      showGate('Staff login is not configured yet.');
      return;
    }

    const profile = await window.EastCordAccount.getCurrentProfile?.();
    const email = String(profile?.email || '').trim().toLowerCase();
    const isStaff = window.EastCordAccount.isStaffAdminEmail?.(email) || email === ADMIN_EMAIL;
    if (!email) {
      showGate('Log in with info@eastcordtires.ca to open the admin dashboard.');
      return;
    }
    if (!isStaff) {
      showGate('Only the EastCord staff account can open this page.');
      return;
    }

    await loadPosts(email);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
