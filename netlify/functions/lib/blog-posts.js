const {
  slugify,
  sanitizeUrl,
  formatDate,
  renderSafeMarkdown,
} = require('./blog-render');

const PUBLIC_FIELDS = [
  'id',
  'title',
  'slug',
  'description',
  'category',
  'featured_image',
  'featured_image_alt',
  'body',
  'status',
  'published_at',
  'created_at',
  'updated_at',
].join(',');

function isMissingTableError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('blog_posts')
    && (message.includes('does not exist') || message.includes('schema cache') || message.includes('could not find'));
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function publicPost(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description || '',
    category: row.category || 'Tire Tips',
    featuredImage: sanitizeUrl(row.featured_image || ''),
    featuredImageAlt: row.featured_image_alt || row.title || 'EastCord Tires blog image',
    body: row.body || '',
    html: renderSafeMarkdown(row.body || ''),
    status: row.status,
    publishedAt: row.published_at || row.created_at,
    formattedDate: formatDate(row.published_at || row.created_at),
    url: `/blog/${row.slug}/`,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readPostInput(body = {}) {
  const title = cleanText(body.title);
  const slug = slugify(body.slug || title);
  const description = cleanText(body.description);
  const category = cleanText(body.category) || 'Tire Tips';
  const featuredImage = sanitizeUrl(body.featured_image || body.featuredImage);
  const featuredImageAlt = cleanText(body.featured_image_alt || body.featuredImageAlt);
  const postBody = String(body.body ?? '');
  const status = String(body.status || 'draft').toLowerCase() === 'published' ? 'published' : 'draft';
  const publishedAt = body.published_at || body.publishedAt || null;

  return {
    title,
    slug,
    description,
    category,
    featured_image: featuredImage || null,
    featured_image_alt: featuredImageAlt || null,
    body: postBody,
    status,
    published_at: status === 'published'
      ? (publishedAt || new Date().toISOString())
      : publishedAt,
  };
}

function validatePost(input) {
  if (!input.title) return 'A post title is required.';
  if (!input.slug) return 'A URL slug is required.';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) {
    return 'Use a lowercase slug with letters, numbers, and hyphens only.';
  }
  return '';
}

module.exports = {
  PUBLIC_FIELDS,
  isMissingTableError,
  publicPost,
  readPostInput,
  validatePost,
};
