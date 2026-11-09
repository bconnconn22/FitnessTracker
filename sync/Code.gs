/**
 * Health Tracker two-way sync for Google Sheets.
 *
 * Setup (once):
 *  1. Paste this file into Extensions → Apps Script for your tracker sheet.
 *  2. Click Run on the setup function, accept the permission prompt, then
 *     open Executions (clock icon) and copy the token from the log.
 *  3. Deploy → New deployment → Web app.
 *       Execute as: Me
 *       Who has access: Anyone
 *  4. Paste the Web App URL and the token into the Health Tracker app Settings.
 *
 * Security: every request must include the token stored in Script Properties.
 * Never put the token in this file. Run setup() to generate or reprint it.
 *
 * The merge helpers below must stay in sync with sync/merge.js.
 */

var APP_SYNC_SHEET = 'AppSync';
var TOKEN_PROP = 'SYNC_TOKEN';
var HEADERS = ['id', 'collection', 'date', 'updatedAt', 'deleted', 'json'];

var SYNC_COLLECTIONS = [
  'food', 'workouts', 'water', 'bp', 'sleep', 'records', 'weights',
  'recipes', 'stats', 'customExercises', 'recentFoods', 'favorites', 'settings'
];
var LIST_COLLECTIONS = [
  'food', 'workouts', 'water', 'bp', 'sleep', 'records', 'weights',
  'recipes', 'stats', 'customExercises', 'recentFoods', 'favorites'
];

function isISODate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

function isoFromMs(ms) {
  var n = Number(ms);
  if (!isFinite(n) || n <= 0) return null;
  if (n < 946684800000) return null;
  try { return new Date(n).toISOString(); } catch (e) { return null; }
}

function parseTime(s) {
  if (typeof s !== 'string' || !s) return 0;
  var t = Date.parse(s);
  return isFinite(t) ? t : 0;
}

function itemUpdatedAt(item, fallbackDate) {
  if (!item || typeof item !== 'object') return fallbackDate ? fallbackDate + 'T00:00:00.000Z' : '1970-01-01T00:00:00.000Z';
  if (typeof item.updatedAt === 'string' && parseTime(item.updatedAt)) return new Date(parseTime(item.updatedAt)).toISOString();
  var fromMs = isoFromMs(item.updated) || isoFromMs(item.created) || isoFromMs(item.lastUsed) || isoFromMs(item.addedAt);
  if (fromMs) return fromMs;
  if (isISODate(item.date)) return item.date + 'T00:00:00.000Z';
  return '1970-01-01T00:00:00.000Z';
}

function recordId(collection, item) {
  if (collection === 'settings') return 'settings';
  if (!item || typeof item !== 'object') return '';
  if (collection === 'recentFoods') return item.key ? 'recent:' + item.key : '';
  if (collection === 'favorites') return item.key ? 'fav:' + item.key : '';
  if (collection === 'customExercises') {
    if (item.id && String(item.id).indexOf('custom:') === 0) return String(item.id);
    return item.name ? 'custom:' + String(item.name).trim().toLowerCase() : '';
  }
  return typeof item.id === 'string' && item.id ? item.id : '';
}

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

function ensureRecordMeta(db) {
  if (!db || typeof db !== 'object') return db;
  LIST_COLLECTIONS.forEach(function (col) {
    if (!Array.isArray(db[col])) db[col] = [];
    db[col].forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      var id = recordId(col, item);
      if (col === 'customExercises' && id) item.id = id;
      if (col !== 'recentFoods' && col !== 'favorites') {
        if (!item.id && id) item.id = id;
        if (!item.id && (col === 'food' || col === 'workouts' || col === 'water' || col === 'bp' || col === 'sleep' || col === 'records' || col === 'weights' || col === 'recipes' || col === 'stats')) {
          item.id = 'migrated-' + Math.random().toString(36).slice(2, 10);
        }
      }
      item.updatedAt = itemUpdatedAt(item);
    });
  });
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  db.settings.updatedAt = itemUpdatedAt(db.settings);
  if (!Array.isArray(db.tombstones)) db.tombstones = [];
  db.tombstones = db.tombstones.filter(function (t) {
    return t && typeof t === 'object' && typeof t.id === 'string' && t.id && typeof t.collection === 'string' && SYNC_COLLECTIONS.indexOf(t.collection) >= 0;
  }).map(function (t) {
    return { id: t.id, collection: t.collection, date: isISODate(t.date) ? t.date : '', updatedAt: itemUpdatedAt(t), deleted: true };
  });
  return db;
}

function dbToRecords(db) {
  ensureRecordMeta(db);
  var recs = [];
  LIST_COLLECTIONS.forEach(function (col) {
    (db[col] || []).forEach(function (item) {
      var id = recordId(col, item);
      if (!id) return;
      recs.push({
        id: id,
        collection: col,
        date: isISODate(item.date) ? item.date : '',
        updatedAt: itemUpdatedAt(item),
        deleted: false,
        data: clone(item)
      });
    });
  });
  recs.push({
    id: 'settings',
    collection: 'settings',
    date: '',
    updatedAt: itemUpdatedAt(db.settings),
    deleted: false,
    data: clone(db.settings)
  });
  (db.tombstones || []).forEach(function (t) {
    recs.push({
      id: t.id,
      collection: t.collection,
      date: t.date || '',
      updatedAt: t.updatedAt,
      deleted: true,
      data: null
    });
  });
  return recs;
}

function cmpUpdated(a, b) {
  return parseTime(a) - parseTime(b);
}

function mergeRecords(a, b) {
  var map = {};
  function keyOf(r) { return r.collection + '\0' + r.id; }
  function consider(r) {
    if (!r || typeof r !== 'object' || !r.id || !r.collection) return;
    if (SYNC_COLLECTIONS.indexOf(r.collection) < 0) return;
    var rec = {
      id: String(r.id),
      collection: r.collection,
      date: isISODate(r.date) ? r.date : '',
      updatedAt: typeof r.updatedAt === 'string' && r.updatedAt ? r.updatedAt : '1970-01-01T00:00:00.000Z',
      deleted: !!r.deleted,
      data: r.deleted ? null : (r.data != null ? r.data : r.json != null ? r.json : null)
    };
    if (typeof rec.data === 'string') {
      try { rec.data = JSON.parse(rec.data); } catch (e) { rec.data = null; }
    }
    var k = keyOf(rec);
    var prev = map[k];
    if (!prev) { map[k] = rec; return; }
    var cmp = cmpUpdated(rec.updatedAt, prev.updatedAt);
    if (cmp > 0) { map[k] = rec; return; }
    if (cmp < 0) return;
    if (rec.deleted && !prev.deleted) { map[k] = rec; return; }
    if (prev.deleted && !rec.deleted) return;
    var sa = JSON.stringify(rec.data);
    var sb = JSON.stringify(prev.data);
    if (sa > sb) map[k] = rec;
  }
  (a || []).forEach(consider);
  (b || []).forEach(consider);
  var keys = [];
  for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k)) keys.push(k);
  return keys.map(function (key) { return map[key]; }).sort(function (x, y) {
    if (x.collection !== y.collection) return x.collection < y.collection ? -1 : 1;
    if (x.date !== y.date) return x.date < y.date ? -1 : 1;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
}

function blankState() {
  return {
    version: 1,
    settings: { waterGoal: 64, units: 'lb' },
    food: [], workouts: [], water: [], bp: [], sleep: [],
    recentFoods: [], favorites: [], customExercises: [],
    records: [], stats: [], recipes: [], weights: [],
    tombstones: []
  };
}

function recordsToState(records) {
  var state = blankState();
  var tombstones = [];
  (records || []).forEach(function (r) {
    if (!r || !r.id || !r.collection) return;
    if (r.deleted) {
      tombstones.push({ id: r.id, collection: r.collection, date: r.date || '', updatedAt: r.updatedAt, deleted: true });
      return;
    }
    if (r.collection === 'settings') {
      if (r.data && typeof r.data === 'object') state.settings = clone(r.data);
      return;
    }
    if (LIST_COLLECTIONS.indexOf(r.collection) < 0) return;
    if (r.data && typeof r.data === 'object') state[r.collection].push(clone(r.data));
  });
  state.tombstones = tombstones;
  ensureRecordMeta(state);
  return state;
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function storedToken_() {
  return PropertiesService.getScriptProperties().getProperty(TOKEN_PROP) || '';
}

function checkToken_(token) {
  var expected = storedToken_();
  return !!(expected && token && String(token) === expected);
}

function randomToken_() {
  var raw = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
  return raw.replace(/-/g, '');
}

/**
 * One-time setup: create the AppSync tab if needed and generate (or reprint)
 * the secret token. Open Executions afterwards and copy the token from the log.
 */
function setup() {
  ensureSheet_();
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty(TOKEN_PROP);
  var token = existing;
  if (!token) {
    token = randomToken_();
    props.setProperty(TOKEN_PROP, token);
    Logger.log('New Health Tracker sync token created. Paste it into the app Settings together with the Web App URL.');
  } else {
    Logger.log('A sync token already exists. It is reprinted below. To rotate it, delete the SYNC_TOKEN script property and run setup() again.');
  }
  Logger.log(token);
  return token;
}

function ensureSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(APP_SYNC_SHEET);
  if (!sh) {
    sh = ss.insertSheet(APP_SYNC_SHEET);
  }
  var first = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  var empty = !first[0] && !first[1];
  var mismatch = first[0] !== HEADERS[0] || first[5] !== HEADERS[5];
  if (empty || mismatch) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function truthy_(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).trim().toUpperCase();
  return s === 'TRUE' || s === 'YES' || s === '1';
}

function readRecords_() {
  var sh = ensureSheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var recs = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var id = String(row[0] || '').trim();
    var collection = String(row[1] || '').trim();
    if (!id || !collection) continue;
    var rec = {
      id: id,
      collection: collection,
      date: isISODate(String(row[2] || '').trim()) ? String(row[2]).trim() : '',
      updatedAt: String(row[3] || '').trim() || '1970-01-01T00:00:00.000Z',
      deleted: truthy_(row[4]),
      data: null
    };
    if (!rec.deleted) {
      var raw = row[5];
      if (typeof raw === 'string' && raw) {
        try { rec.data = JSON.parse(raw); } catch (e) { rec.data = null; }
      } else if (raw && typeof raw === 'object') {
        rec.data = raw;
      }
    }
    recs.push(rec);
  }
  // Collapse any accidental duplicate rows the same way a sync would.
  return mergeRecords(recs, []);
}

function writeRecords_(records) {
  var sh = ensureSheet_();
  var last = Math.max(sh.getLastRow(), 1);
  if (last > 1) sh.getRange(2, 1, last - 1, HEADERS.length).clearContent();
  if (!records || !records.length) return;
  var rows = records.map(function (r) {
    return [
      r.id,
      r.collection,
      r.date || '',
      r.updatedAt || '',
      r.deleted ? 'TRUE' : 'FALSE',
      r.deleted ? '' : JSON.stringify(r.data == null ? {} : r.data)
    ];
  });
  sh.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
}

function handle_(method, token, incoming) {
  if (!checkToken_(token)) {
    return jsonOut_({ ok: false, error: 'Unauthorized' });
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureSheet_();
    var stored = readRecords_();
    var merged = method === 'POST' ? mergeRecords(stored, incoming || []) : stored;
    if (method === 'POST') writeRecords_(merged);
    return jsonOut_({ ok: true, records: merged, state: recordsToState(merged) });
  } catch (e) {
    return jsonOut_({ ok: false, error: String(e && e.message ? e.message : e) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var token = e && e.parameter ? e.parameter.token : '';
  return handle_('GET', token, null);
}

function doPost(e) {
  var body = {};
  var raw = e && e.postData ? e.postData.contents : '';
  if (raw) {
    try { body = JSON.parse(raw); } catch (err) {
      return jsonOut_({ ok: false, error: 'Invalid JSON' });
    }
  }
  var token = (body && body.token) || (e && e.parameter && e.parameter.token) || '';
  var records = (body && body.records) || [];
  return handle_('POST', token, records);
}
