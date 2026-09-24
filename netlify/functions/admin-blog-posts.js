const { requireAdminUser } = require('./lib/admin-auth');
const {
  PUBLIC_FIELDS,
  isMissingTableError,
  publicPost,
  readPostInput,
  validatePost,
} = require('./lib/blog-posts');

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

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch (error) {
    return null;
  }
}

function setupMessage() {
  return 'Blog storage is not set up yet. Run supabase/blog-posts.sql in the Supabase SQL Editor.';
}

async function listPosts(supabaseAdmin) {
  const { data, error } = await supabaseAdmin
    .from('blog_posts')
    .select(PUBLIC_FIELDS)
    .order('updated_at', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      return json(501, { message: setupMessage(), setupRequired: true, posts: [] });
    }
    console.error('[EastCord blog] Admin list failed.', error.message);
    return json(500, { message: 'Blog posts could not be loaded.' });
  }

  return json(200, { posts: (data || []).map(publicPost) });
}

async function createPost(supabaseAdmin, body) {
  const input = readPostInput(body);
  const invalid = validatePost(input);
  if (invalid) return json(400, { message: invalid });

  const { data, error } = await supabaseAdmin
    .from('blog_posts')
    .insert({
      ...input,
      updated_at: new Date().toISOString(),
    })
    .select(PUBLIC_FIELDS)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return json(501, { message: setupMessage(), setupRequired: true });
    }
    if (String(error.message || '').toLowerCase().includes('duplicate')) {
      return json(409, { message: 'That URL slug is already used by another post.' });
    }
    console.error('[EastCord blog] Create failed.', error.message);
    return json(500, { message: 'The blog post could not be saved.' });
  }

  return json(200, {
    post: publicPost(data),
    message: input.status === 'published' ? 'Published to the public blog.' : 'Draft saved.',
  });
}

async function updatePost(supabaseAdmin, body) {
  const id = String(body.id || '').trim();
  if (!id) return json(400, { message: 'A post id is required.' });

  const input = readPostInput(body);
  const invalid = validatePost(input);
  if (invalid) return json(400, { message: invalid });

  const { data, error } = await supabaseAdmin
    .from('blog_posts')
    .update({
      ...input,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select(PUBLIC_FIELDS)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return json(501, { message: setupMessage(), setupRequired: true });
    }
    if (String(error.message || '').toLowerCase().includes('duplicate')) {
      return json(409, { message: 'That URL slug is already used by another post.' });
    }
    console.error('[EastCord blog] Update failed.', error.message);
    return json(500, { message: 'The blog post could not be updated.' });
  }
  if (!data) return json(404, { message: 'That blog post was not found.' });

  return json(200, {
    post: publicPost(data),
    message: input.status === 'published' ? 'Published to the public blog.' : 'Draft saved.',
  });
}

async function deletePost(supabaseAdmin, body) {
  const id = String(body.id || '').trim();
  if (!id) return json(400, { message: 'A post id is required.' });

  const { error } = await supabaseAdmin
    .from('blog_posts')
    .delete()
    .eq('id', id);

  if (error) {
    if (isMissingTableError(error)) {
      return json(501, { message: setupMessage(), setupRequired: true });
    }
    console.error('[EastCord blog] Delete failed.', error.message);
    return json(500, { message: 'The blog post could not be deleted.' });
  }

  return json(200, { ok: true, message: 'Post deleted.' });
}

exports.handler = async (event) => {
  const auth = await requireAdminUser(event);
  if (auth.error) return json(auth.error.statusCode, { message: auth.error.message });

  if (event.httpMethod === 'GET') {
    return listPosts(auth.supabaseAdmin);
  }

  const body = parseBody(event);
  if (body === null) return json(400, { message: 'Request body must be valid JSON.' });

  if (event.httpMethod === 'POST') {
    return createPost(auth.supabaseAdmin, body);
  }
  if (event.httpMethod === 'PATCH') {
    return updatePost(auth.supabaseAdmin, body);
  }
  if (event.httpMethod === 'DELETE') {
    return deletePost(auth.supabaseAdmin, body);
  }

  return json(405, { message: 'Method not allowed.' });
};
