# EastCord Tires — Website Improvement Meeting Guide

**Purpose:** Talking points and priorities for getting alignment on what to improve next on [eastcordtires.ca](https://eastcordtires.ca).

**Repo:** `EastCordTiresInc/codexcode` (static HTML/CSS/JS, Netlify, Supabase, Stripe)

**Last updated:** August 10, 2026

---

## How to open the meeting (30 seconds)

> "The site has a strong foundation — marketing homepage, appointment booking, Supabase accounts, Stripe deposits, and Netlify hosting. The biggest gaps are **unfinished shopping flows**, **content consistency**, and **connecting the backend pieces** so customers can actually buy/book end-to-end."

---

## Current site structure (quick reference)

| Layer | Technology |
|-------|------------|
| Frontend | Static HTML, CSS, vanilla JavaScript |
| Hosting | Netlify (CDN, redirects, forms, serverless functions) |
| Auth & database | Supabase (`customer_profiles`, `appointment_bookings`) |
| Payments | Stripe Checkout (20% appointment deposit) |
| New tires | TireConnect widget (third-party) |
| Chat / inquiries | Netlify Forms (`eastcord-inquiry`) |

**Main user flows today:**
- Browse homepage → contact / chat / guides
- Book appointment → cart → login → Stripe deposit
- Search new tires → TireConnect widget (partially finalized)

---

## Priority 1 — Finish what's half-built (highest business impact)

### 1. Used tire inventory

**Problem**
- Code expects `assets/inventory.json`, but inventory is not live on the site.
- Chat widget and footer link to `#inventory`, which does not exist as a real section on the homepage.
- `auth.js` still references a legacy Netlify Identity + cart flow for tire purchases.

**Discuss in meeting**
- Where does inventory live today? (spreadsheet, shop software, manual list?)
- Do we want **search by size/brand**, **call for price**, or **online cart + checkout**?
- Who updates stock when a tire sells?

**Decision to get**
- A process + data source for inventory (even a simple Google Sheet → JSON export to start).

---

### 2. New tire shopping (TireConnect)

**Problem**
- `new-tires.html` displays: *"New tire shopping is being finalized."*
- TireConnect widget depends on API keys generated at build time (`tireconnect-config.js`).

**Discuss in meeting**
- Is the TireConnect account active and paid?
- After a customer finds tires online, what's the next step — call, appointment, or checkout?
- Do we install on-site or only sell tires?

**Decision to get**
- Confirm TireConnect is production-ready and define the customer path after search.

---

### 3. Appointment + checkout pipeline

**Problem**
- Appointment flow is the most complete feature (wizard → cart → Supabase → Stripe deposit).
- Requires all environment variables configured in Netlify (see `docs/appointment-automation-setup.md`).

**Discuss in meeting**
- Are Stripe, Supabase, and email (Resend) already set up in production?
- Is the **20% deposit** pricing final?
- Who gets notified when someone books? (email, dashboard, SMS?)
- Service area in code is **Milton, Oakville, Brampton, Mississauga** — is that correct?

**Required Netlify env vars (summary)**
```env
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
VITE_STRIPE_PUBLISHABLE_KEY
RESEND_API_KEY
EMAIL_FROM
EMAIL_REPLY_TO
EMAIL_TO_EASTCORD
```

**Decision to get**
- Confirm production credentials exist and run one real booking test end-to-end.

---

## Priority 2 — Fix confusion before adding features

### 4. Location & branding consistency

**Problem — mixed messaging across the site**
| Source | Location mentioned |
|--------|-------------------|
| Homepage meta / title | Brantford, Ontario |
| README (older) | Milton, Ontario |
| Appointment service area (code) | Milton, Oakville, Brampton, Mississauga |

**Discuss in meeting**
- What is the official service area and business address?
- Which city should be the primary SEO target?

**Decision to get**
- One source of truth for location, phone, hours, and service radius.

---

### 5. Broken or placeholder navigation

**Problem**
- Footer links to `/#inventory` (no inventory section on homepage).
- Homepage uses `#appointment` anchor; booking lives on `/appointment`.
- Some guide pages exist; dedicated used/new tire pages may be thin or missing.

**Discuss in meeting**
- What pages must exist at launch vs. can stay "coming soon"?

**Decision to get**
- An agreed sitemap (see suggested sitemap below).

---

### 6. Dual auth systems (technical debt)

**Problem — two auth stacks coexist**

| System | Used for |
|--------|----------|
| **Supabase** (`account.js`, `auth-config.js`) | Login, signup, account, appointment cart, checkout |
| **Netlify Identity** (`auth.js` on homepage) | Legacy tire inventory cart / checkout |

**Discuss in meeting**
- Are used tire online sales still planned?
- If yes, which login system do we standardize on?

**Decision to get**
- Pick **one** auth path (likely Supabase) and retire the other.

---

## Priority 3 — Make the site convert better

### 7. Clear calls to action on homepage

**Problem**
- Service cards on homepage anchor to sections (e.g. `#tire-brands`) instead of driving to booking or inventory.

**Discuss in meeting**
- Primary goal: **book appointments**, **sell used tires**, or **generate phone calls**?
- Should "Buy Used Tires" go to inventory, contact, or phone?

**Decision to get**
- One primary CTA per customer type (used / new / service).

---

### 8. Trust & conversion content

**Already on site**
- Inspection video (YouTube)
- Warranty PDF
- Tire size calculator
- Shopping / season guides
- Chat widget

**Could add**
- Customer reviews / Google reviews embed
- Before/after inspection photos
- "How booking works" in 3 steps
- Pricing transparency (starting prices, deposit explained)
- FAQ page (seasonal timing, on-rim vs off-rim, etc.)

**Discuss in meeting**
- What do customers ask most on the phone? Put those answers on the site.

---

### 9. Chat widget → lead capture

**Problem**
- Chat works and submits inquiries via Netlify Forms, but is mostly FAQ-driven.
- Not connected to inventory availability or live booking status.

**Discuss in meeting**
- Should chat hand off to booking or phone/text?
- Who monitors form submissions and how fast do they respond?

**Decision to get**
- Owner/responder assigned; target response time (e.g. same business day).

---

## Priority 4 — SEO & marketing

| Item | Why it matters |
|------|----------------|
| Google Business Profile synced with site NAP (name, address, phone) | Local search rankings |
| Unique page titles & meta descriptions per page | SEO + click-through |
| `sitemap.xml` + Google Search Console | Proper indexing |
| Expanded guides / blog ("best winter tires in [city]") | Organic traffic |
| Analytics (GA4 or Plausible) | Measure what works |
| Open Graph images for social sharing | Better social clicks |

**Ask in meeting:** Do we have access to Google Business Profile and Search Console?

---

## Priority 5 — Operations & admin

### 10. Backend admin workflow

**Problem**
- Bookings live in Supabase.
- Inquiries live in Netlify Forms.
- Payments live in Stripe.
- No single admin dashboard described in the repo.

**Discuss in meeting**
- How does the owner view tomorrow's appointments today?
- Spreadsheet, Supabase dashboard, email only — or need a simple admin page?

---

### 11. Email confirmations

**Problem**
- Setup docs reference **Resend** for confirmation emails after payment — may not be fully wired in production.

**Discuss in meeting**
- What should the customer receive after booking? (date, address, deposit receipt, prep checklist)
- What should EastCord staff receive?

---

## Priority 6 — Code & dev process

| Topic | Current state |
|-------|---------------|
| README | Outdated — says "no build step"; repo has Netlify build scripts |
| Environment variables | Documented in `docs/appointment-automation-setup.md`; need deploy checklist |
| Testing | Need manual checklist: book → pay → email → slot blocked |
| Staging | Use Netlify deploy previews before production |
| Assets | Need real logo files, brand photos, official tire brand assets if using logos |

**Local dev command (after Netlify CLI installed):**
```powershell
npm run dev
# Opens http://localhost:8888 with production-style URL routing
```

---

## Suggested sitemap

```
/                          Homepage (marketing, calculator, brands, contact)
/new-tires                 New tire search (TireConnect)
/appointment               Booking wizard
/cart                      Appointment checkout
/login, /signup, /account  Customer accounts
/appointment-success       Post-payment confirmation
/appointment-cancelled     Cancelled checkout

/guides/*                  Tire education content
/tire-size-guide
/tire-season-guide
/used-tire-buying-guide
/how-we-inspect-used-tires

/terms-and-conditions
/privacy-policy
/cookie-policy

/public/docs/eastcord-used-tire-warranty-policy.pdf
```

**Missing / needs decision**
- Dedicated used tire inventory page (`/#inventory` or `/used-tires`)
- FAQ page
- Admin / staff dashboard

---

## Phased roadmap

### Phase 1 — Launch-ready (2–4 weeks)
- [ ] Fix location and copy consistency across all pages
- [ ] Confirm appointment + Stripe + Supabase in production
- [ ] Test full booking flow (book → pay deposit → confirmation email)
- [ ] Fix dead links and finalize sitemap
- [ ] Add analytics (GA4 or Plausible)

### Phase 2 — Revenue features (4–8 weeks)
- [ ] Used tire inventory (manual JSON or integrated source)
- [ ] Finalize TireConnect new tire flow and post-search CTA
- [ ] Unify auth on Supabase; remove Netlify Identity legacy path
- [ ] Google Business Profile + Search Console alignment
- [ ] FAQ page from top phone questions

### Phase 3 — Growth (ongoing)
- [ ] Customer reviews on site
- [ ] Admin dashboard or CRM integration
- [ ] SMS appointment reminders
- [ ] Seasonal landing pages (winter changeover, etc.)
- [ ] Expanded local SEO content

---

## Impact vs. effort matrix

| Item | Impact | Effort |
|------|--------|--------|
| Fix location/copy consistency | High | Low |
| Production test of booking + Stripe | High | Low |
| Confirmation emails (Resend) | High | Medium |
| Used tire inventory (JSON) | High | Medium |
| TireConnect finalized | High | Medium |
| Unify auth (drop Netlify Identity) | Medium | Medium |
| FAQ + reviews | Medium | Low |
| Admin dashboard | Medium | High |
| Analytics + Search Console | Medium | Low |
| Blog / SEO guides | Medium | Ongoing |

---

## Questions to ask the owner

1. **What is the #1 goal of the website?** (calls, appointments, tire sales, or all three?)
2. **What's already working in production vs. still in test mode?**
3. **Who maintains inventory and updates the site?**
4. **What's the official service area and business address?**
5. **Do we have access to:** Netlify, Supabase, Stripe, TireConnect, domain DNS, Google Business?
6. **What would success look like in 90 days?** (e.g. 20 bookings/month, inventory online)

---

## Access & accounts checklist

| Service | Purpose | Have access? |
|---------|---------|:------------:|
| GitHub (`EastCordTiresInc/codexcode`) | Source code | ☐ |
| Netlify | Hosting, forms, functions, env vars | ☐ |
| Supabase | Auth, customer profiles, bookings | ☐ |
| Stripe | Deposit payments, webhooks | ☐ |
| TireConnect | New tire search widget | ☐ |
| Resend (or email provider) | Booking confirmation emails | ☐ |
| Domain / DNS (`eastcordtires.ca`) | Domain management | ☐ |
| Google Business Profile | Local SEO | ☐ |
| Google Search Console | Indexing & search performance | ☐ |

---

## Closing one-liner

> "We don't need to rebuild the site — we need to **finish the booking and shopping flows**, **align the business info**, and **connect inventory + notifications** so the site drives real appointments and sales."

---

## Related docs in this repo

- `docs/appointment-automation-setup.md` — Supabase, Stripe, email env setup
- `supabase/appointment-automation-schema.sql` — Database schema for bookings
- `netlify.toml` + `_redirects` — URL routing rules
- `package.json` — Build scripts (`npm run build`, `npm run dev`)

---

## Meeting notes (fill in during call)

**Date:**

**Attendees:**

**Agreed #1 priority:**

**Agreed service area / location:**

**Production access confirmed:**

**Next steps / owners:**

| Task | Owner | Due |
|------|-------|-----|
| | | |
| | | |
| | | |
