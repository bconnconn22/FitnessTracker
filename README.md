# Health Tracker (iPhone web app)

A private, offline-capable health tracker for food (calories and protein/carbs/fat), workouts, water, sleep, and weight.
No App Store, no Mac, no account. Everything is stored on the phone (localStorage).

## Files
- `index.html` – the whole app (HTML, CSS, JS in one file)
- `manifest.webmanifest` – app name, colors, icons for Add to Home Screen
- `sw.js` – service worker that caches the app so it works offline
- `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` – app icons

- `vendor/zxing.min.js` – ZXing barcode reader (Apache-2.0, see `vendor/ZXING-LICENSE.txt`), used for barcode scanning on iPhone

Keep all files together in the same folder.

## Food database
- **Search** (Food tab): USDA FoodData Central (generic foods plus branded) and Open Food Facts (packaged foods), merged and de-duplicated.
- **Scan**: reads UPC/EAN barcodes with the rear camera, looks them up in Open Food Facts, then USDA Branded. You can also type the barcode number.
- **Serving picker**: household servings when the database has them, plus grams and 100 g; quantity can be a decimal.
- **Recent and favorites**: tap + to re-log a recent food in one tap; tap the star to save a favorite. Both are included in Export/Import.
- **USDA API key**: `USDA_API_KEY` is set to the placeholder `YOUR_USDA_API_KEY` near the top of the script in `index.html`. `DEMO_KEY` works without signing up but is shared and heavily rate-limited. Get a free personal key at https://api.data.gov/signup/ and paste it there. When USDA's limit is hit, search falls back to Open Food Facts for an hour.
- Search and barcode lookups need a connection; recent and favorite foods work offline. API responses are never cached by the service worker.

## Open it
The app needs to be served over **https** (or `http://localhost` for testing) for the
service worker and home-screen install to work. Opening `index.html` straight from the
Files app (`file://`) shows the app but will not install or work offline reliably.

Easiest options:
1. Upload the folder to any free static host (GitHub Pages, Netlify Drop, Cloudflare Pages),
   then open the https link in Safari on the iPhone.
2. For a quick local test on a computer: `python3 -m http.server 8765` in this folder,
   then visit http://localhost:8765.

## Add to iPhone home screen
1. Open the https link in **Safari**.
2. Tap the **Share** button (square with an up arrow).
3. Tap **Add to Home Screen**, then **Add**.
4. Launch it from the new "Health" icon. It opens full-screen and works offline.

## Your data
- Stays on the device by default. Optional Google Sheet sync (see below) keeps the same data in your spreadsheet.
- The home-screen app has its own storage, separate from Safari tabs. Log from the icon.
- Back up regularly: Today → gear icon → **Export data** (saves a JSON file via the share sheet).
- **Import from file** can merge into or replace current data.
- **Clear all data** requires typing DELETE and a second confirmation.


## Google Sheet sync

This is optional. After it is set up, anything logged in the app is saved to a
tab called **AppSync** in your Google Sheet, and anything added to that tab
shows up in the app the next time it syncs.

You only need to do this once, on a computer, while signed into the Google
account that owns the sheet.

### 1. Open the script editor

1. Open your Health Tracker Google Sheet.
2. Click **Extensions**, then **Apps Script**.
3. If the editor shows a default `Code.gs` file with a sample `myFunction`,
   select all of that text and delete it.

### 2. Paste the script and save

1. On your computer, open the `sync/Code.gs` file from this project
   (or download it from the GitHub repo).
2. Copy the entire file.
3. Paste it into the Apps Script editor.
4. Click the floppy-disk **Save** icon. Name the project something like
   "Health Tracker sync" if it asks.

### 3. Run setup and copy your token

1. At the top of the editor, make sure the function dropdown says **setup**.
2. Click **Run**.
3. Google will ask you to authorize the script. Click **Review permissions**,
   pick your account, click **Advanced**, then **Go to Health Tracker sync
   (unsafe)**. This warning is normal for a script you just pasted yourself.
   Click **Allow**.
4. After it finishes, click **Executions** in the left sidebar (the clock
   icon). Open the latest **setup** run and copy the long token from the log.
   Keep this token private, like a password.

If you ever lose the token, run **setup** again. It reprints the same one.
To make a new token, delete the `SYNC_TOKEN` script property
(Project Settings → Script properties) and run **setup** again.

### 4. Deploy the web app

1. In the Apps Script editor, click **Deploy**, then **New deployment**.
2. Click the gear next to **Select type** and choose **Web app**.
3. Fill in:
   - Description: `Health Tracker sync`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**.
5. Copy the **Web app URL**. It starts with `https://script.google.com/macros/s/`
   and ends with `/exec`.

"Anyone" is required so the phone can reach the script without a Google login.
The URL is not enough on its own: every request still needs your token.

If you later change `Code.gs`, click **Deploy → Manage deployments**, edit the
existing deployment, and choose **New version**, so the same URL stays valid.

### 5. Connect the app on your phone

1. Open Health Tracker (install it to the home screen if you have not already).
2. On **Today**, tap the gear icon to open Settings.
3. Under **Google Sheet sync**, paste the Web app URL and the token.
4. Tap **Sync now**. You should see a "Synced just now" (or similar) status.

After that, the app syncs when you open it, when you come back to it, and
shortly after you save something. It waits if you are offline and retries
when you are back online. You can still Export and Import JSON as a backup.

Clearing all data on the phone only erases the local copy. The sheet is
unchanged, and the next sync will bring that data back.

## Limitations
- No Apple Health sync (web apps can't access HealthKit).
- Optional Google Sheet sync (below) keeps the phone and the sheet in sync. You can still use Export/Import to move a file by hand.
- Deleting the home-screen app deletes its data.
- Food data comes from public databases and can have gaps or errors (especially crowd-sourced Open Food Facts entries); check the label when it matters.
