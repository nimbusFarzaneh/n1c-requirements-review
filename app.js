(function () {
  'use strict';

  var CFG = window.REVIEW_CONFIG || {};
  var N1C = 'Needs N1C Decision';
  var COLS = [
    { key: 'MVP', blurb: 'Needed for first release', color: '#2B52C4' },
    { key: 'Later', blurb: 'Planned after launch', color: '#7A5BB5' },
    { key: 'Out of Scope', blurb: 'Not part of this build', color: '#6B6A64' },
    { key: N1C, blurb: 'Settled by discussion. Add your view.', color: '#B85E14' }
  ];
  var CATS = COLS.map(function (c) { return c.key; });
  var FILTERS = [
    { key: 'open', label: 'Everything open' },
    { key: 'todo', label: 'Not yet reviewed' },
    { key: 'moved', label: 'Moved by me' },
    { key: 'commented', label: 'With my comments' },
    { key: 'approved', label: 'Approved by me' }
  ];
  var GROUP_AT = 12;   // group a column by workflow once it has more open cards than this
  var GROUP_SHOW = 6;  // cards shown per group before "Show more"
  var STORE_KEY = 'n1c-review-code';

  var S = {
    demo: !CFG.scriptUrl,
    code: null, reviewer: '', isOwner: false, reviewerCount: 3,
    reqs: [], mine: {}, views: {}, suggestions: [],
    filter: 'open', workflow: '',
    pileOpen: {}, groupShow: {}, viewsOpen: {}, mobileCol: 'MVP'
  };

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function normCat(v) {
    var s = String(v || '').trim().toLowerCase();
    if (s === 'mvp') return 'MVP';
    if (s === 'later') return 'Later';
    if (s === 'out of scope' || s === 'out-of-scope' || s === 'oos') return 'Out of Scope';
    if (s.indexOf('n1c') >= 0 || s.indexOf('discussion') >= 0 || s.indexOf('decision') >= 0) return N1C;
    return '';
  }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  var CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"></path></svg>';

  function byId(id) { for (var i = 0; i < S.reqs.length; i++) if (S.reqs[i].id === id) return S.reqs[i]; return null; }
  function mine(r) { return S.mine[r.id] || null; }
  function status(r) { var m = mine(r); return m ? m.status : ''; }
  function eff(r) { var m = mine(r); return (m && m.status === 'moved' && m.to) ? m.to : r.category; }
  function isDecided(r) { return r.category === N1C && String(r.decision || '').trim() !== ''; }
  function reviewable(r) { return !isDecided(r); }
  function isReviewed(r) { return !!status(r); }

  // ---------- API ----------
  function api(body) {
    if (S.demo) return demoApi(body);
    return fetch(CFG.scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      if (!data || !data.ok) { var e = new Error((data && data.error) || 'error'); e.code = data && data.error; throw e; }
      return data;
    });
  }

  var queue = Promise.resolve(), pending = 0, failed = [];
  function save(body, onDone) {
    pending++; setSave('busy');
    var payload = Object.assign({ code: S.code }, body);
    queue = queue.then(function () { return api(payload); }).then(function (res) {
      pending--; if (!pending) setSave(failed.length ? 'err' : 'ok');
      if (onDone) onDone(res);
    }, function (e) {
      pending--;
      if (e && e.code === 'already_decided') { toast('That suggestion already has a decision, so it can\u2019t be changed.'); refresh(); return; }
      failed.push(payload); setSave('err');
    });
  }
  function retry() {
    var list = failed; failed = [];
    list.forEach(function (p) { var b = Object.assign({}, p); delete b.code; save(b); });
  }
  function setSave(state) {
    var el = $('saveState');
    el.className = 'pill ' + state;
    if (state === 'busy') el.textContent = 'Saving…';
    else if (state === 'ok') el.textContent = S.demo ? 'Demo: not saved' : 'All changes saved';
    else el.innerHTML = 'Couldn’t save. <button type="button" class="linkbtn" data-act="retry" style="min-height:0;padding:0">Retry</button>';
  }

  // ---------- state changes ----------
  function same(a, b) {
    if (!a || !b) return !a && !b;
    return a.status === b.status && (a.to || '') === (b.to || '') && (a.comment || '') === (b.comment || '');
  }
  function setMine(id, entry) {
    if (same(S.mine[id] || null, entry || null)) return;   // nothing changed: don't save or log
    if (entry) S.mine[id] = entry; else delete S.mine[id];
    renderAll();
    save({ action: 'review', id: id, status: entry ? entry.status : 'cleared', to: entry && entry.to || '', comment: entry && entry.comment || '' });
  }
  function copy(o) { return o ? Object.assign({}, o) : null; }

  function approve(id) {
    var r = byId(id); if (!r) return;
    var prev = copy(S.mine[id]);
    setMine(id, { status: 'approved', to: '', comment: prev && prev.comment || '' });
    toast('Approved ' + r.id + '. It\u2019s now in the approved pile.', function () { setMine(id, prev); });
  }
  function unapprove(id) {
    var m = S.mine[id];
    setMine(id, m && m.comment ? { status: 'commented', to: '', comment: m.comment } : null);
  }
  function undoMove(id) {
    var m = S.mine[id];
    setMine(id, m && m.comment ? { status: 'commented', to: '', comment: m.comment } : null);
  }
  function requestMove(id, to) {
    var r = byId(id); if (!r || r.category === N1C) return;
    if (to === eff(r)) return;
    if (to === r.category) { undoMove(id); return; }
    openMove(id, to);
  }
  function setView(id, cat) {
    var m = S.mine[id];
    setMine(id, { status: 'view', to: cat, comment: m && m.comment || '' });
  }

  // ---------- rendering ----------
  function renderAll() { renderHeader(); renderFilters(); renderBoard(); renderSuggestions(); }

  function renderHeader() {
    var pool = S.reqs.filter(reviewable);
    var done = pool.filter(isReviewed).length;
    $('progText').textContent = done + ' of ' + pool.length;
    $('progBar').style.width = (pool.length ? Math.round(done / pool.length * 100) : 0) + '%';
  }

  function renderFilters() {
    var pool = S.reqs.filter(reviewable);
    var counts = {
      open: pool.filter(function (r) { return status(r) !== 'approved'; }).length,
      todo: pool.filter(function (r) { return !status(r); }).length,
      moved: pool.filter(function (r) { return status(r) === 'moved'; }).length,
      commented: pool.filter(function (r) { return mine(r) && mine(r).comment; }).length,
      approved: pool.filter(function (r) { return status(r) === 'approved'; }).length
    };
    $('filters').innerHTML = FILTERS.map(function (f) {
      return '<button type="button" class="chip" data-act="filter" data-f="' + f.key + '" aria-pressed="' + (S.filter === f.key) + '">' + esc(f.label) + ' (' + counts[f.key] + ')</button>';
    }).join('');
    var wfs = {};
    S.reqs.forEach(function (r) { wfs[r.workflow || 'Other'] = 1; });
    var list = Object.keys(wfs).sort();
    $('wfSel').innerHTML = '<option value="">Workflow: All</option>' + list.map(function (w) {
      return '<option value="' + esc(w) + '"' + (S.workflow === w ? ' selected' : '') + '>' + esc(w) + '</option>';
    }).join('');
  }

  function passFilter(r) {
    if (S.workflow && (r.workflow || 'Other') !== S.workflow) return false;
    var st = status(r), m = mine(r);
    if (S.filter === 'todo') return !st;
    if (S.filter === 'moved') return st === 'moved';
    if (S.filter === 'commented') return !!(m && m.comment);
    if (S.filter === 'approved') return st === 'approved';
    return st !== 'approved';
  }

  function renderBoard() {
    var tabs = [];
    var html = COLS.map(function (col) {
      var all = S.reqs.filter(function (r) { return eff(r) === col.key; });
      var decided = all.filter(isDecided);
      var live = all.filter(reviewable);
      var approved = live.filter(function (r) { return status(r) === 'approved'; });
      var open = live.filter(function (r) { return status(r) !== 'approved'; });
      var left = open.filter(function (r) { return !status(r); }).length;
      var shown = (S.filter === 'approved' || S.filter === 'commented' ? live : open).filter(passFilter);
      var isN = col.key === N1C;

      tabs.push('<button type="button" class="coltab" role="tab" data-act="coltab" data-col="' + esc(col.key) + '" style="--c:' + col.color + '" aria-selected="' + (S.mobileCol === col.key) + '"><b>' + esc(col.key === N1C ? 'N1C decision' : col.key) + '</b><span>' + (isN ? open.length + ' open' : left + ' left') + '</span></button>');
      var h = '<section class="colm' + (S.mobileCol === col.key ? ' on' : '') + '" data-col="' + esc(col.key) + '" style="--c:' + col.color + '" aria-label="' + esc(col.key) + '">';
      h += '<div class="colm-h"><h2>' + esc(col.key) + '</h2><span>' +
        (isN ? open.length + ' open · ' + all.length + ' total' : left + ' to review · ' + live.length + ' total') + '</span></div>';
      h += '<p class="blurb">' + esc(col.blurb) + '</p>';
      if (!isN) h += '<div class="dropzone">Drop here to move to ' + esc(col.key) + '</div>';

      if (!shown.length) {
        h += '<p class="empty">' + (S.filter === 'approved' ? (isN ? 'These are settled by discussion, not approved.' : 'You haven\u2019t approved anything here yet.') : open.length ? 'Nothing here matches this filter.' : (approved.length ? 'All done here.' : 'No items.')) + '</p>';
      } else if (shown.length > GROUP_AT) {
        var groups = {};
        shown.forEach(function (r) { var w = r.workflow || 'Other'; (groups[w] = groups[w] || []).push(r); });
        Object.keys(groups).sort().forEach(function (w) {
          var inCol = live.filter(function (r) { return (r.workflow || 'Other') === w; });
          var gLeft = inCol.filter(function (r) { return !status(r); }).length;
          var key = col.key + '|' + w;
          var limit = S.groupShow[key] || GROUP_SHOW;
          var items = groups[w];
          h += '<div class="grp-h"><h3>' + esc(w) + '</h3><span>' + gLeft + ' of ' + inCol.length + ' left</span></div>';
          items.slice(0, limit).forEach(function (r) { h += card(r, true); });
          if (items.length > limit) {
            h += '<button type="button" class="more" data-act="more" data-key="' + esc(key) + '">Show ' + (items.length - limit) + ' more in ' + esc(w) + '</button>';
          }
        });
      } else {
        shown.forEach(function (r) { h += card(r, false); });
      }

      if (!isN && approved.length && S.filter !== 'approved') {
        var po = !!S.pileOpen[col.key];
        h += '<button type="button" class="pile" data-act="pile" data-col="' + esc(col.key) + '" aria-expanded="' + po + '"><span>' + CHECK + approved.length + ' approved</span><b style="font-weight:500">' + (po ? 'Hide' : 'Show') + '</b></button>';
        if (po) approved.forEach(function (r) {
          var m = mine(r);
          h += '<div class="mini"><div class="row"><p>' + esc(r.requirement) + '</p><button type="button" class="linkbtn" data-act="unapprove" data-id="' + esc(r.id) + '">Undo</button></div>' +
            (m && m.comment ? '<p class="why">Your comment: ' + esc(m.comment) + '</p>' : '') + '</div>';
        });
      }
      if (isN && decided.length) {
        var dk = 'decided', dpo = !!S.pileOpen[dk];
        h += '<button type="button" class="pile dec" data-act="pile" data-col="' + dk + '" aria-expanded="' + dpo + '"><span>' + CHECK + decided.length + ' decided</span><b style="font-weight:500">' + (dpo ? 'Hide' : 'Show') + '</b></button>';
        if (dpo) decided.forEach(function (r) {
          h += '<div class="mini"><p>' + esc(r.requirement) + '</p><p class="why">Decided: ' + esc(r.decision) + '</p></div>';
        });
      }
      h += '</section>';
      return h;
    }).join('');
    $('board').innerHTML = html;
    $('coltabs').innerHTML = tabs.join('');
  }

  function card(r, grouped) {
    var m = mine(r), st = status(r), isN = r.category === N1C;
    var h = '<article class="card' + (st === 'moved' ? ' moved' : '') + '" data-id="' + esc(r.id) + '"' + (isN ? '' : ' draggable="true"') + '>';
    if (st === 'moved') h += '<span class="badge b-moved">You moved this: ' + esc(r.category) + ' → ' + esc(m.to) + '</span>';
    else if (st === 'commented') h += '<span class="badge b-comm">You commented</span>';
    else if (st === 'approved') h += '<span class="badge b-ok">You approved this</span>';
    h += '<p class="title">' + esc(r.requirement) + '</p>';
    h += '<div class="tags">' + (!grouped && r.workflow ? '<span class="tag">' + esc(r.workflow) + '</span>' : '') +
      (r.actor ? '<span class="tag">' + esc(r.actor) + '</span>' : '') + '<span class="rid">' + esc(r.id) + '</span></div>';
    if (r.reason) h += '<p class="why">' + (st === 'moved' ? 'Proposed: ' + esc(r.category) + '. ' : '') + 'Why: ' + esc(r.reason) + '</p>';
    if (r.question) h += '<p class="why">Open question: ' + esc(r.question) + '</p>';
    if (r.involves) h += '<p class="why">Also involves: ' + esc(r.involves) + '</p>';

    if (isN) return h + n1cBlock(r) + '</article>';

    if (m && m.comment) h += '<p class="mycomm">Your comment: ' + esc(m.comment) + '</p>';
    h += '<div class="foot">';
    if (st === 'moved') {
      h += '<button type="button" class="btn" data-act="undomove" data-id="' + esc(r.id) + '">Undo move</button>';
      h += '<button type="button" class="btn" data-act="comment" data-id="' + esc(r.id) + '">Edit reason</button>';
    } else if (st === 'approved') {
      h += '<button type="button" class="btn" data-act="unapprove" data-id="' + esc(r.id) + '">Undo approval</button>';
      h += '<button type="button" class="btn" data-act="comment" data-id="' + esc(r.id) + '">' + (m && m.comment ? 'Edit comment' : 'Comment') + '</button>';
    } else {
      h += '<button type="button" class="btn approve" data-act="approve" data-id="' + esc(r.id) + '">' + CHECK + 'Approve</button>';
      h += '<button type="button" class="btn" data-act="comment" data-id="' + esc(r.id) + '">' + (m && m.comment ? 'Edit comment' : 'Comment') + '</button>';
    }
    h += '<select class="movesel" data-act="move" data-id="' + esc(r.id) + '" aria-label="Move this card to another column"><option value="">Move to…</option>' +
      CATS.filter(function (c) { return c !== eff(r); }).map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('') + '</select>';
    h += '</div></article>';
    return h;
  }

  function n1cBlock(r) {
    var m = mine(r), myView = m && m.status === 'view' ? m.to : '';
    var others = (S.views[r.id] || []).filter(function (v) { return v.reviewer !== S.reviewer; });
    var weighed = others.length + (m && !S.isOwner ? 1 : 0);
    var open = !!S.viewsOpen[r.id];
    var h = '<div class="views"><p class="views-h">Your view before the discussion</p><div class="vchips">';
    ['MVP', 'Later', 'Out of Scope'].forEach(function (c) {
      h += '<button type="button" class="vchip" data-act="view" data-id="' + esc(r.id) + '" data-cat="' + esc(c) + '" aria-pressed="' + (myView === c) + '">' + esc(c) + '</button>';
    });
    h += '</div>';
    if (m && m.comment) h += '<p class="mycomm">Your note: ' + esc(m.comment) + '</p>';
    h += '<button type="button" class="btn" data-act="note" data-id="' + esc(r.id) + '" style="align-self:flex-start">' + (m && m.comment ? 'Edit note' : 'Add a note') + '</button>';
    h += '<div class="vmeta"><span>' + weighed + ' of ' + S.reviewerCount + ' reviewers have weighed in</span>' +
      (others.length ? '<button type="button" class="linkbtn" data-act="views" data-id="' + esc(r.id) + '" aria-expanded="' + open + '">' + (open ? 'Hide views' : 'See views') + '</button>' : '') + '</div>';
    if (open && others.length) {
      h += '<ul class="others">' + others.map(function (v) {
        return '<li><b style="font-weight:500">' + esc(v.reviewer) + '</b>: ' + esc(v.view || 'no view yet') + (v.comment ? ' — ' + esc(v.comment) : '') + '</li>';
      }).join('') + '</ul>';
    }
    h += '<p class="pending">Decision: pending discussion</p></div>';
    return h;
  }

  function renderSuggestions() {
    var list = S.suggestions;
    $('suggCount').textContent = list.length;
    if (!list.length) { $('suggList').innerHTML = '<p class="small">No suggestions yet. If something is missing from the board, use \u201cSuggest a missing requirement\u201d.</p>'; return; }
    $('suggList').innerHTML = list.map(function (s, i) {
      var who = s.reviewer === S.reviewer ? 'you' : s.reviewer;
      var decided = !!s.triage;
      var h = '<article class="scard">';
      h += decided
        ? '<span class="sstat done">Decision: ' + esc(s.triage) + '</span>'
        : '<span class="sstat">Not decided yet</span>';
      h += '<p class="title">' + esc(s.requirement) + '</p>';
      h += '<dl class="sdl">';
      h += '<dt>Suggested by</dt><dd>' + esc(who) + '</dd>';
      h += '<dt>Belongs in</dt><dd>' + esc(s.category || 'Not sure') + '</dd>';
      if (s.workflow) h += '<dt>Workflow</dt><dd>' + esc(s.workflow) + '</dd>';
      if (s.actor) h += '<dt>Who needs it</dt><dd>' + esc(s.actor.split(';').map(function (x) { return x.trim(); }).filter(Boolean).join(', ')) + '</dd>';
      if (s.why) h += '<dt>Why</dt><dd>' + esc(s.why) + '</dd>';
      if (decided && s.note) h += '<dt>Note</dt><dd>' + esc(s.note) + '</dd>';
      h += '</dl>';
      var cs = s.comments || [];
      if (cs.length) {
        h += '<ul class="scomm">' + cs.map(function (c) {
          return '<li><b>' + esc(c.reviewer === S.reviewer ? 'You' : c.reviewer) + ':</b> ' + esc(c.comment) + '</li>';
        }).join('') + '</ul>';
      }
      h += '<div class="sacts">';
      if (!s.key) h += '<span class="small">Saving\u2026</span>';
      else {
        h += '<button type="button" class="linkbtn" data-act="scomment" data-i="' + i + '">Comment</button>';
        if (s.reviewer === S.reviewer && !decided) {
          h += '<button type="button" class="linkbtn" data-act="sedit" data-i="' + i + '">Edit</button>';
          h += '<button type="button" class="linkbtn" data-act="swithdraw" data-i="' + i + '">Withdraw</button>';
        }
      }
      h += '</div></article>';
      return h;
    }).join('');
  }

  // ---------- dialogs ----------
  var dlg = $('dlg'), form = $('dlgForm'), onSubmit = null;
  var CLOSE_X = '<button type="button" class="dlg-x" data-close aria-label="Close" formnovalidate><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12"></path><path d="M18 6L6 18"></path></svg></button>';
  function openDialog(html, submit) {
    form.innerHTML = CLOSE_X + html; onSubmit = submit;
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    var first = form.querySelector('textarea, input, select, .acts .primary'); if (first) first.focus();
  }
  function closeDialog() { if (dlg.open) dlg.close(); onSubmit = null; }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var sub = e.submitter;
    if (sub && sub.value === 'cancel') { closeDialog(); return; }
    if (onSubmit && onSubmit() !== false) closeDialog();
  });
  dlg.addEventListener('cancel', function () { onSubmit = null; });
  form.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) { e.preventDefault(); closeDialog(); } });
  // Clicking the dark area outside the pop-up closes it (only if the click started there, so selecting text doesn't).
  var downOnBackdrop = false;
  dlg.addEventListener('mousedown', function (e) { downOnBackdrop = e.target === dlg; });
  dlg.addEventListener('click', function (e) { if (e.target === dlg && downOnBackdrop) closeDialog(); downOnBackdrop = false; });
  function showErr(msg) { var el = form.querySelector('.err'); el.textContent = msg; el.hidden = false; }
  function acts(label) {
    return '<p class="err" role="alert" hidden></p><div class="acts"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">' + esc(label) + '</button></div>';
  }

  function reqHead(r) {
    return '<p class="small reqid">' + esc([r.id, r.workflow].filter(Boolean).join(' \u00b7 ')) + '</p>' +
      '<h2 class="reqh">' + esc(r.requirement) + '</h2>';
  }

  function openMove(id, to) {
    var r = byId(id), m = mine(r);
    openDialog(
      reqHead(r) +
      '<div class="fromto"><span>' + esc(r.category) + '</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="M13 6l6 6-6 6"></path></svg><span style="background:var(--blue-t);color:var(--blue-d)">' + esc(to) + '</span></div>' +
      '<label>Why should it move? <span class="opt">(required)</span><textarea name="c" maxlength="2000">' + esc(m && m.comment || '') + '</textarea></label>' + acts('Move card'),
      function () {
        var c = form.c.value.trim();
        if (!c) { showErr('Add a short reason so we know why it should move.'); return false; }
        setMine(id, { status: 'moved', to: to, comment: c });
      });
  }

  function openComment(id) {
    var r = byId(id), m = mine(r), moved = m && m.status === 'moved';
    openDialog(
      reqHead(r) +
      '<label>' + (moved ? 'Why should it move? <span class="opt">(required)</span>' : 'Your comment <span class="opt">(optional; the card stays where it is)</span>') +
      '<textarea name="c" maxlength="2000">' + esc(m && m.comment || '') + '</textarea></label>' + acts('Save'),
      function () {
        var c = form.c.value.trim();
        if (moved) {
          if (!c) { showErr('A moved card needs a reason.'); return false; }
          setMine(id, { status: 'moved', to: m.to, comment: c });
        } else if (m && m.status === 'approved') {
          setMine(id, { status: 'approved', to: '', comment: c });
        } else if (c) {
          setMine(id, { status: 'commented', to: '', comment: c });
        } else if (m) {
          setMine(id, null);
        }
      });
  }

  function openNote(id) {
    var r = byId(id), m = mine(r);
    openDialog(
      reqHead(r) +
      '<label>Your note for the discussion <span class="opt">(optional; other reviewers can see it)</span><textarea name="c" maxlength="2000">' + esc(m && m.comment || '') + '</textarea></label>' + acts('Save note'),
      function () {
        var c = form.c.value.trim();
        if (!c && !(m && m.to)) { if (m) setMine(id, null); return; }
        setMine(id, { status: 'view', to: m && m.to || '', comment: c });
      });
  }

  function openSuggest(existing) {
    var ex = existing || null;
    var wfs = {}, acs = {};
    S.reqs.forEach(function (r) {
      if (r.workflow) wfs[r.workflow] = 1;
      String(r.actor || '').split(';').forEach(function (a) { a = a.trim(); if (a) acs[a] = 1; });
    });
    var actors = Object.keys(acs).sort(function (a, b) { return a.localeCompare(b); });
    var exActors = ex ? String(ex.actor || '').split(';').map(function (a) { return a.trim(); }).filter(Boolean) : [];
    var exOther = exActors.filter(function (a) { return actors.indexOf(a) < 0; });
    openDialog(
      '<h2>' + (ex ? 'Edit your suggestion' : 'Suggest a missing requirement') + '</h2>' +
      '<p class="small">Everyone reviewing can see suggestions. They aren\u2019t added to the board during the review; each one gets a decision afterwards.</p>' +
      '<label>What\u2019s needed? <span class="opt">(required)</span><textarea name="req" maxlength="1000" style="min-height:72px">' + esc(ex ? ex.requirement : '') + '</textarea></label>' +
      '<label>Why is it needed? <span class="opt">(required)</span><textarea name="why" maxlength="2000" style="min-height:72px">' + esc(ex ? ex.why : '') + '</textarea></label>' +
      '<label>Workflow <span class="opt">(optional)</span><select name="wf"><option value="">Not sure</option>' +
        Object.keys(wfs).sort().map(function (w) { return '<option' + (ex && ex.workflow === w ? ' selected' : '') + '>' + esc(w) + '</option>'; }).join('') + '</select></label>' +
      '<fieldset class="actors"><legend>Who needs it? <span class="opt">(optional, pick any)</span></legend><div class="actor-grid">' +
        actors.map(function (a) { return '<label class="chk"><input type="checkbox" name="actor" value="' + esc(a) + '"' + (exActors.indexOf(a) >= 0 ? ' checked' : '') + '> ' + esc(a) + '</label>'; }).join('') +
      '</div><label style="margin-top:8px">Someone else <span class="opt">(optional)</span><input name="actorOther" maxlength="120" value="' + esc(exOther.join('; ')) + '"></label></fieldset>' +
      '<label>Where do you think it belongs? <span class="opt">(optional)</span><select name="cat"><option value="">Not sure</option>' +
        CATS.map(function (c) { return '<option' + (ex && ex.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
      acts(ex ? 'Save changes' : 'Submit suggestion'),
      function () {
        var picked = Array.prototype.filter.call(form.querySelectorAll('input[name="actor"]'), function (x) { return x.checked; }).map(function (x) { return x.value; });
        var other = form.actorOther.value.trim(); if (other) picked.push(other);
        var s = { requirement: form.req.value.trim(), workflow: form.wf.value, actor: picked.join('; '), category: form.cat.value, why: form.why.value.trim() };
        if (!s.requirement || !s.why) { showErr('Please describe what\u2019s needed and why.'); return false; }
        if (ex) {
          if (ex.requirement === s.requirement && ex.why === s.why && ex.workflow === s.workflow && ex.actor === s.actor && ex.category === s.category) return;
          Object.assign(ex, s); renderSuggestions();
          save(Object.assign({ action: 'editSuggestion', key: ex.key }, s));
          return;
        }
        var item = Object.assign({ reviewer: S.reviewer, triage: '', note: '', key: '', comments: [] }, s);
        S.suggestions.push(item);
        renderSuggestions();
        toggleSugg(true);
        save(Object.assign({ action: 'suggest' }, s), function (res) { item.key = res && res.key || ''; renderSuggestions(); });
      });
  }

  function openSuggComment(s) {
    openDialog(
      '<p class="small reqid">Suggestion by ' + esc(s.reviewer === S.reviewer ? 'you' : s.reviewer) + '</p><h2 class="reqh">' + esc(s.requirement) + '</h2>' +
      '<label>Your comment <span class="opt">(everyone reviewing can see it)</span><textarea name="c" maxlength="2000"></textarea></label>' + acts('Add comment'),
      function () {
        var c = form.c.value.trim();
        if (!c) { showErr('Write a comment first.'); return false; }
        s.comments = (s.comments || []).concat([{ reviewer: S.reviewer, comment: c }]);
        renderSuggestions();
        save({ action: 'commentSuggestion', key: s.key, comment: c });
      });
  }

  function openWithdraw(s, i) {
    openDialog(
      '<h2>Withdraw this suggestion?</h2><p class="small">\u201c' + esc(s.requirement) + '\u201d will be removed for everyone.</p>' + acts('Withdraw'),
      function () {
        S.suggestions.splice(i, 1);
        renderSuggestions();
        save({ action: 'withdrawSuggestion', key: s.key });
      });
  }

  // ---------- toast ----------
  var toastTimer = null, toastUndo = null;
  function toast(msg, undo) {
    $('toastMsg').textContent = msg; toastUndo = undo;
    $('toastUndo').hidden = !undo; $('toast').hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { $('toast').hidden = true; toastUndo = null; }, 6000);
  }
  $('toastUndo').addEventListener('click', function () {
    $('toast').hidden = true; clearTimeout(toastTimer);
    if (toastUndo) { var u = toastUndo; toastUndo = null; u(); }
  });

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]'); if (!t || t.tagName === 'SELECT') return;
    var id = t.getAttribute('data-id'), act = t.getAttribute('data-act');
    if (act === 'approve') approve(id);
    else if (act === 'unapprove') unapprove(id);
    else if (act === 'undomove') undoMove(id);
    else if (act === 'comment') openComment(id);
    else if (act === 'note') openNote(id);
    else if (act === 'view') setView(id, t.getAttribute('data-cat'));
    else if (act === 'views') { S.viewsOpen[id] = !S.viewsOpen[id]; renderBoard(); }
    else if (act === 'more') { var k = t.getAttribute('data-key'); S.groupShow[k] = (S.groupShow[k] || GROUP_SHOW) + 20; renderBoard(); }
    else if (act === 'pile') { var c = t.getAttribute('data-col'); S.pileOpen[c] = !S.pileOpen[c]; renderBoard(); }
    else if (act === 'filter') { S.filter = t.getAttribute('data-f'); renderFilters(); renderBoard(); }
    else if (act === 'retry') retry();
    else if (act === 'scomment') openSuggComment(S.suggestions[+t.getAttribute('data-i')]);
    else if (act === 'sedit') openSuggest(S.suggestions[+t.getAttribute('data-i')]);
    else if (act === 'swithdraw') openWithdraw(S.suggestions[+t.getAttribute('data-i')], +t.getAttribute('data-i'));
    else if (act === 'coltab') { S.mobileCol = t.getAttribute('data-col'); renderBoard(); var y = $('board').getBoundingClientRect().top + window.scrollY - $('coltabs').offsetHeight - 8; if (window.scrollY > y) window.scrollTo(0, y); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches('select[data-act="move"]') && t.value) requestMove(t.getAttribute('data-id'), t.value);
    if (t.id === 'wfSel') { S.workflow = t.value; renderBoard(); }
  });
  $('suggestBtn').addEventListener('click', function () { openSuggest(); });
  function toggleSugg(open) {
    $('suggPanel').hidden = !open;
    $('suggJump').setAttribute('aria-expanded', String(open));
    if (!open) $('suggJump').focus();
  }
  $('suggJump').addEventListener('click', function () { toggleSugg($('suggPanel').hidden); });
  $('refreshBtn').addEventListener('click', function () { refresh(); });
  $('logoutBtn').addEventListener('click', function () {
    if (S.code && !S.demo) api({ action: 'signout', code: S.code }).catch(function () {});
    store(STORE_KEY, null); S.code = null; $('app').hidden = true; $('login').hidden = false; $('codeInput').value = '';
  });

  // drag and drop
  var dragId = null;
  var board = $('board');
  board.addEventListener('dragstart', function (e) {
    var c = e.target.closest && e.target.closest('.card[draggable="true"]'); if (!c) return;
    dragId = c.getAttribute('data-id');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragId); } catch (x) {}
    c.classList.add('dragging'); board.classList.add('dragging');
  });
  board.addEventListener('dragend', function () {
    dragId = null; board.classList.remove('dragging');
    Array.prototype.forEach.call(board.querySelectorAll('.dragging, .over'), function (el) { el.classList.remove('dragging', 'over'); });
  });
  board.addEventListener('dragover', function (e) {
    if (!dragId) return;
    var col = e.target.closest('.colm'); if (!col || col.getAttribute('data-col') === N1C) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    Array.prototype.forEach.call(board.querySelectorAll('.colm.over'), function (el) { if (el !== col) el.classList.remove('over'); });
    col.classList.add('over');
  });
  board.addEventListener('drop', function (e) {
    var col = e.target.closest('.colm'); if (!col || !dragId) return;
    e.preventDefault();
    var id = dragId, to = col.getAttribute('data-col');
    col.classList.remove('over');
    requestMove(id, to);
  });

  // ---------- data load / sign in ----------
  function apply(data) {
    S.reviewer = data.reviewer || '';
    S.isOwner = !!data.isOwner;
    S.reviewerCount = data.reviewerCount || 3;
    S.reqs = (data.requirements || []).map(function (r) {
      return {
        id: String(r.id), requirement: r.requirement || '', workflow: r.workflow || '', actor: r.actor || '',
        category: normCat(r.category) || N1C, reason: r.reason || '', involves: r.involves || '',
        question: r.question || '', decision: r.decision || ''
      };
    });
    S.mine = {};
    Object.keys(data.mine || {}).forEach(function (id) {
      var m = data.mine[id];
      S.mine[id] = { status: m.status, to: m.status === 'moved' || m.status === 'view' ? (normCat(m.to) || '') : '', comment: m.comment || '' };
    });
    S.views = data.views || {};
    S.suggestions = data.suggestions || [];
    $('who').innerHTML = 'Signed in as <b>' + esc(S.reviewer) + '</b>' + (S.isOwner ? ' (owner, not counted)' : '');
  }

  function refresh() {
    $('refreshBtn').textContent = 'Refreshing…';
    return api({ action: 'load', code: S.code }).then(function (data) { apply(data); renderAll(); })
      .catch(function () { toast('Couldn’t refresh. Check your connection and try again.'); })
      .then(function () { $('refreshBtn').textContent = 'Refresh'; });
  }

  function signIn(code) {
    var btn = $('loginBtn'), err = $('loginErr');
    err.hidden = true; btn.disabled = true; btn.textContent = 'Checking…';
    return api({ action: 'load', code: code, signin: true }).then(function (data) {
      S.code = code; store(STORE_KEY, code); apply(data);
      $('login').hidden = true; $('app').hidden = false;
      setSave('ok'); renderAll();
    }).catch(function (e) {
      store(STORE_KEY, null);
      $('login').hidden = false; $('app').hidden = true;
      err.textContent = e.code === 'invalid_code' ? 'That code didn’t work. Check it and try again.' : 'Couldn’t connect. Check your connection and try again.';
      err.hidden = false;
    }).then(function () { btn.disabled = false; btn.textContent = 'Continue'; });
  }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var code = $('codeInput').value.trim();
    if (!code) { $('loginErr').textContent = 'Enter your access code.'; $('loginErr').hidden = false; return; }
    signIn(code);
  });
  $('codeInput').addEventListener('input', function () { $('loginErr').hidden = true; });

  // ---------- demo mode ----------
  var DEMO = null;
  function demoApi(body) {
    if (!DEMO) DEMO = demoData();
    return new Promise(function (resolve) {
      setTimeout(function () {
        if (body.action === 'load') resolve(JSON.parse(JSON.stringify(Object.assign({ ok: true, reviewer: 'Demo reviewer' }, DEMO))));
        else resolve(body.action === 'suggest' ? { ok: true, key: String(Math.round(Date.now() / 1000)) } : { ok: true });
      }, body.action === 'load' ? 300 : 250);
    });
  }
  function demoData() {
    var rows = [
      ['Onboarding', 'Customer', 'MVP', 'Customer can create an account and sign in', 'Every other workflow depends on it.'],
      ['Onboarding', 'Customer', 'MVP', 'Customer can reset their password', 'Avoids support calls from day one.'],
      ['Onboarding', 'Customer', 'MVP', 'Customer can update their contact details', 'Needed for reminders to reach them.'],
      ['Onboarding', 'Admin', 'Later', 'Admin can merge duplicate customer records', 'Duplicates will be rare at launch volumes.'],
      ['Booking', 'Customer', 'MVP', 'Customer can see available time slots', 'The core of the product.'],
      ['Booking', 'Customer', 'MVP', 'Customer can book an available time slot', 'The core of the product.'],
      ['Booking', 'Customer', 'MVP', 'Customer receives an email confirmation', 'Customers expect proof of booking.'],
      ['Booking', 'Customer', 'MVP', 'Customer can reschedule a booking', 'Reduces no-shows and phone calls.'],
      ['Booking', 'Staff', 'MVP', 'Staff can book on behalf of a customer', 'Phone bookings continue at launch.'],
      ['Booking', 'Customer', 'Later', 'Customer can join a waitlist for a full slot', 'Nice to have once demand is clear.'],
      ['Scheduling', 'Staff', 'MVP', 'Staff can set their weekly availability', 'Slots come from staff availability.'],
      ['Scheduling', 'Staff', 'MVP', 'Staff can see their schedule for the day', 'Staff need this to run the day.'],
      ['Scheduling', 'Staff', 'Later', 'Staff can export a daily schedule', 'The on-screen view covers launch.'],
      ['Scheduling', 'Staff', 'MVP', 'Staff can block out time for leave', 'Prevents bookings when staff are away.'],
      ['Notifications', 'Customer', 'MVP', 'Customer receives an email reminder the day before', 'Cuts no-shows.'],
      ['Notifications', 'Customer', 'Later', 'Customer receives SMS reminders', 'Email covers launch; SMS adds cost.'],
      ['Reporting', 'Admin', 'Later', 'Admin can view usage reports', 'Useful once there is data to report on.'],
      ['Reporting', 'Admin', 'Later', 'Admin can export bookings to CSV', 'Manual reporting is fine at first.'],
      ['Payments', 'Finance', 'Out of Scope', 'Invoicing and accounting', 'Handled by the existing finance system.'],
      ['Integrations', 'Admin', 'Out of Scope', 'Sync with external calendar apps', 'Not requested by any stakeholder group.'],
      ['Booking', 'Customer', N1C, 'Customer can cancel within 24 hours of a booking', ''],
      ['Payments', 'Customer', N1C, 'Customer pays a deposit when booking', ''],
      ['Admin', 'Admin', N1C, 'Admin can configure opening hours per location', '']
    ];
    var reqs = rows.map(function (r, i) {
      return { id: 'R-' + String(i + 1).padStart(3, '0'), workflow: r[0], actor: r[1], category: r[2], requirement: r[3], reason: r[4], involves: '', question: '', decision: '' };
    });
    reqs[20].question = 'Is a cancellation fee charged?'; reqs[20].involves = 'Finance lead';
    reqs[21].question = 'Which payment provider would take deposits?'; reqs[21].involves = 'Finance lead';
    reqs[22].decision = 'MVP (agreed 4 Nov)';
    return {
      reviewerCount: 3,
      requirements: reqs,
      mine: {},
      views: { 'R-021': [{ reviewer: 'Reviewer 2', view: 'MVP', comment: 'A fee is fine if shown before booking.' }, { reviewer: 'Reviewer 3', view: 'Later', comment: '' }] },
      suggestions: [{ reviewer: 'Reviewer 2', requirement: 'Staff can block out time for breaks', workflow: 'Scheduling', actor: 'Staff', category: 'MVP', why: 'Breaks are booked over today.', triage: '', note: '', key: '1', comments: [{ reviewer: 'Reviewer 3', comment: 'Agree, this happens weekly.' }] }]
    };
  }

  // ---------- start ----------
  var label = (CFG.projectName ? CFG.projectName + ' · ' : '') + 'Requirements review';
  $('eyebrow').textContent = label; $('loginEyebrow').textContent = label;
  document.title = label;
  if (CFG.deadline) { $('deadline').textContent = 'Due ' + CFG.deadline.replace(/^the end of /, 'end of '); $('deadline').hidden = false; }
  if (S.demo) { $('demoNote').hidden = false; $('demoPill').hidden = false; }
  var saved = load(STORE_KEY);
  if (saved) signIn(saved); else $('login').hidden = false;
})();
