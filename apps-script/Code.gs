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
 *   Suggestions   - written by the board: missing requirements; you fill in Decision
 *   Suggestion comments - written by the board: reviewers' comments on suggestions
 *   Summary       - built on demand from the "Review board" menu
 */

var TABS = {
  Requirements: ['ID', 'Requirement', 'Workflow', 'Actor', 'Category', 'Reason', 'Also involves', 'Open question', 'Decision', 'Decision date', 'Decision rationale'],
  Reviewers: ['Name', 'Code', 'Active', 'Role'],
  Reviews: ['Reviewer', 'ID', 'Status', 'Suggested category', 'Comment', 'Updated'],
  Log: ['Timestamp', 'Reviewer', 'ID', 'Status', 'Suggested category', 'Comment'],
  Suggestions: ['Timestamp', 'Reviewer', 'Requirement', 'Workflow', 'Actor', 'Suggested category', 'Why', 'Decision', 'Decision note', 'ID'],
  'Suggestion comments': ['Timestamp', 'Suggestion', 'Reviewer', 'Comment', 'ID']
};
// agreed = agrees with the placement; clarify = can't judge it as written; approved = older name for agreed.
var STATUSES = ['agreed', 'approved', 'moved', 'commented', 'clarify', 'view', 'cleared'];
// Columns added after the first version: created automatically at the end of the tab if missing.
var ADDED_COLUMNS = { Requirements: ['Decision date', 'Decision rationale'], Reviewers: ['Role'], Suggestions: ['ID'], 'Suggestion comments': ['ID'] };
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
    var who = authenticate(body.code);
    if (!who) return json({ ok: false, error: 'invalid_code' });
    var reviewer = who.name;
    if (body.action === 'load') {
      // Record visits (signing in, or reopening the page while still signed in); the Refresh button doesn't count.
      if (body.signin) table('Log').sheet.appendRow([new Date(), safe(reviewer), '', 'signed in', '', '']);
      return json(loadState(reviewer, who.owner));
    }
    if (body.action === 'signout') {
      table('Log').sheet.appendRow([new Date(), safe(reviewer), '', 'signed out', '', '']);
      return json({ ok: true });
    }
    if (body.action === 'review') return json(saveReview(reviewer, body));
    if (body.action === 'suggest') return json(saveSuggestion(reviewer, body));
    if (body.action === 'editSuggestion') return json(editSuggestion(reviewer, body, false));
    if (body.action === 'withdrawSuggestion') return json(editSuggestion(reviewer, body, true));
    if (body.action === 'commentSuggestion') return json(commentSuggestion(reviewer, body));
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
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(name);
  if (!sh && name === 'Suggestion comments') {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  if (!sh) throw new Error('Missing tab: ' + name + '. Run Review board > Set up tabs.');
  if (ADDED_COLUMNS[name]) {
    var head0 = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(function (h) { return String(h).trim(); });
    var missing = ADDED_COLUMNS[name].filter(function (h) { return head0.indexOf(h) < 0; });
    if (missing.length) sh.getRange(1, head0.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
  }
  var values = sh.getDataRange().getValues();
  var head = (values.shift() || []).map(function (h) { return String(h).trim(); });
  return {
    sheet: sh, head: head, rows: values,
    col: function (n) { return head.indexOf(n); },
    get: function (row, n) { var i = head.indexOf(n); return i < 0 ? '' : row[i]; },
    // Appends a row given as { header: value }, so column order in the sheet doesn't matter.
    append: function (obj) { sh.appendRow(head.map(function (h) { return h in obj ? obj[h] : ''; })); }
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
  }).map(function (r) {
    // Role "Owner" can sign in (e.g. to test or watch progress) but is not counted as a reviewer.
    return { name: text(t.get(r, 'Name')), code: text(t.get(r, 'Code')), owner: text(t.get(r, 'Role')).toLowerCase() === 'owner' };
  });
}

function reviewerNames() {
  return activeReviewers().filter(function (r) { return !r.owner; }).map(function (r) { return r.name; });
}

function ownerNames() {
  var o = {};
  activeReviewers().forEach(function (r) { if (r.owner) o[r.name] = 1; });
  return o;
}

function authenticate(code) {
  code = String(code || '').trim();
  if (!code) return null;
  var list = activeReviewers();
  for (var i = 0; i < list.length; i++) {
    if (list[i].code !== code) continue;
    // Feedback is stored under the reviewer's name, so two active reviewers must not share one.
    var same = list.filter(function (r) { return r.name === list[i].name; }).length;
    if (same > 1) throw new Error('Two active reviewers are both called "' + list[i].name + '". Give each a different name in the Reviewers tab.');
    return list[i];
  }
  return null;
}

function requirementIds() {
  var t = table('Requirements'), ids = {};
  t.rows.forEach(function (r) { var id = text(t.get(r, 'ID')); if (id) ids[id] = { category: text(t.get(r, 'Category')), decision: text(t.get(r, 'Decision')) }; });
  return ids;
}

/** Client-generated IDs make retries safe: the same ID twice means the same operation. */
function validId(v) { v = String(v || ''); return /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : ''; }

// ---------- actions ----------

function loadState(reviewer, isOwner) {
  var R = table('Requirements');
  var requirements = R.rows.filter(function (r) { return text(R.get(r, 'ID')) && text(R.get(r, 'Requirement')); }).map(function (r) {
    return {
      id: text(R.get(r, 'ID')), requirement: text(R.get(r, 'Requirement')), workflow: text(R.get(r, 'Workflow')),
      actor: text(R.get(r, 'Actor')), category: text(R.get(r, 'Category')), reason: text(R.get(r, 'Reason')),
      involves: text(R.get(r, 'Also involves')), question: text(R.get(r, 'Open question')), decision: text(R.get(r, 'Decision')),
      decisionDate: text(R.get(r, 'Decision date')), decisionRationale: text(R.get(r, 'Decision rationale'))
    };
  });

  var V = table('Reviews'), mine = {}, views = {}, owners = ownerNames();
  V.rows.forEach(function (r) {
    var who = text(V.get(r, 'Reviewer')), id = text(V.get(r, 'ID')), status = text(V.get(r, 'Status'));
    if (!who || !id || !status) return;
    var entry = { status: status, to: text(V.get(r, 'Suggested category')), comment: text(V.get(r, 'Comment')) };
    if (who === reviewer) mine[id] = entry;
    // Only views on "Needs N1C Decision" items are shared between reviewers.
    if (status === 'view' && !owners[who]) (views[id] = views[id] || []).push({ reviewer: who, view: entry.to, comment: entry.comment });
  });

  var C = table('Suggestion comments'), comments = {};
  C.rows.forEach(function (r) {
    var k = text(C.get(r, 'Suggestion')).replace(/^'/, ''); if (!k || !text(C.get(r, 'Comment'))) return;
    (comments[k] = comments[k] || []).push({ reviewer: text(C.get(r, 'Reviewer')), comment: text(C.get(r, 'Comment')) });
  });
  var G = table('Suggestions');
  var suggestions = G.rows.filter(function (r) { return text(G.get(r, 'Requirement')); }).map(function (r) {
    var key = suggestionId(G, r);
    return {
      key: key, comments: comments[key] || [],
      reviewer: text(G.get(r, 'Reviewer')), requirement: text(G.get(r, 'Requirement')), workflow: text(G.get(r, 'Workflow')),
      actor: text(G.get(r, 'Actor')), category: text(G.get(r, 'Suggested category')), why: text(G.get(r, 'Why')),
      // "Decision" columns; older sheets may still call them "Triage".
      triage: text(G.get(r, 'Decision') || G.get(r, 'Triage')), note: text(G.get(r, 'Decision note') || G.get(r, 'Triage note'))
    };
  });

  return { ok: true, reviewer: reviewer, isOwner: !!isOwner, reviewerCount: reviewerNames().length, requirements: requirements, mine: mine, views: views, suggestions: suggestions };
}

function saveReview(reviewer, b) {
  var id = String(b.id || '').trim();
  var status = String(b.status || '').trim();
  var to = String(b.to || '').trim();
  var comment = String(b.comment || '').trim();
  var ids = requirementIds();
  if (!(id in ids)) return { ok: false, error: 'unknown_requirement' };
  if (ids[id].decision) return { ok: false, error: 'already_decided' };   // decided items are locked
  // N1C items take a view; other items are agreed with, moved, questioned or commented on.
  var isN = ids[id].category === 'Needs N1C Decision';
  if (isN && ['agreed', 'approved', 'moved', 'clarify'].indexOf(status) >= 0) return { ok: false, error: 'not_allowed' };
  if (!isN && status === 'view') return { ok: false, error: 'not_allowed' };
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
    if (found >= 0) {
      var cur = V.rows[found];
      var unchanged = text(cur[V.col('Status')]) === status && text(cur[V.col('Suggested category')]) === to && text(cur[V.col('Comment')]) === comment;
      if (unchanged) return { ok: true, unchanged: true };   // same as before: nothing to save or log
    } else if (status === 'cleared') {
      return { ok: true, unchanged: true };
    }
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
  var id = validId(b.id) || Utilities.getUuid();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
  var G = table('Suggestions');
  if (findSuggestion(G, id) >= 0) return { ok: true, key: id, duplicate: true };   // a retry of something already saved
  G.append({ 'Timestamp': new Date(), 'Reviewer': safe(reviewer), 'Requirement': safe(req), 'Workflow': safe(b.workflow),
    'Actor': safe(b.actor), 'Suggested category': cat, 'Why': safe(b.why), 'ID': id });
  } finally {
    lock.releaseLock();
  }
  return { ok: true, key: id };
}

/** A suggestion's unique ID. Rows from before IDs existed fall back to their timestamp (to the second). */
function suggestionId(G, row) {
  var id = text(G.get(row, 'ID'));
  if (id) return id;
  var v = G.get(row, 'Timestamp');
  return v && typeof v.getTime === 'function' ? String(Math.round(v.getTime() / 1000)) : '';
}

function findSuggestion(G, key) {
  for (var i = 0; i < G.rows.length; i++) if (key && suggestionId(G, G.rows[i]) === key) return i;
  return -1;
}

/** Lets a reviewer change or withdraw their own suggestion, until it has a decision. */
function editSuggestion(reviewer, b, withdraw) {
  var key = String(b.key || '');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var G = table('Suggestions'), at = findSuggestion(G, key);
    if (at < 0 && withdraw) return { ok: true };   // already withdrawn (e.g. a retry)
    if (at < 0 || text(G.get(G.rows[at], 'Reviewer')) !== reviewer) return { ok: false, error: 'not_found' };
    if (text(G.get(G.rows[at], 'Decision') || G.get(G.rows[at], 'Triage'))) return { ok: false, error: 'already_decided' };
    var log = table('Log').sheet;
    if (withdraw) {
      log.appendRow([new Date(), safe(reviewer), '', 'suggestion withdrawn', '', safe(G.get(G.rows[at], 'Requirement'))]);
      G.sheet.deleteRow(at + 2);
      return { ok: true };
    }
    var req = String(b.requirement || '').trim();
    if (!req) return { ok: false, error: 'missing_requirement' };
    var cat = CATEGORIES.indexOf(String(b.category || '')) >= 0 ? b.category : '';
    var c0 = G.col('Requirement') + 1;   // Requirement, Workflow, Actor, Suggested category, Why are next to each other
    G.sheet.getRange(at + 2, c0, 1, 5).setValues([[safe(req), safe(b.workflow), safe(b.actor), cat, safe(b.why)]]);
    log.appendRow([new Date(), safe(reviewer), '', 'suggestion edited', cat, safe(req)]);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function commentSuggestion(reviewer, b) {
  var key = String(b.key || ''), comment = String(b.comment || '').trim();
  if (!key || !comment) return { ok: false, error: 'missing_comment' };
  if (findSuggestion(table('Suggestions'), key) < 0) return { ok: false, error: 'not_found' };
  var cid = validId(b.id);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var C = table('Suggestion comments');
    if (cid && C.rows.some(function (r) { return text(C.get(r, 'ID')) === cid; })) return { ok: true, duplicate: true };
    C.append({ 'Timestamp': new Date(), 'Suggestion': /^\d+$/.test(key) ? "'" + key : key, 'Reviewer': safe(reviewer), 'Comment': safe(comment), 'ID': cid });
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

// ---------- summary for you ----------

/** Builds a Summary tab: one row per requirement, one column per reviewer, plus an agreement flag. */
function refreshSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var R = table('Requirements'), V = table('Reviews');
  var reviewers = reviewerNames();
  var byKey = {};
  V.rows.forEach(function (r) {
    byKey[text(V.get(r, 'Reviewer')) + '|' + text(V.get(r, 'ID'))] = {
      status: text(V.get(r, 'Status')), to: text(V.get(r, 'Suggested category')), comment: text(V.get(r, 'Comment'))
    };
  });

  var head = ['ID', 'Requirement', 'Workflow', 'Proposed', 'Decision', 'Reviewed', 'Outcome', 'Questions'];
  reviewers.forEach(function (n) { head.push(n, n + ' comment'); });
  var out = [head];

  R.rows.forEach(function (r) {
    var id = text(R.get(r, 'ID')); if (!id) return;
    var cat = text(R.get(r, 'Category')), isN = cat === 'Needs N1C Decision', decision = text(R.get(r, 'Decision'));
    var cells = [], positions = [], questions = 0;
    reviewers.forEach(function (n) {
      var e = byKey[n + '|' + id];
      if (!e) { cells.push('Not reviewed', ''); return; }
      var st = e.status === 'approved' ? 'agreed' : e.status;
      // A position is where the reviewer thinks it belongs; comments and questions aren't positions.
      if (st === 'agreed') positions.push(cat);
      else if (st === 'moved' && e.to) positions.push(e.to);
      else if (st === 'view' && e.to) positions.push(e.to);
      if (st === 'clarify') questions++;
      var label = { agreed: 'Agrees', moved: 'Moved to ' + e.to, commented: 'Comment only', clarify: 'Needs clarification', view: e.to ? 'View: ' + e.to : 'Note only' }[st] || st;
      cells.push(label, e.comment);
    });
    var distinct = positions.filter(function (p, i) { return positions.indexOf(p) === i; });
    var outcome;
    if (decision) outcome = 'Decided: ' + decision;
    else if (positions.length < reviewers.length) outcome = 'Incomplete';
    else if (distinct.length > 1) outcome = 'Reviewers disagree';
    else if (isN) outcome = 'All favour ' + distinct[0];
    else if (distinct[0] === cat) outcome = 'All agree';
    else outcome = 'All suggest ' + distinct[0];
    out.push([id, text(R.get(r, 'Requirement')), text(R.get(r, 'Workflow')), cat, decision,
      positions.length + ' of ' + reviewers.length, outcome, questions || ''].concat(cells));
  });

  var sh = ss.getSheetByName('Summary') || ss.insertSheet('Summary');
  sh.clear();
  sh.getRange(1, 1, out.length, head.length).setValues(out);
  sh.getRange(1, 1, 1, head.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);
  for (var i = 1; i < out.length; i++) {
    var o = String(out[i][6]);
    var c = o === 'All agree' ? '#E6F3EA' : o === 'Reviewers disagree' ? '#FCE8D6' : o.indexOf('All suggest') === 0 ? '#E8EEFB' : o === 'Incomplete' ? '#F1F0EC' : '';
    if (c) sh.getRange(i + 1, 7).setBackground(c);
  }
  sh.autoResizeColumns(1, 1);
  sh.setColumnWidth(2, 360);
}
