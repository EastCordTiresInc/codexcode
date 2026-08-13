# Connect Supabase Inventory to the EastCord Website

This guide connects your Supabase project (with `tire_inventory`) to the live site.

---

## 1. Supabase project setup

### Create or open your project
1. Go to [supabase.com](https://supabase.com) and open your EastCord project.
2. Go to **Project Settings → API** and copy:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public** key → `VITE_SUPABASE_ANON_KEY`

### Run the inventory SQL
In **SQL Editor**, run:

```
supabase/tire-inventory-schema.sql
```

If you also need appointments/accounts, run first:

```
supabase/appointment-automation-schema.sql
```

### Add sample tires (optional test data)

```sql
insert into public.tire_inventory (sku, brand, model, size, tire_type, season, load_rating, price, stock, condition, details, status)
values
  ('DEMO-001', 'Michelin', 'Defender', '225/60R17', 'Used', 'All-season', '99H', 89.99, 4, 'Good', '6/32 tread remaining', 'published'),
  ('DEMO-002', 'Bridgestone', 'Blizzak', '205/55R16', 'Used', 'Winter', '91H', 74.99, 2, 'Good', '7/32 tread remaining', 'published');
```

---

## 2. Netlify production setup

In **Netlify → Site → Environment variables**, add:

| Variable | Value |
|----------|--------|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon public key |

The build script `scripts/generate-auth-config.js` writes these into `auth-config.js` on deploy.

Redeploy the site after saving env vars.

---

## 3. Local development setup

```powershell
cd "c:\Users\nikki\OneDrive\Documents\EastCordTires"
copy .env.example .env
# Edit .env and paste your Supabase URL + anon key
node scripts/generate-auth-config.js
npm run dev
```

Open:
- [http://localhost:8888/used-tires](http://localhost:8888/used-tires)

---

## 4. How the website connects

```
used-tires.html
    → auth-config.js (Supabase URL + anon key)
    → account.js (Supabase client)
    → inventory.js
        → SELECT from tire_inventory
        → populates width / profile / wheel size dropdowns from live inventory
        → filters by size + season on "Find your tires now"
        → shows published rows with stock > 0
```

The used tires page parses tire sizes like `225/60R17` from the `size` column to fill the search dropdowns. Make sure inventory rows use that format.

**Row Level Security:** Customers can only read rows where `status = 'published'` and `stock > 0`.

Employees update inventory in Supabase directly, via Google Sheets sync (see `docs/inventory-google-sheets-supabase-setup.md`), or with the service role key in a backend sync job.

---

## 5. Inventory table columns

| Column | Website use |
|--------|-------------|
| `sku` | Internal ID |
| `brand`, `model`, `size` | Title + search |
| `tire_type` | Filter (Used / New) |
| `season` | Filter + display |
| `load_rating` | Display |
| `price` | Display |
| `stock` | Must be > 0 to show |
| `condition`, `details` | Display |
| `status` | Must be `published` to show |

---

## 6. Troubleshooting

| Problem | Fix |
|---------|-----|
| "Inventory is being connected" | Run `node scripts/generate-auth-config.js` with valid `.env`, or set Netlify env vars |
| Empty list | Add rows with `status = 'published'` and `stock > 0` |
| Permission error | Re-run `supabase/tire-inventory-schema.sql` RLS policy |
| Old data showing | Click **Refresh inventory** on `/used-tires` |

---

## 7. Files involved

| File | Purpose |
|------|---------|
| `used-tires.html` | Inventory page |
| `inventory.js` | Loads tires from Supabase |
| `auth-config.js` | Generated Supabase keys (do not edit by hand) |
| `account.js` | Shared Supabase client |
| `scripts/generate-auth-config.js` | Build-time config generator |
| `supabase/tire-inventory-schema.sql` | Database table + RLS |

---

## 8. Next steps

- [ ] Add Google Sheets → Supabase sync (`docs/inventory-google-sheets-supabase-setup.md`)
- [ ] Link homepage "Check Used Tires" buttons to `/used-tires`
- [ ] Add online tire cart/checkout (optional phase 2)
