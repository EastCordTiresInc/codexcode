const { requireAdminUser, isAdminEmail, normalizeEmail } = require('./lib/admin-auth');
const {
  SELECT_FIELDS,
  STATUSES,
  isMissingTableError,
  clean,
} = require('./lib/installer-applications');
const {
  sendEmail,
  buildBrandedEmail,
  RESET_PASSWORD_URL,
  buildHashedTokenActionUrl,
} = require('./lib/send-email');

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

  let loginNote = '';
  if (fields.status === 'approved') {
    const login = await ensureInstallerLogin(supabaseAdmin, data);
    loginNote = login.emailed
      ? ' A login link was emailed to the installer.'
      : ' The installer login email could not be sent.';
  }

  return json(200, {
    application: data,
    message: fields.status ? `Marked ${fields.status}.${loginNote}` : 'Staff note saved.',
  });
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

async function ensureInstallerLogin(supabaseAdmin, application) {
  const email = normalizeEmail(application.email);
  if (!isValidEmail(email) || isAdminEmail(email)) return { emailed: false };

  let generated = await supabaseAdmin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: {
      redirectTo: RESET_PASSWORD_URL,
      data: { full_name: application.full_name || '', role: 'installer' },
    },
  });
  let linkType = 'invite';
  if (generated.error && /already|registered|exists/i.test(String(generated.error.message || ''))) {
    linkType = 'recovery';
    generated = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: RESET_PASSWORD_URL },
    });
  }
  if (generated.error) {
    console.error('[EastCord installers] Login link failed.', generated.error.message);
    return { emailed: false };
  }

  const userId = generated.data?.user?.id;
  if (userId) {
    const updated = await supabaseAdmin.auth.admin.updateUserById(userId, {
      app_metadata: { role: 'installer' },
    });
    if (updated.error) {
      console.error('[EastCord installers] Installer role was not saved.', updated.error.message);
    }
  }

  const actionUrl = buildHashedTokenActionUrl(
    RESET_PASSWORD_URL,
    generated.data?.properties?.hashed_token,
    linkType,
  );
  if (!actionUrl) return { emailed: false };

  const sent = await sendEmail(buildBrandedEmail({
    to: email,
    subject: 'Your EastCord installer login',
    heading: 'Your installer login is ready',
    body: [
      `${application.full_name || 'Hello'}, EastCord Tires approved your installer account.`,
      'Choose a password, then log in and open Job photos to submit the installation pictures.',
    ],
    actionUrl,
    actionLabel: 'Choose your password',
    footer: 'This login is for submitting installation photos.',
  }));
  if (!sent.ok) {
    console.error('[EastCord installers] Login email failed.', sent.providerMessage || sent.reason);
    return { emailed: false };
  }
  return { emailed: true };
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
