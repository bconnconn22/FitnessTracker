/* Health Tracker sheet-sync helpers.
   Shared by the app (copied into index.html), Code.gs, and node tests.
   Keep the three copies in sync if you change merge or record packing.
   ES5, no DOM, no Apps Script globals. */
(function (root) {
  'use strict';

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
    // Guard obviously-broken values (pre-2000 or non-ms accidental seconds).
    if (n < 946684800000) return null;
    try { return new Date(n).toISOString(); } catch (e) { return null; }
  }

  function nowISO() { return new Date().toISOString(); }

  function parseTime(s) {
    if (typeof s !== 'string' || !s) return 0;
    var t = Date.parse(s);
    return isFinite(t) ? t : 0;
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

  function recordDate(collection, item) {
    if (!item || typeof item !== 'object') return '';
    if (isISODate(item.date)) return item.date;
    return '';
  }

  function itemUpdatedAt(item, fallbackDate) {
    if (!item || typeof item !== 'object') return fallbackDate ? fallbackDate + 'T00:00:00.000Z' : '1970-01-01T00:00:00.000Z';
    if (typeof item.updatedAt === 'string' && parseTime(item.updatedAt)) return new Date(parseTime(item.updatedAt)).toISOString();
    var fromMs = isoFromMs(item.updated) || isoFromMs(item.created) || isoFromMs(item.lastUsed) || isoFromMs(item.addedAt);
    if (fromMs) return fromMs;
    if (isISODate(item.date)) return item.date + 'T00:00:00.000Z';
    return '1970-01-01T00:00:00.000Z';
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
        if ((col !== 'recentFoods' && col !== 'favorites' && col !== 'customExercises') || col === 'customExercises') {
          if (!item.id && id) item.id = id;
          if ((col === 'food' || col === 'workouts' || col === 'water' || col === 'bp' || col === 'sleep' || col === 'records' || col === 'weights' || col === 'recipes' || col === 'stats') && !item.id) {
            item.id = 'migrated-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
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
          date: recordDate(col, item),
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
      // Equal timestamps: a delete wins so removals are not resurrected.
      if (rec.deleted && !prev.deleted) { map[k] = rec; return; }
      if (prev.deleted && !rec.deleted) return;
      // Still tied: keep the lexicographically larger payload for determinism.
      var sa = JSON.stringify(rec.data);
      var sb = JSON.stringify(prev.data);
      if (sa > sb) map[k] = rec;
    }
    (a || []).forEach(consider);
    (b || []).forEach(consider);
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (x, y) {
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

  // Apply merged records onto an existing state (keeps version and any non-synced fields).
  function applyRecords(state, records) {
    var next = recordsToState(records);
    if (!state || typeof state !== 'object') return next;
    next.version = state.version || 1;
    return next;
  }

  var api = {
    SYNC_COLLECTIONS: SYNC_COLLECTIONS,
    LIST_COLLECTIONS: LIST_COLLECTIONS,
    nowISO: nowISO,
    isoFromMs: isoFromMs,
    recordId: recordId,
    itemUpdatedAt: itemUpdatedAt,
    ensureRecordMeta: ensureRecordMeta,
    dbToRecords: dbToRecords,
    mergeRecords: mergeRecords,
    recordsToState: recordsToState,
    applyRecords: applyRecords,
    blankState: blankState,
    parseTime: parseTime
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HTSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
