const { requireAdminUser } = require('./lib/admin-auth');
const {
  SELECT_FIELDS,
  STATUSES,
  isMissingTableError,
  clean,
} = require('./lib/installer-applications');

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
  return 'Installer applications are not set up yet. Run supabase/installer-applications.sql in the Supabase SQL Editor.';
}

async function listApplications(supabaseAdmin) {
  const { data, error } = await supabaseAdmin
    .from('installer_applications')
    .select(SELECT_FIELDS)
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      return json(501, { message: setupMessage(), setupRequired: true, applications: [] });
    }
    console.error('[EastCord installers] Admin list failed.', error.message);
    return json(500, { message: 'Installer applications could not be loaded.' });
  }

  return json(200, { applications: data || [] });
}

async function updateApplication(supabaseAdmin, body) {
  const id = clean(body.id);
  if (!id) return json(400, { message: 'An application id is required.' });

  const fields = { updated_at: new Date().toISOString() };
  if (body.status != null) {
    const status = clean(body.status).toLowerCase();
    if (!STATUSES.includes(status)) {
      return json(400, { message: 'That application status is not valid.' });
    }
    fields.status = status;
    fields.reviewed_at = status === 'new' ? null : new Date().toISOString();
  }
  if (body.staff_note != null || body.staffNote != null) {
    fields.staff_note = clean(body.staff_note || body.staffNote);
  }

  if (Object.keys(fields).length === 1) {
    return json(400, { message: 'Nothing to update.' });
  }

  const { data, error } = await supabaseAdmin
    .from('installer_applications')
    .update(fields)
    .eq('id', id)
    .select(SELECT_FIELDS)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return json(501, { message: setupMessage(), setupRequired: true });
    }
    console.error('[EastCord installers] Update failed.', error.message);
    return json(500, { message: 'The application could not be updated.' });
  }
  if (!data) return json(404, { message: 'That application was not found.' });

  return json(200, {
    application: data,
    message: fields.status ? `Marked ${fields.status}.` : 'Staff note saved.',
  });
}

exports.handler = async (event) => {
  const auth = await requireAdminUser(event);
  if (auth.error) return json(auth.error.statusCode, { message: auth.error.message });

  if (event.httpMethod === 'GET') {
    return listApplications(auth.supabaseAdmin);
  }

  const body = parseBody(event);
  if (body === null) return json(400, { message: 'Request body must be valid JSON.' });

  if (event.httpMethod === 'PATCH' || event.httpMethod === 'POST') {
    return updateApplication(auth.supabaseAdmin, body);
  }

  return json(405, { message: 'Method not allowed.' });
};
