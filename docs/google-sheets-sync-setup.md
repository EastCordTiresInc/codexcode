# Google Sheets → Supabase inventory sync

The sync function copies the inventory sheet into `public.usedtireinventory`.
The website continues reading Supabase and can fall back to
`assets/used-inventory.json`; the sync does not need to run while doing UI work.

## 1. Prepare the sheet

Row 1 must contain these headers:

```text
id,tire_size,rim_size,type,brand,opening_qty,add_qty,remove_qty,current_stock,selling_price,drive_link,is_flotation
```

The tab name used by default is `Inventory`. Each `id` must be a unique positive
whole number. If `current_stock` is blank, the function calculates:

```text
opening_qty + add_qty - remove_qty
```

## 2. Create and share a Google service account

1. Open Google Cloud Console and enable **Google Sheets API**.
2. Create a service account and download its JSON key.
3. Copy the service account's email address.
4. In Google Sheets, share the inventory sheet with that email as **Viewer**.

## 3. Add local variables

Copy these values into `.netlify/.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GOOGLE_SHEETS_ID=spreadsheet-id-from-the-sheet-url
GOOGLE_SHEETS_RANGE=Inventory!A:Z
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
INVENTORY_SYNC_SECRET=choose-a-long-random-secret
SYNC_DEACTIVATE_MISSING=false
```

The service-role key and private key are server secrets. Never place them in
`auth-config.js`, browser JavaScript, or a committed file.

## 4. Test locally

Start the local Netlify server:

```powershell
npm run dev
```

First run a read-only validation:

```powershell
Invoke-RestMethod `
  -Uri "http://localhost:8888/.netlify/functions/sync-inventory-from-sheets" `
  -Method Get
```

If it reports `dryRun: true` and the expected `rowsReady`, apply the sync:

```powershell
$headers = @{ "x-sync-secret" = "the-value-of-INVENTORY_SYNC_SECRET" }
Invoke-RestMethod `
  -Uri "http://localhost:8888/.netlify/functions/sync-inventory-from-sheets" `
  -Method Post `
  -Headers $headers
```

Then refresh `/used-tires` and search again.

## 5. Deploy

Add the same variables in **Netlify → Site configuration → Environment
variables**, then deploy. `netlify.toml` schedules the function every 15
minutes.

`SYNC_DEACTIVATE_MISSING=false` is the safe default: the sync only inserts or
updates sheet rows. Set it to `true` only if removing a row from the sheet should
automatically set its Supabase stock to zero.
