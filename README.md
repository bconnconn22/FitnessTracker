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
- Stays on the device only. Nothing is uploaded.
- The home-screen app has its own storage, separate from Safari tabs. Log from the icon.
- Back up regularly: Today → gear icon → **Export data** (saves a JSON file via the share sheet).
- **Import from file** can merge into or replace current data.
- **Clear all data** requires typing DELETE and a second confirmation.

## Limitations
- No Apple Health sync (web apps can't access HealthKit).
- No sync between devices; use Export/Import to move data.
- Deleting the home-screen app deletes its data.
- Food data comes from public databases and can have gaps or errors (especially crowd-sourced Open Food Facts entries); check the label when it matters.
