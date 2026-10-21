const { createClient } = require('@supabase/supabase-js');
const { PUBLIC_FIELDS, PUBLIC_FIELDS_WITHOUT_VIDEO, isMissingTableError, isMissingVideoColumn, publicPost } = require('./lib/blog-posts');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(payload),
  };
}

function getClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return null;
  return createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { message: 'Method not allowed.' });
  }

  const client = getClient();
  if (!client) {
    return json(200, { posts: [], post: null });
  }

  const slug = String(event.queryStringParameters?.slug || '').trim();
  let query = client
    .from('blog_posts')
    .select(PUBLIC_FIELDS)
    .eq('status', 'published');

  if (slug) {
    query = query.eq('slug', slug).maybeSingle();
  } else {
    query = query
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
  }

  let { data, error } = await query;
  if (isMissingVideoColumn(error)) {
    let retry = client.from('blog_posts').select(PUBLIC_FIELDS_WITHOUT_VIDEO).eq('status', 'published');
    retry = slug
      ? retry.eq('slug', slug).maybeSingle()
      : retry.order('published_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
    const fallback = await retry;
    data = fallback.data;
    error = fallback.error;
  }
  if (error) {
    if (isMissingTableError(error)) {
      return json(200, { posts: [], post: null, setupRequired: true });
    }
    console.error('[EastCord blog] Public list failed.', error.message);
    return json(500, { message: 'Blog posts could not be loaded.' });
  }

  if (slug) {
    return json(200, { post: publicPost(data), posts: data ? [publicPost(data)] : [] });
  }

  const posts = (Array.isArray(data) ? data : []).map(publicPost);
  return json(200, { posts });
};
