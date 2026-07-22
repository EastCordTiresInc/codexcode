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
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_or_live_key
```

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are written into `auth-config.js` during the Netlify build so the browser can connect to Supabase Auth.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are used by the Netlify checkout function to verify the logged-in customer and update the saved Supabase booking row with the Stripe Checkout session ID.

`STRIPE_SECRET_KEY` is used by `netlify/functions/create-appointment-checkout-session.js`.

`VITE_STRIPE_PUBLISHABLE_KEY` is reserved for future Stripe client-side UI. The current flow redirects to Stripe Checkout through the Netlify function and does not collect card details manually.

## Supabase setup

Run this SQL in Supabase SQL Editor:

```sql
-- See supabase/appointment-automation-schema.sql in this branch.
```

Tables used:

- `public.customer_profiles`
- `public.appointment_bookings`

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

## Stripe webhook TODO

A Stripe webhook is still needed to update:

```text
public.appointment_bookings.payment_status = paid_deposit
```

after `checkout.session.completed`.

Until the webhook is added, the booking row is saved before checkout and the Stripe session ID is stored, but automatic post-payment status update is still a TODO.
