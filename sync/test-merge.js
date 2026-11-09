/* eslint-disable no-console */
'use strict';
var assert = require('assert');
var path = require('path');
var fs = require('fs');
var merge = require('./merge.js');

var failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  - ' + name); }
  catch (e) { failed++; console.error('FAIL - ' + name + '\n  ' + (e.stack || e)); }
}

function rec(partial) {
  return Object.assign({
    id: 'x',
    collection: 'food',
    date: '2026-11-02',
    updatedAt: '2026-11-02T12:00:00.000Z',
    deleted: false,
    data: { id: 'x', date: '2026-11-02', name: 'Oats', meal: 'breakfast', calories: 300 }
  }, partial);
}

test('newer updatedAt wins', function () {
  var a = [rec({ updatedAt: '2026-11-02T12:00:00.000Z', data: { id: 'x', name: 'old' } })];
  var b = [rec({ updatedAt: '2026-11-03T12:00:00.000Z', data: { id: 'x', name: 'new' } })];
  var out = merge.mergeRecords(a, b);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].data.name, 'new');
});

test('older remote does not overwrite newer local', function () {
  var local = [rec({ updatedAt: '2026-11-09T18:00:00.000Z', data: { id: 'x', name: 'phone' } })];
  var remote = [rec({ updatedAt: '2026-11-08T18:00:00.000Z', data: { id: 'x', name: 'sheet' } })];
  var out = merge.mergeRecords(local, remote);
  assert.strictEqual(out[0].data.name, 'phone');
});

test('newer tombstone deletes a live record', function () {
  var live = [rec({ updatedAt: '2026-11-02T12:00:00.000Z' })];
  var tomb = [rec({ updatedAt: '2026-11-02T13:00:00.000Z', deleted: true, data: null })];
  var out = merge.mergeRecords(live, tomb);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].deleted, true);
  assert.strictEqual(out[0].data, null);
});

test('older tombstone does not delete a newer live record', function () {
  var live = [rec({ updatedAt: '2026-11-09T12:00:00.000Z', data: { id: 'x', name: 'kept' } })];
  var tomb = [rec({ updatedAt: '2026-11-01T12:00:00.000Z', deleted: true, data: null })];
  var out = merge.mergeRecords(live, tomb);
  assert.strictEqual(out[0].deleted, false);
  assert.strictEqual(out[0].data.name, 'kept');
});

test('equal timestamps: delete wins', function () {
  var ts = '2026-11-09T12:00:00.000Z';
  var out = merge.mergeRecords(
    [rec({ updatedAt: ts, data: { id: 'x', name: 'live' } })],
    [rec({ updatedAt: ts, deleted: true, data: null })]
  );
  assert.strictEqual(out[0].deleted, true);
});

test('records in different collections or ids stay separate', function () {
  var out = merge.mergeRecords(
    [rec({ id: 'a', collection: 'food' }), rec({ id: 'a', collection: 'workouts', data: { id: 'a', type: 'walk' } })],
    [rec({ id: 'b', collection: 'food', data: { id: 'b', name: 'Rice' } })]
  );
  assert.strictEqual(out.length, 3);
});

test('empty local plus seeded remote returns remote (first phone sync)', function () {
  var remote = [rec({ id: 'seed', data: { id: 'seed', name: 'Gym' } })];
  var out = merge.mergeRecords([], remote);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'seed');
});

test('empty incoming POST does not drop stored records', function () {
  var stored = [rec({ id: 'keep', data: { id: 'keep', name: 'Stay' } })];
  var out = merge.mergeRecords(stored, []);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'keep');
});

test('settings is a singleton merged by updatedAt', function () {
  var a = [{ id: 'settings', collection: 'settings', date: '', updatedAt: '2026-11-01T00:00:00.000Z', deleted: false, data: { waterGoal: 64, units: 'lb' } }];
  var b = [{ id: 'settings', collection: 'settings', date: '', updatedAt: '2026-11-09T00:00:00.000Z', deleted: false, data: { waterGoal: 80, units: 'kg' } }];
  var out = merge.mergeRecords(a, b);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].data.waterGoal, 80);
  assert.strictEqual(out[0].data.units, 'kg');
});

test('migrate assigns stable ids and updatedAt', function () {
  var db = merge.blankState();
  db.workouts.push({ created: Date.parse('2026-11-02T23:00:00.000Z'), date: '2026-11-02', type: 'walk', name: 'Walk' });
  db.customExercises.push({ name: 'Chest press', kind: 'weight' });
  db.favorites.push({ key: 'usda:123', name: 'Chicken', per100: { kcal: 100 } });
  db.recentFoods.push({ key: 'manual:oats', name: 'Oats', lastUsed: Date.parse('2026-11-03T14:00:00.000Z'), fixed: { label: '1 serving', kcal: 150 } });
  merge.ensureRecordMeta(db);
  assert.ok(db.workouts[0].id);
  assert.strictEqual(db.workouts[0].updatedAt, '2026-11-02T23:00:00.000Z');
  assert.strictEqual(db.customExercises[0].id, 'custom:chest press');
  assert.strictEqual(merge.recordId('favorites', db.favorites[0]), 'fav:usda:123');
  assert.strictEqual(merge.recordId('recentFoods', db.recentFoods[0]), 'recent:manual:oats');
  // Must not overwrite the USDA-style id on a favorite food object if one existed
  assert.notStrictEqual(db.favorites[0].id, 'fav:usda:123');
});

test('dbToRecords / recordsToState round-trip', function () {
  var db = merge.blankState();
  db.settings.waterGoal = 72;
  db.settings.updatedAt = '2026-11-09T10:00:00.000Z';
  db.food.push({ id: 'meal1', date: '2026-11-09', time: '12:30', name: 'Chicken bowl', meal: 'lunch', calories: 620, protein: 48, carbs: 50, fat: 18, updatedAt: '2026-11-09T18:30:00.000Z' });
  db.workouts.push({ id: 'wo1', date: '2026-11-09', time: '17:00', type: 'walk', name: 'Easy walk', minutes: 40, unit: 'lb', exercises: [], updatedAt: '2026-11-09T23:00:00.000Z' });
  db.weights.push({ id: 'wt1', date: '2026-11-02', time: '08:00', value: 180, unit: 'lb', bf: null, notes: '', updatedAt: '2026-11-02T14:00:00.000Z' });
  db.tombstones.push({ id: 'gone', collection: 'water', date: '2026-11-08', updatedAt: '2026-11-08T20:00:00.000Z', deleted: true });
  var recs = merge.dbToRecords(db);
  var back = merge.recordsToState(recs);
  assert.strictEqual(back.settings.waterGoal, 72);
  assert.strictEqual(back.food.length, 1);
  assert.strictEqual(back.food[0].name, 'Chicken bowl');
  assert.strictEqual(back.workouts[0].type, 'walk');
  assert.strictEqual(back.weights[0].value, 180);
  assert.strictEqual(back.tombstones.length, 1);
  assert.strictEqual(back.tombstones[0].id, 'gone');
});

test('accepts json alias used by sheet rows', function () {
  var out = merge.mergeRecords([], [{
    id: 'row1', collection: 'food', date: '2026-11-09', updatedAt: '2026-11-09T12:00:00.000Z',
    deleted: false, json: { id: 'row1', name: 'From sheet' }
  }]);
  assert.strictEqual(out[0].data.name, 'From sheet');
});

// ---- Code.gs with mocked Apps Script services ----
function mockSpreadsheet(existingRows) {
  var rows = existingRows ? existingRows.map(function (r) { return r.slice(); }) : [ ['id', 'collection', 'date', 'updatedAt', 'deleted', 'json'] ];
  var sheet = {
    getLastRow: function () { return rows.length; },
    getRange: function (r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      return {
        getValues: function () {
          var out = [];
          for (var i = 0; i < nr; i++) {
            var src = rows[r - 1 + i] || [];
            var line = [];
            for (var j = 0; j < nc; j++) line.push(src[c - 1 + j] != null ? src[c - 1 + j] : '');
            out.push(line);
          }
          return out;
        },
        setValues: function (vals) {
          for (var i = 0; i < vals.length; i++) {
            var idx = r - 1 + i;
            while (rows.length <= idx) rows.push([]);
            rows[idx] = rows[idx].slice();
            for (var j = 0; j < vals[i].length; j++) rows[idx][c - 1 + j] = vals[i][j];
          }
        },
        setFontWeight: function () {},
        clearContent: function () {
          for (var i = 0; i < nr; i++) {
            var idx = r - 1 + i;
            if (!rows[idx]) continue;
            for (var j = 0; j < nc; j++) rows[idx][c - 1 + j] = '';
          }
        }
      };
    },
    setFrozenRows: function () {},
    _rows: rows
  };
  return {
    getSheetByName: function (name) { return name === 'AppSync' ? sheet : null; },
    insertSheet: function () { return sheet; },
    sheet: sheet
  };
}

function installMocks(opts) {
  opts = opts || {};
  var token = opts.token || 'secret-token';
  var ss = mockSpreadsheet(opts.rows);
  var logs = [];
  var props = { SYNC_TOKEN: opts.missingToken ? null : token };
  global.SpreadsheetApp = { getActiveSpreadsheet: function () { return ss; } };
  global.PropertiesService = {
    getScriptProperties: function () {
      return {
        getProperty: function (k) { return props[k] || ''; },
        setProperty: function (k, v) { props[k] = v; }
      };
    }
  };
  global.LockService = {
    getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; }
  };
  global.ContentService = {
    MimeType: { JSON: 'JSON' },
    createTextOutput: function (s) {
      return { setMimeType: function () { return this; }, _text: s, getContent: function () { return s; } };
    }
  };
  global.Utilities = { getUuid: function () { return '11111111-2222-3333-4444-555555555555'; } };
  global.Logger = { log: function (m) { logs.push(String(m)); } };
  return { ss: ss, logs: logs, props: props, token: token };
}

function loadCodeGs() {
  var src = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
  var moduleFns = {};
  // Eval in this scope so mocks on global are visible; collect top-level functions.
  var wrapped = src + '\n;this.__codegs = { setup: setup, doGet: doGet, doPost: doPost, mergeRecords: mergeRecords, readRecords_: readRecords_, writeRecords_: writeRecords_, ensureSheet_: ensureSheet_, recordsToState: recordsToState };\n';
  var fn = new Function(wrapped);
  fn.call(global);
  return global.__codegs;
}

test('Code.gs setup generates and reprints a token', function () {
  var m = installMocks({ missingToken: true });
  var code = loadCodeGs();
  var t1 = code.setup();
  assert.ok(t1 && t1.length > 20);
  assert.ok(m.logs.some(function (l) { return l.indexOf(t1) >= 0; }));
  m.logs.length = 0;
  var t2 = code.setup();
  assert.strictEqual(t2, t1);
});

test('Code.gs doGet / doPost reject missing or wrong token', function () {
  installMocks({ token: 'secret-token' });
  var code = loadCodeGs();
  var denied = JSON.parse(code.doGet({ parameter: {} })._text);
  assert.strictEqual(denied.ok, false);
  assert.strictEqual(denied.error, 'Unauthorized');
  var denied2 = JSON.parse(code.doPost({ postData: { contents: JSON.stringify({ token: 'nope', records: [] }) } })._text);
  assert.strictEqual(denied2.ok, false);
});

test('Code.gs doGet returns stored records; doPost merges and saves', function () {
  var existing = [
    ['id', 'collection', 'date', 'updatedAt', 'deleted', 'json'],
    ['wo1', 'workouts', '2026-11-02', '2026-11-02T23:00:00.000Z', 'FALSE', JSON.stringify({ id: 'wo1', date: '2026-11-02', type: 'strength', name: 'Gym 1' })],
    ['settings', 'settings', '', '2026-11-01T00:00:00.000Z', 'FALSE', JSON.stringify({ waterGoal: 64, units: 'lb' })]
  ];
  installMocks({ token: 'secret-token', rows: existing });
  var code = loadCodeGs();
  var got = JSON.parse(code.doGet({ parameter: { token: 'secret-token' } })._text);
  assert.strictEqual(got.ok, true);
  assert.ok(got.state.workouts.some(function (w) { return w.id === 'wo1'; }));

  var incoming = [
    { id: 'wo1', collection: 'workouts', date: '2026-11-02', updatedAt: '2026-11-09T23:00:00.000Z', deleted: false, data: { id: 'wo1', date: '2026-11-02', type: 'strength', name: 'Gym 1 (edited)' } },
    { id: 'meal1', collection: 'food', date: '2026-11-09', updatedAt: '2026-11-09T19:00:00.000Z', deleted: false, data: { id: 'meal1', date: '2026-11-09', name: 'Chicken bowl', meal: 'dinner', calories: 700, protein: 50, carbs: 55, fat: 20 } }
  ];
  var posted = JSON.parse(code.doPost({
    postData: { contents: JSON.stringify({ token: 'secret-token', records: incoming }) }
  })._text);
  assert.strictEqual(posted.ok, true);
  var gym = posted.state.workouts.filter(function (w) { return w.id === 'wo1'; })[0];
  assert.strictEqual(gym.name, 'Gym 1 (edited)');
  assert.strictEqual(posted.state.food[0].name, 'Chicken bowl');
  // Sheet was rewritten with both records
  var stored = JSON.parse(code.doGet({ parameter: { token: 'secret-token' } })._text);
  assert.strictEqual(stored.state.food.length, 1);
  assert.strictEqual(stored.state.workouts[0].name, 'Gym 1 (edited)');
});

test('Code.gs doPost with only a tombstone deletes the stored row', function () {
  var existing = [
    ['id', 'collection', 'date', 'updatedAt', 'deleted', 'json'],
    ['wo1', 'workouts', '2026-11-02', '2026-11-02T23:00:00.000Z', 'FALSE', JSON.stringify({ id: 'wo1', type: 'walk' })]
  ];
  installMocks({ token: 'secret-token', rows: existing });
  var code = loadCodeGs();
  var posted = JSON.parse(code.doPost({
    postData: { contents: JSON.stringify({
      token: 'secret-token',
      records: [{ id: 'wo1', collection: 'workouts', date: '2026-11-02', updatedAt: '2026-11-09T12:00:00.000Z', deleted: true, data: null }]
    }) }
  })._text);
  assert.strictEqual(posted.ok, true);
  assert.strictEqual(posted.state.workouts.length, 0);
  assert.ok(posted.records.some(function (r) { return r.id === 'wo1' && r.deleted; }));
});

if (failed) {
  console.error('\n' + failed + ' test(s) failed');
  process.exit(1);
}
console.log('\nAll tests passed');
