/**
 * N1C requirements review board: Google Apps Script backend.
 *
 * Paste this whole file into Extensions > Apps Script in your Google Sheet,
 * run `setup` once, then deploy as a web app (see README.md).
 *
 * Tabs it uses:
 *   Requirements  - you maintain this (one row per requirement)
 *   Reviewers     - you maintain this (name + individual access code)
 *   Reviews       - written by the board: each reviewer's current position on each card
 *   Log           - written by the board: every change, append-only
 *   Suggestions   - written by the board: missing requirements; you fill in Triage
 *   Summary       - built on demand from the "Review board" menu
 */

var TABS = {
  Requirements: ['ID', 'Requirement', 'Workflow', 'Actor', 'Category', 'Reason', 'Also involves', 'Open question', 'Decision'],
  Reviewers: ['Name', 'Code', 'Active'],
  Reviews: ['Reviewer', 'ID', 'Status', 'Suggested category', 'Comment', 'Updated'],
  Log: ['Timestamp', 'Reviewer', 'ID', 'Status', 'Suggested category', 'Comment'],
  Suggestions: ['Timestamp', 'Reviewer', 'Requirement', 'Workflow', 'Actor', 'Suggested category', 'Why', 'Triage', 'Triage note']
};
var STATUSES = ['approved', 'moved', 'commented', 'view', 'cleared'];
var CATEGORIES = ['MVP', 'Later', 'Out of Scope', 'Needs N1C Decision'];

// ---------- menu and setup ----------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Review board')
    .addItem('Set up tabs', 'setup')
    .addItem('Refresh summary', 'refreshSummary')
    .addToUi();
}

/** Creates any missing tabs with their headers. Safe to run more than once. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      var blank = ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() === 0 && ss.getSheets()[0].getName().indexOf('Sheet') === 0;
      sh = blank ? ss.getSheets()[0].setName(name) : ss.insertSheet(name);
    }
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  var req = ss.getSheetByName('Requirements');
  var catCol = TABS.Requirements.indexOf('Category') + 1;
  req.getRange(2, catCol, Math.max(req.getMaxRows() - 1, 1), 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(CATEGORIES, true).setAllowInvalid(true).build());
}

// ---------- web app ----------

function doGet() {
  return json({ ok: true, service: 'n1c-review-board' });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var reviewer = authenticate(body.code);
    if (!reviewer) return json({ ok: false, error: 'invalid_code' });
    if (body.action === 'load') return json(loadState(reviewer));
    if (body.action === 'review') return json(saveReview(reviewer, body));
    if (body.action === 'suggest') return json(saveSuggestion(reviewer, body));
    return json({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- helpers ----------

function table(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Missing tab: ' + name + '. Run Review board > Set up tabs.');
  var values = sh.getDataRange().getValues();
  var head = (values.shift() || []).map(function (h) { return String(h).trim(); });
  return {
    sheet: sh, head: head, rows: values,
    col: function (n) { return head.indexOf(n); },
    get: function (row, n) { var i = head.indexOf(n); return i < 0 ? '' : row[i]; }
  };
}

function text(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}

/** Stops comments being read as spreadsheet formulas. */
function safe(v) {
  var s = String(v == null ? '' : v).slice(0, 2000);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function activeReviewers() {
  var t = table('Reviewers');
  return t.rows.filter(function (r) {
    var active = String(t.get(r, 'Active')).trim().toUpperCase();   // blank or anything except FALSE/NO = active
    return text(t.get(r, 'Name')) && text(t.get(r, 'Code')) && active !== 'FALSE' && active !== 'NO';
  }).map(function (r) { return { name: text(t.get(r, 'Name')), code: text(t.get(r, 'Code')) }; });
}

function authenticate(code) {
  code = String(code || '').trim();
  if (!code) return null;
  var list = activeReviewers();
  for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i].name;
  return null;
}

function requirementIds() {
  var t = table('Requirements'), ids = {};
  t.rows.forEach(function (r) { var id = text(t.get(r, 'ID')); if (id) ids[id] = text(t.get(r, 'Category')); });
  return ids;
}

// ---------- actions ----------

function loadState(reviewer) {
  var R = table('Requirements');
  var requirements = R.rows.filter(function (r) { return text(R.get(r, 'ID')) && text(R.get(r, 'Requirement')); }).map(function (r) {
    return {
      id: text(R.get(r, 'ID')), requirement: text(R.get(r, 'Requirement')), workflow: text(R.get(r, 'Workflow')),
      actor: text(R.get(r, 'Actor')), category: text(R.get(r, 'Category')), reason: text(R.get(r, 'Reason')),
      involves: text(R.get(r, 'Also involves')), question: text(R.get(r, 'Open question')), decision: text(R.get(r, 'Decision'))
    };
  });

  var V = table('Reviews'), mine = {}, views = {};
  V.rows.forEach(function (r) {
    var who = text(V.get(r, 'Reviewer')), id = text(V.get(r, 'ID')), status = text(V.get(r, 'Status'));
    if (!who || !id || !status) return;
    var entry = { status: status, to: text(V.get(r, 'Suggested category')), comment: text(V.get(r, 'Comment')) };
    if (who === reviewer) mine[id] = entry;
    // Only views on "Needs N1C Decision" items are shared between reviewers.
    if (status === 'view') (views[id] = views[id] || []).push({ reviewer: who, view: entry.to, comment: entry.comment });
  });

  var G = table('Suggestions');
  var suggestions = G.rows.filter(function (r) { return text(G.get(r, 'Requirement')); }).map(function (r) {
    return {
      reviewer: text(G.get(r, 'Reviewer')), requirement: text(G.get(r, 'Requirement')), workflow: text(G.get(r, 'Workflow')),
      actor: text(G.get(r, 'Actor')), category: text(G.get(r, 'Suggested category')), why: text(G.get(r, 'Why')),
      triage: text(G.get(r, 'Triage')), note: text(G.get(r, 'Triage note'))
    };
  });

  return { ok: true, reviewer: reviewer, reviewerCount: activeReviewers().length, requirements: requirements, mine: mine, views: views, suggestions: suggestions };
}

function saveReview(reviewer, b) {
  var id = String(b.id || '').trim();
  var status = String(b.status || '').trim();
  var to = String(b.to || '').trim();
  var comment = String(b.comment || '').trim();
  var ids = requirementIds();
  if (!(id in ids)) return { ok: false, error: 'unknown_requirement' };
  if (STATUSES.indexOf(status) < 0) return { ok: false, error: 'bad_status' };
  if (to && CATEGORIES.indexOf(to) < 0) return { ok: false, error: 'bad_category' };
  if (status === 'moved' && (!to || !comment)) return { ok: false, error: 'move_needs_reason' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var V = table('Reviews'), iR = V.col('Reviewer'), iI = V.col('ID'), found = -1;
    for (var i = 0; i < V.rows.length; i++) {
      if (text(V.rows[i][iR]) === reviewer && text(V.rows[i][iI]) === id) { found = i; break; }
    }
    var now = new Date();
    if (status === 'cleared') {
      if (found >= 0) V.sheet.deleteRow(found + 2);
    } else {
      var row = [safe(reviewer), safe(id), status, to, safe(comment), now];
      if (found >= 0) V.sheet.getRange(found + 2, 1, 1, row.length).setValues([row]);
      else V.sheet.appendRow(row);
    }
    table('Log').sheet.appendRow([now, safe(reviewer), safe(id), status, to, safe(comment)]);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

function saveSuggestion(reviewer, b) {
  var req = String(b.requirement || '').trim();
  if (!req) return { ok: false, error: 'missing_requirement' };
  var cat = CATEGORIES.indexOf(String(b.category || '')) >= 0 ? b.category : '';
  table('Suggestions').sheet.appendRow([new Date(), safe(reviewer), safe(req), safe(b.workflow), safe(b.actor), cat, safe(b.why), '', '']);
  return { ok: true };
}

// ---------- summary for you ----------

/** Builds a Summary tab: one row per requirement, one column per reviewer, plus an agreement flag. */
function refreshSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var R = table('Requirements'), V = table('Reviews');
  var reviewers = activeReviewers().map(function (r) { return r.name; });
  var byKey = {};
  V.rows.forEach(function (r) {
    byKey[text(V.get(r, 'Reviewer')) + '|' + text(V.get(r, 'ID'))] = {
      status: text(V.get(r, 'Status')), to: text(V.get(r, 'Suggested category')), comment: text(V.get(r, 'Comment'))
    };
  });

  var head = ['ID', 'Requirement', 'Workflow', 'Proposed', 'Decision', 'Agreement'];
  reviewers.forEach(function (n) { head.push(n, n + ' comment'); });
  var out = [head];

  R.rows.forEach(function (r) {
    var id = text(R.get(r, 'ID')); if (!id) return;
    var cat = text(R.get(r, 'Category'));
    var cells = [], moved = 0, approved = 0, reviewed = 0, views = {};
    reviewers.forEach(function (n) {
      var e = byKey[n + '|' + id];
      if (!e) { cells.push('Not reviewed', ''); return; }
      reviewed++;
      if (e.status === 'approved') approved++;
      if (e.status === 'moved') moved++;
      if (e.status === 'view' && e.to) views[e.to] = 1;
      var label = { approved: 'Approved', moved: 'Moved to ' + e.to, commented: 'Commented', view: 'View: ' + (e.to || 'none') }[e.status] || e.status;
      cells.push(label, e.comment);
    });
    var agreement;
    if (cat === 'Needs N1C Decision') agreement = text(R.get(r, 'Decision')) ? 'Decided' : (Object.keys(views).length > 1 ? 'Views differ' : 'For discussion');
    else if (moved) agreement = 'Disagreement';
    else if (reviewed < reviewers.length) agreement = 'Incomplete';
    else if (approved === reviewers.length) agreement = 'All approved';
    else agreement = 'Reviewed, check comments';
    out.push([id, text(R.get(r, 'Requirement')), text(R.get(r, 'Workflow')), cat, text(R.get(r, 'Decision')), agreement].concat(cells));
  });

  var sh = ss.getSheetByName('Summary') || ss.insertSheet('Summary');
  sh.clear();
  sh.getRange(1, 1, out.length, head.length).setValues(out);
  sh.getRange(1, 1, 1, head.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);
  var colours = { 'Disagreement': '#FCE8D6', 'Views differ': '#FCE8D6', 'All approved': '#E6F3EA', 'Incomplete': '#F1F0EC' };
  for (var i = 1; i < out.length; i++) {
    var c = colours[out[i][5]];
    if (c) sh.getRange(i + 1, 6).setBackground(c);
  }
  sh.autoResizeColumns(1, 1);
  sh.setColumnWidth(2, 360);
}
