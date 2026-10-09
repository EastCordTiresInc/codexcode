const assert = (condition, message) => {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${message}`);
};

const { slugify, sanitizeUrl, renderSafeMarkdown } = require('../blog-render');
const { readPostInput, validatePost, publicPost } = require('../netlify/functions/lib/blog-posts');

assert(slugify('Winter Tire Guide!') === 'winter-tire-guide', 'slug from title');
assert(validatePost(readPostInput({ title: '', body: 'x' })) === 'A post title is required.', 'title required');
assert(readPostInput({ title: 'Hello', status: 'nope' }).status === 'draft', 'unknown status becomes draft');
assert(readPostInput({ title: 'Hello', status: 'published' }).status === 'published', 'published stays published');

const html = renderSafeMarkdown([
  '# Title',
  '',
  '<script>alert(1)</script>',
  '',
  '[click](javascript:alert(1))',
  '',
  '![x](data:text/html,hi)',
  '',
  '**Bold** and *italic*',
  '',
  '- one',
  '- two',
].join('\n'));

assert(!html.includes('<script'), 'script tag is escaped');
assert(!/href=["']javascript:/i.test(html), 'javascript url is not a link');
assert(!/src=["']data:/i.test(html), 'data url is not an image');
assert(html.includes('<strong>Bold</strong>'), 'bold renders');
assert(html.includes('<em>italic</em>'), 'italic renders');
assert(html.includes('<ul>'), 'list renders');
assert(sanitizeUrl('https://eastcordtires.ca/a.jpg').startsWith('https://'), 'https image allowed');
assert(sanitizeUrl('//evil.example') === '', 'protocol-relative url blocked');

const post = publicPost({
  id: '1',
  title: '<b>Hi</b>',
  slug: 'hi',
  description: 'd',
  body: '<img src=x onerror=alert(1)>',
  status: 'published',
  published_at: '2026-10-01T16:00:00.000Z',
  featured_image: 'javascript:alert(1)',
});
assert(post.featuredImage === '', 'bad featured image stripped');
assert(post.html.includes('&lt;img'), 'raw html in body is escaped');
assert(post.url === '/blog/hi/', 'public url uses slug');

async function checkServer(base) {
  const list = await fetch(`${base}/.netlify/functions/get-blog-posts`);
  const listBody = await list.json();
  assert(list.status === 200, `public list status ${list.status}`);
  assert(Array.isArray(listBody.posts), 'public list returns posts');
  assert(listBody.posts.every((item) => item.status === 'published'), 'public list is published only');
  assert(listBody.posts.every((item) => item.url.startsWith('/blog/') && item.html !== undefined), 'public posts include url and html');

  const missing = await fetch(`${base}/.netlify/functions/get-blog-posts?slug=not-a-real-eastcord-post`);
  const missingBody = await missing.json();
  assert(missing.status === 200, `missing slug status ${missing.status}`);
  assert(missingBody.post === null, 'missing slug returns no post');

  const admin = await fetch(`${base}/.netlify/functions/admin-blog-posts`);
  assert(admin.status === 401, `admin list without login is ${admin.status}`);

  const page = await fetch(`${base}/blog`);
  const pageText = await page.text();
  assert(page.status === 200, `blog page status ${page.status}`);
  assert(pageText.includes('data-blog-featured'), 'blog page has the featured slot');
  assert(pageText.includes('blog.js'), 'blog page loads the listing script');

  const article = await fetch(`${base}/blog/not-a-real-eastcord-post`);
  const articleText = await article.text();
  assert(article.status === 200, `article route status ${article.status}`);
  assert(articleText.includes('data-blog-post'), 'article route serves the post page');

  if (listBody.posts[0]?.slug) {
    const first = await fetch(`${base}/blog/${listBody.posts[0].slug}`);
    const firstText = await first.text();
    assert(first.status === 200, `first article route status ${first.status}`);
    assert(firstText.includes(`slug=${listBody.posts[0].slug}`) || firstText.includes('data-blog-post'), 'first article page is reachable');
  }

  console.log(`INFO public posts: ${listBody.posts.length}`);
  if (listBody.posts[0]) console.log(`INFO newest: ${listBody.posts[0].title} (${listBody.posts[0].slug})`);
}

checkServer(process.argv[2] || 'http://localhost:8888').catch((error) => {
  console.error('FAIL server check', error.message);
  process.exitCode = 1;
});
