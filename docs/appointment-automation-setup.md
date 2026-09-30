# Appointment Automation Setup

This side-branch setup uses Supabase Auth plus Supabase database tables as the main customer and booking backend. Netlify Forms remains as a backup capture only.

## Netlify environment variables

Add these variables in Netlify for the appointment automation deploy context:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_public_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
STRIPE_SECRET_KEY=sk_test_or_live_key
STRIPE_WEBHOOK_SECRET=whsec_test_or_live_secret
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_or_live_key
EMAIL_PROVIDER=postmark
EMAIL_FROM=EastCord Tires <info@eastcordtires.ca>
EMAIL_REPLY_TO=info@eastcordtires.ca
EMAIL_TO_EASTCORD=info@eastcordtires.ca
POSTMARK_SERVER_TOKEN=your_postmark_server_token
POSTMARK_MESSAGE_STREAM=outbound
```

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are written into `auth-config.js` during the Netlify build so the browser can connect to Supabase Auth.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are used by the Netlify checkout and webhook functions to verify the logged-in customer, read appointment bookings, and update payment or email notification fields.

`STRIPE_SECRET_KEY` is used by `netlify/functions/create-appointment-checkout-session.js` and `netlify/functions/stripe-webhook.js`.

`STRIPE_WEBHOOK_SECRET` is used by `netlify/functions/stripe-webhook.js` to verify Stripe webhook signatures.

`VITE_STRIPE_PUBLISHABLE_KEY` is reserved for future Stripe client-side UI. The current flow redirects to Stripe Checkout through the Netlify function and does not collect card details manually.

`POSTMARK_SERVER_TOKEN` is used to send customer and staff emails after payment, signup, password reset, and order updates. The sender in `EMAIL_FROM` must be a verified Postmark Sender Signature or domain. Use the Transactional message stream (`outbound` unless you created a named stream). Keep Resend as a rollback by setting `EMAIL_PROVIDER=resend` and `RESEND_API_KEY` if needed.

Postmark live switch (do this in Postmark and Netlify, not in git):

1. Create a Postmark Server and copy its Server API token into `POSTMARK_SERVER_TOKEN`.
2. Add and verify the domain `eastcordtires.ca` (DKIM + Return-Path DNS records from Postmark).
3. Confirm a Sender Signature for `info@eastcordtires.ca` that matches `EMAIL_FROM`.
4. Set `EMAIL_PROVIDER=postmark` in Netlify (and in `.netlify/.env` for local). Redeploy after changing production env vars.
5. Send one staff test with `node scripts/send-staff-email-tests.js` only after the token and domain are verified. Do not paste tokens into chat.

## Supabase setup

Run this SQL in Supabase SQL Editor:

```sql
-- See supabase/appointment-automation-schema.sql in this branch.
```

Tables used:

- `public.customer_profiles`
- `public.customer_carts`
- `public.appointment_bookings`

If the bookings table already exists from an earlier run, re-run `supabase/appointment-automation-schema.sql` so these newer columns are added:

```sql
alter table public.appointment_bookings
  add column if not exists service_subtotal numeric(10,2),
  add column if not exists hst_amount numeric(10,2),
  add column if not exists total_with_hst numeric(10,2),
  add column if not exists tax_rate numeric(6,4),
  add column if not exists vehicle_plate_number text,
  add column if not exists vehicle_colour text;
```

For stronger duplicate-email protection on Stripe webhook retries, also run:

```sql
alter table public.appointment_bookings
  add column if not exists customer_confirmation_sent_at timestamptz,
  add column if not exists eastcord_notification_sent_at timestamptz;
```

The webhook checks these fields before sending emails. If the columns are not present, the webhook still confirms paid bookings and uses current booking status to avoid duplicate emails on normal retries, but the columns are recommended.

Enable Supabase Email Auth. For preview testing, either disable email confirmation or make sure confirmation redirect URLs include:

```text
https://deploy-preview-48--updatedeastcord.netlify.app/login
https://deploy-preview-48--updatedeastcord.netlify.app/account
https://deploy-preview-48--updatedeastcord.netlify.app/cart
https://deploy-preview-48--updatedeastcord.netlify.app/appointment.html
```

Future production URLs:

```text
https://eastcordtires.ca/login
https://eastcordtires.ca/account
https://eastcordtires.ca/cart
https://eastcordtires.ca/appointment.html
```

## Stripe setup

Use Stripe Checkout only. Do not collect card information manually on the website.

Checkout function:

```text
netlify/functions/create-appointment-checkout-session.js
```

Endpoint:

```text
/.netlify/functions/create-appointment-checkout-session
```

Success page:

```text
/appointment-success?session_id={CHECKOUT_SESSION_ID}
```

Cancel page:

```text
/appointment-cancelled
```

Webhook function:

```text
netlify/functions/stripe-webhook.js
```

Webhook endpoint:

```text
https://deploy-preview-48--updatedeastcord.netlify.app/.netlify/functions/stripe-webhook
```

Listen for this Stripe event:

```text
checkout.session.completed
```

After Stripe confirms payment, the webhook updates all Supabase booking rows listed in the Stripe session metadata:

```text
payment_status = paid_deposit
booking_status = Confirmed
stripe_session_id = checkout session id
```

## Email notifications

After the webhook successfully updates the booking rows to confirmed, it sends:

- One customer confirmation email listing all appointments in the checkout.
- One internal EastCord notification email listing all appointments in the checkout.

If email sending fails after booking confirmation succeeds, the webhook logs the email error but still returns success to Stripe so Stripe does not retry a completed payment only because email delivery failed.

If the Supabase booking update fails, the webhook returns an error and does not send confirmation emails.