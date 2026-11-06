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
    { key: 'commented', label: 'With my comments or questions' },
    { key: 'agreed', label: 'Agreed by me' }
  ];
  var GROUP_AT = 12;   // group a column by workflow once it has more open cards than this
  var GROUP_SHOW = 6;  // cards shown per group before "Show more"
  var STORE_KEY = 'n1c-review-code';

  var S = {
    demo: !CFG.scriptUrl,
    code: null, reviewer: '', isOwner: false, reviewerCount: 3,
    reqs: [], mine: {}, views: {}, suggestions: [],
    filter: 'open', workflow: '', q: '',
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
  // A requirement is decided once the owner fills in its Decision in the sheet, whatever its column.
  function isDecided(r) { return String(r.decision || '').trim() !== ''; }
  function reviewable(r) { return !isDecided(r); }
  // Only a real position counts as reviewed: agreeing, moving, or (for N1C items) choosing a view.
  // Comments and clarification requests don't.
  function isReviewed(r) {
    var m = mine(r); if (!m) return false;
    if (r.category === N1C) return m.status === 'view' && !!m.to;
    return m.status === 'agreed' || m.status === 'moved';
  }

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
    setMine(id, { status: 'agreed', to: '', comment: prev && prev.comment || '' });
    toast('Agreed with ' + r.id.replace(/-/g, '\u2011') + ' in ' + r.category + '. It\u2019s now in the agreed pile.', function () { setMine(id, prev); });
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
  function unclarify(id) { setMine(id, null); }
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
      open: pool.filter(function (r) { return status(r) !== 'agreed'; }).length,
      todo: pool.filter(function (r) { return !isReviewed(r); }).length,
      moved: pool.filter(function (r) { return status(r) === 'moved'; }).length,
      commented: pool.filter(function (r) { return mine(r) && mine(r).comment; }).length,
      agreed: pool.filter(function (r) { return status(r) === 'agreed'; }).length
    };
    $('filters').innerHTML = FILTERS.map(function (f) {
      return '<button type="button" class="chip" data-act="filter" data-f="' + f.key + '" aria-pressed="' + (S.filter === f.key) + '">' + esc(f.label) + ' (' + counts[f.key] + ')</button>';
    }).join('');
    $('filterSel').innerHTML = FILTERS.map(function (f) {
      return '<option value="' + f.key + '"' + (S.filter === f.key ? ' selected' : '') + '>' + esc(f.label) + ' (' + counts[f.key] + ')</option>';
    }).join('');
  }

  function setFilter(f) {
    S.filter = f;
    if (!shownIn(S.mobileCol).length) {
      var first = COLS.filter(function (c) { return shownIn(c.key).length; })[0];
      if (first) S.mobileCol = first.key;
    }
    renderFilters(); renderBoard();
  }

  function matchesSearch(r) {
    if (!S.q) return true;
    var hay = (r.id + ' ' + r.requirement + ' ' + r.workflow + ' ' + r.actor + ' ' + r.reason).toLowerCase();
    return S.q.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }

  function passFilter(r) {
    if (!matchesSearch(r)) return false;
    var st = status(r), m = mine(r);
    if (S.filter === 'todo') return !isReviewed(r);
    if (S.filter === 'moved') return st === 'moved';
    if (S.filter === 'commented') return !!(m && m.comment);
    if (S.filter === 'agreed') return st === 'agreed';
    return st !== 'agreed';
  }

  function shownIn(colKey) {
    var live = S.reqs.filter(function (r) { return eff(r) === colKey && reviewable(r); });
    var pool = (S.filter === 'agreed' || S.filter === 'commented') ? live : live.filter(function (r) { return status(r) !== 'agreed'; });
    return pool.filter(passFilter);
  }

  function renderBoard() {
    var tabs = [], filtered = S.filter !== 'open' || !!S.q;
    var matches = {};
    COLS.forEach(function (c) { matches[c.key] = shownIn(c.key).length; });
    var html = COLS.map(function (col) {
      var all = S.reqs.filter(function (r) { return eff(r) === col.key; });
      var decided = col.key === N1C ? S.reqs.filter(isDecided) : [];
      var live = all.filter(reviewable);
      var approved = live.filter(function (r) { return status(r) === 'agreed'; });
      var open = live.filter(function (r) { return status(r) !== 'agreed'; });
      var left = open.filter(function (r) { return !isReviewed(r); }).length;
      var shown = shownIn(col.key);
      var isN = col.key === N1C;

      tabs.push('<button type="button" class="coltab" role="tab" data-act="coltab" data-col="' + esc(col.key) + '" style="--c:' + col.color + '" aria-selected="' + (S.mobileCol === col.key) + '"><b>' + esc(col.key === N1C ? 'N1C decision' : col.key) + '</b><span>' + (filtered ? matches[col.key] + (matches[col.key] === 1 ? ' match' : ' matches') : isN ? open.length + ' open' : left + ' left') + '</span></button>');
      var h = '<section class="colm' + (S.mobileCol === col.key ? ' on' : '') + '" data-col="' + esc(col.key) + '" style="--c:' + col.color + '" aria-label="' + esc(col.key) + '">';
      h += '<div class="colm-h"><h2>' + esc(col.key) + '</h2><span>' +
        (isN ? open.length + ' open · ' + decided.length + ' decided' : left + ' to review · ' + live.length + ' total') + '</span></div>';
      h += '<p class="blurb">' + esc(col.blurb) + '</p>';
      if (!isN) h += '<div class="dropzone">Drop here to move to ' + esc(col.key) + '</div>';

      if (!shown.length) {
        var elsewhere = COLS.filter(function (c) { return c.key !== col.key && matches[c.key]; }).map(function (c) { return c.key + ' (' + matches[c.key] + ')'; });
        var msg = S.filter === 'agreed' && isN ? 'These are settled by discussion, so you give a view rather than agree.'
          : filtered ? 'None in this column.' + (elsewhere.length ? ' See ' + elsewhere.join(', ') + '.' : '')
          : open.length ? 'Nothing here.' : (approved.length ? 'All done here.' : 'No items.');
        h += '<p class="empty">' + esc(msg) + '</p>';
      } else if (shown.length > GROUP_AT) {
        var groups = {};
        shown.forEach(function (r) { var w = r.workflow || 'Other'; (groups[w] = groups[w] || []).push(r); });
        Object.keys(groups).sort().forEach(function (w) {
          var inCol = live.filter(function (r) { return (r.workflow || 'Other') === w; });
          var gLeft = inCol.filter(function (r) { return !isReviewed(r); }).length;
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

      if (!isN && approved.length && !filtered) {
        var po = !!S.pileOpen[col.key];
        h += '<button type="button" class="pile" data-act="pile" data-col="' + esc(col.key) + '" aria-expanded="' + po + '"><span>' + CHECK + approved.length + ' agreed</span><b style="font-weight:500">' + (po ? 'Hide' : 'Show') + '</b></button>';
        if (po) approved.forEach(function (r) {
          var m = mine(r);
          h += '<div class="mini"><div class="row"><p>' + esc(r.requirement) + '</p><button type="button" class="linkbtn" data-act="unapprove" data-id="' + esc(r.id) + '">Undo</button></div>' +
            (m && m.comment ? '<p class="why">Your comment: ' + esc(m.comment) + '</p>' : '') + '</div>';
        });
      }
      if (isN && decided.length && !filtered) {
        var dk = 'decided', dpo = !!S.pileOpen[dk];
        h += '<button type="button" class="pile dec" data-act="pile" data-col="' + dk + '" aria-expanded="' + dpo + '"><span>' + CHECK + decided.length + ' decided</span><b style="font-weight:500">' + (dpo ? 'Hide' : 'Show') + '</b></button>';
        if (dpo) decided.forEach(function (r) {
          h += '<div class="mini"><p>' + esc(r.requirement) + '</p><p class="why"><b style="font-weight:500;color:var(--ink)">Decided: ' + esc(r.decision) + '</b>' +
            (r.decisionDate ? ' \u00b7 ' + esc(r.decisionDate) : '') + (r.decisionRationale ? '<br>' + esc(r.decisionRationale) : '') + '</p></div>';
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
    if (st === 'moved') h += '<span class="badge b-moved">' + (m.to === N1C ? 'You asked for an N1C decision' : 'You moved this: ' + esc(r.category) + ' → ' + esc(m.to)) + '</span>';
    else if (st === 'commented') h += '<span class="badge b-comm">You commented (not yet reviewed)</span>';
    else if (st === 'clarify') h += '<span class="badge b-view">You asked for clarification</span>';
    else if (st === 'agreed') h += '<span class="badge b-ok">You agreed with this placement</span>';
    h += '<p class="title">' + esc(r.requirement) + '</p>';
    h += '<div class="tags">' + (!grouped && r.workflow ? '<span class="tag">' + esc(r.workflow) + '</span>' : '') +
      (r.actor ? '<span class="tag">' + esc(r.actor) + '</span>' : '') + '<span class="rid">' + esc(r.id) + '</span></div>';
    if (r.reason) h += '<p class="why">' + (st === 'moved' ? 'Proposed: ' + esc(r.category) + '. ' : '') + 'Why: ' + esc(r.reason) + '</p>';
    if (r.question) h += '<p class="why">Open question: ' + esc(r.question) + '</p>';
    if (r.involves) h += '<p class="why">Also involves: ' + esc(r.involves) + '</p>';

    if (isN) return h + n1cBlock(r) + '</article>';

    if (m && m.comment) h += '<p class="mycomm">' + (st === 'clarify' ? 'Your question: ' : st === 'moved' ? 'Your reason: ' : 'Your comment: ') + esc(m.comment) + '</p>';
    h += '<div class="foot">';
    if (st === 'moved') {
      h += '<button type="button" class="btn" data-act="undomove" data-id="' + esc(r.id) + '">Undo move</button>';
      h += '<button type="button" class="btn" data-act="comment" data-id="' + esc(r.id) + '">Edit reason</button>';
    } else if (st === 'agreed') {
      h += '<button type="button" class="btn" data-act="unapprove" data-id="' + esc(r.id) + '">Undo</button>';
      h += '<button type="button" class="btn" data-act="comment" data-id="' + esc(r.id) + '">' + (m && m.comment ? 'Edit comment' : 'Comment') + '</button>';
    } else {
      h += '<button type="button" class="btn approve" data-act="approve" data-id="' + esc(r.id) + '" title="The requirement is right and belongs in ' + esc(r.category) + '">' + CHECK + 'Agree</button>';
      if (st === 'clarify') {
        h += '<button type="button" class="btn" data-act="comment" data-id="' + esc(r.id) + '">Edit question</button>';
        h += '<button type="button" class="btn" data-act="unclarify" data-id="' + esc(r.id) + '">Withdraw question</button>';
      } else {
        h += '<button type="button" class="btn" data-act="clarify" data-id="' + esc(r.id) + '">Unclear?</button>';
        h += '<button type="button" class="btn" data-act="comment" data-id="' + esc(r.id) + '">' + (m && m.comment ? 'Edit comment' : 'Comment') + '</button>';
      }
    }
    h += '<select class="movesel" data-act="move" data-id="' + esc(r.id) + '" aria-label="Move this card to another column"><option value="">Move to…</option>' +
      CATS.filter(function (c) { return c !== eff(r); }).map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('') + '</select>';
    h += '</div></article>';
    return h;
  }

  function n1cBlock(r) {
    var m = mine(r), myView = m && m.status === 'view' ? m.to : '';
    var others = (S.views[r.id] || []).filter(function (v) { return v.reviewer !== S.reviewer; });
    var weighed = others.filter(function (v) { return v.view; }).length + (myView && !S.isOwner ? 1 : 0);
    var open = !!S.viewsOpen[r.id];
    var h = '<div class="views"><p class="views-h">Your view before the discussion</p><div class="vchips">';
    ['MVP', 'Later', 'Out of Scope'].forEach(function (c) {
      h += '<button type="button" class="vchip" data-act="view" data-id="' + esc(r.id) + '" data-cat="' + esc(c) + '" aria-pressed="' + (myView === c) + '">' + esc(c) + '</button>';
    });
    h += '</div>';
    if (m && m.comment) h += '<p class="mycomm">Your note: ' + esc(m.comment) + '</p>';
    h += '<button type="button" class="btn" data-act="note" data-id="' + esc(r.id) + '" style="align-self:flex-start">' + (m && m.comment ? 'Edit note' : 'Add a note') + '</button>';
    h += '<div class="vmeta"><span>' + weighed + ' of ' + S.reviewerCount + ' reviewers have given a view</span>' +
      (others.length ? '<button type="button" class="linkbtn" data-act="views" data-id="' + esc(r.id) + '" aria-expanded="' + open + '">' + (open ? 'Hide views' : 'See views') + '</button>' : '') + '</div>';
    if (open && others.length) {
      h += '<ul class="others">' + others.map(function (v) {
        return '<li><b style="font-weight:500">' + esc(v.reviewer) + '</b>: ' + esc(v.view || 'no view chosen yet') + (v.comment ? ' — ' + esc(v.comment) : '') + '</li>';
      }).join('') + '</ul>';
    }
    if (!myView) h += '<p class="why">Choose MVP, Later or Out of Scope to count this as reviewed. A note alone doesn\u2019t count.</p>';
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
      '<label>' + (to === N1C ? 'Why does this need an N1C decision?' : 'Why should it move?') + ' <span class="opt">(required)</span><textarea name="c" maxlength="2000">' + esc(m && m.status === 'moved' ? m.comment : '') + '</textarea></label>' + acts(to === N1C ? 'Ask for N1C decision' : 'Move card'),
      function () {
        var c = form.c.value.trim();
        if (!c) { showErr('Add a short reason so we know why it should move.'); return false; }
        setMine(id, { status: 'moved', to: to, comment: c });
      });
  }

  function openComment(id) {
    var r = byId(id), m = mine(r), moved = m && m.status === 'moved', clar = m && m.status === 'clarify';
    openDialog(
      reqHead(r) +
      '<label>' + (moved ? 'Why should it move? <span class="opt">(required)</span>' : clar ? 'What needs clarifying? <span class="opt">(required)</span>' : 'Your comment <span class="opt">(the card stays where it is; a comment alone doesn\u2019t count as reviewed)</span>') +
      '<textarea name="c" maxlength="2000">' + esc(m && m.comment || '') + '</textarea></label>' + acts('Save'),
      function () {
        var c = form.c.value.trim();
        if (moved) {
          if (!c) { showErr('A moved card needs a reason.'); return false; }
          setMine(id, { status: 'moved', to: m.to, comment: c });
        } else if (clar) {
          if (!c) { showErr('Say what needs clarifying, or use \u201cWithdraw question\u201d.'); return false; }
          setMine(id, { status: 'clarify', to: '', comment: c });
        } else if (m && m.status === 'agreed') {
          setMine(id, { status: 'agreed', to: '', comment: c });
        } else if (c) {
          setMine(id, { status: 'commented', to: '', comment: c });
        } else if (m) {
          setMine(id, null);
        }
      });
  }

  function openClarify(id) {
    var r = byId(id), m = mine(r);
    openDialog(
      reqHead(r) +
      '<p class="small">Use this if you can\u2019t judge the requirement as written: the wording is ambiguous, something\u2019s missing, or you\u2019re unsure what it means. It stays unreviewed until it\u2019s clarified.</p>' +
      '<label>What needs clarifying? <span class="opt">(required)</span><textarea name="c" maxlength="2000">' + esc(m && m.comment || '') + '</textarea></label>' + acts('Ask for clarification'),
      function () {
        var c = form.c.value.trim();
        if (!c) { showErr('Say briefly what\u2019s unclear.'); return false; }
        setMine(id, { status: 'clarify', to: '', comment: c });
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
    openDialog(
      '<h2>' + (ex ? 'Edit your suggestion' : 'Suggest a missing requirement') + '</h2>' +
      '<p class="small">Everyone reviewing can see suggestions. They aren\u2019t added to the board during the review; each one gets a decision afterwards.</p>' +
      '<label>What\u2019s needed? <span class="opt">(required)</span><textarea name="req" maxlength="1000" style="min-height:72px">' + esc(ex ? ex.requirement : '') + '</textarea></label>' +
      '<label>Why is it needed? <span class="opt">(required)</span><textarea name="why" maxlength="2000" style="min-height:72px">' + esc(ex ? ex.why : '') + '</textarea></label>' +
      '<label>Where do you think it belongs? <span class="opt">(optional)</span><select name="cat"><option value="">Not sure</option>' +
        CATS.map(function (c) { return '<option' + (ex && ex.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
      acts(ex ? 'Save changes' : 'Submit suggestion'),
      function () {
        // Workflow and who-needs-it aren't asked any more; keep whatever an older suggestion already had.
        var s = { requirement: form.req.value.trim(), workflow: ex ? ex.workflow || '' : '', actor: ex ? ex.actor || '' : '', category: form.cat.value, why: form.why.value.trim() };
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
    else if (act === 'clarify') openClarify(id);
    else if (act === 'unclarify') unclarify(id);
    else if (act === 'note') openNote(id);
    else if (act === 'view') setView(id, t.getAttribute('data-cat'));
    else if (act === 'views') { S.viewsOpen[id] = !S.viewsOpen[id]; renderBoard(); }
    else if (act === 'more') { var k = t.getAttribute('data-key'); S.groupShow[k] = (S.groupShow[k] || GROUP_SHOW) + 20; renderBoard(); }
    else if (act === 'pile') { var c = t.getAttribute('data-col'); S.pileOpen[c] = !S.pileOpen[c]; renderBoard(); }
    else if (act === 'filter') setFilter(t.getAttribute('data-f'));
    else if (act === 'retry') retry();
    else if (act === 'scomment') openSuggComment(S.suggestions[+t.getAttribute('data-i')]);
    else if (act === 'sedit') openSuggest(S.suggestions[+t.getAttribute('data-i')]);
    else if (act === 'swithdraw') openWithdraw(S.suggestions[+t.getAttribute('data-i')], +t.getAttribute('data-i'));
    else if (act === 'coltab') { S.mobileCol = t.getAttribute('data-col'); renderBoard(); var y = $('board').getBoundingClientRect().top + window.scrollY - $('coltabs').offsetHeight - 8; if (window.scrollY > y) window.scrollTo(0, y); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches('select[data-act="move"]') && t.value) requestMove(t.getAttribute('data-id'), t.value);
    if (t.id === 'filterSel') setFilter(t.value);
  });
  $('suggestBtn').addEventListener('click', function () { openSuggest(); });
  var searchTimer = null;
  $('searchBox').addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { S.q = $('searchBox').value.trim().toLowerCase(); setFilter(S.filter); }, 150);
  });
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
        question: r.question || '', decision: r.decision || '',
        decisionDate: r.decisionDate || '', decisionRationale: r.decisionRationale || ''
      };
    });
    S.mine = {};
    Object.keys(data.mine || {}).forEach(function (id) {
      var m = data.mine[id], st = m.status === 'approved' ? 'agreed' : m.status;   // older rows say "approved"
      S.mine[id] = { status: st, to: st === 'moved' || st === 'view' ? (normCat(m.to) || '') : '', comment: m.comment || '' };
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
    reqs[22].decision = 'MVP'; reqs[22].decisionDate = '2026-11-04'; reqs[22].decisionRationale = 'Each location sets its own hours from day one.';
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
