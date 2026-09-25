const { getSupabaseAdmin } = require('./lib/admin-auth');
const { sendEmail, getEmailConfig, CONTACT_EMAIL, htmlFromText } = require('./lib/send-email');
const {
  SELECT_FIELDS,
  isMissingTableError,
  clean,
  readApplicationInput,
  validateApplication,
  applicationRecord,
  applicationText,
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
  const raw = event.body || '';
  if (!raw) return {};
  const contentType = String(event.headers['content-type'] || event.headers['Content-Type'] || '');
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw);
    const body = {};
    params.forEach((value, key) => {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        body[key] = [].concat(body[key], value);
      } else {
        body[key] = value;
      }
    });
    return body;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { message: 'Method not allowed.' });
  }

  const body = parseBody(event);
  if (body === null) {
    return json(400, { message: 'Request body must be valid JSON.' });
  }

  if (clean(body['bot-field'] || body.botField || body.bot_field)) {
    return json(200, { ok: true, ignored: true });
  }

  const input = readApplicationInput(body);
  const invalid = validateApplication(input);
  if (invalid) return json(400, { message: invalid });

  const record = applicationRecord(input);
  const supabaseAdmin = getSupabaseAdmin();
  let saved = null;
  let setupRequired = false;

  if (supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('installer_applications')
      .insert(record)
      .select(SELECT_FIELDS)
      .maybeSingle();

    if (error) {
      if (isMissingTableError(error)) {
        setupRequired = true;
      } else {
        console.error('[EastCord installers] Save failed.', error.message);
        return json(500, { message: 'The application could not be saved. Please try again or email info@eastcordtires.ca.' });
      }
    } else {
      saved = data;
    }
  } else {
    setupRequired = true;
  }

  const config = getEmailConfig();
  const emailed = await sendEmail({
    to: config.eastcordTo || CONTACT_EMAIL,
    replyTo: input.email || CONTACT_EMAIL,
    subject: `New installer application — ${input.full_name}`,
    text: applicationText(input),
    html: htmlFromText(applicationText(input)),
  });

  if (!saved && !emailed.ok) {
    return json(502, {
      message: 'The application could not be sent right now. Please email info@eastcordtires.ca.',
      setupRequired,
    });
  }

  return json(200, {
    ok: true,
    saved: Boolean(saved),
    emailed: Boolean(emailed.ok),
    setupRequired,
    id: saved?.id || '',
    message: 'Application received.',
  });
};
