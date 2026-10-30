/**
 * LazyChamp panel. Runs inside the Pokemon Showdown page (injected by content.js).
 * Provides a calculator and optional team-conversion controls for the Showdown Team Builder.
 * Works on both Showdown clients:
 *   - new client (Preact panels): a tab in the right-hand panel, next to Hellodex
 *   - classic client (Backbone): a side-room tab
 * It opens with the Teambuilder and closes when the Teambuilder and every "Team" tab are closed.
 * When neither client is recognised it falls back to a floating window (toolbar button).
 */
(function () {
  'use strict';
  if (window.__lazychampLoaded) return;
  window.__lazychampLoaded = true;

  const C = window.LazyChampCore;
  const BASE = document.documentElement.dataset.lazychampBase || '';
  const ROOM_ID = 'lazychamp';              // new client room id
  const CLASSIC_ID = 'view-lazychamp';      // classic client HTML-room id
  const { STATS, STAT_LABEL, PASTE_LABEL } = C;
  let client = null;                        // 'new' | 'classic' | null (unknown: floating window)

  // ---------- preferences (this browser only; the speed-creep switch is shared by the panel and the team button) ----------
  const prefs = (() => {
    const mem = {};
    const read = (k, def) => {
      try { const v = localStorage.getItem('lazychamp.' + k); if (v !== null) return v; } catch (e) { /* storage blocked */ }
      return k in mem ? mem[k] : def;
    };
    const write = (k, v) => {
      mem[k] = v;
      try { localStorage.setItem('lazychamp.' + k, v); } catch (e) { /* the choice just is not remembered */ }
      window.dispatchEvent(new CustomEvent('lazychamp-prefs', { detail: { key: k } }));
    };
    return {
      getCreep: () => read('speedCreep', '0') === '1',
      setCreep: on => write('speedCreep', on ? '1' : '0'),
      getTarget: () => (read('targetFormat', 'draft') === 'natdex' ? 'natdex' : 'draft'),
      setTarget: v => write('targetFormat', v === 'natdex' ? 'natdex' : 'draft'),
    };
  })();

  // ---------- tiny DOM helper ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'hidden' || k === 'disabled' || k === 'readOnly') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* try the old way */ }
    try {
      const ta = h('textarea', { readOnly: true, style: 'position:fixed;left:-9999px;top:0;opacity:0' });
      ta.value = text; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove();
      return !!ok;
    } catch (e) { return false; }
  }

  // ---------- Pokedex data: same-origin download from Showdown, bundled copy as backup ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.onload = resolve; s.onerror = () => reject(new Error('load failed: ' + src));
      document.head.appendChild(s);
    });
  }
  let dexPromise = null;
  function loadDex() {
    if (dexPromise) return dexPromise;
    dexPromise = (async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch('/data/pokedex.json', { signal: ctrl.signal, credentials: 'omit' });
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const built = C.buildPokedex(await res.json());
        if (!built.list.length) throw new Error('empty Pok\u00e9dex');
        return Object.assign(built, { source: 'live' });
      } catch (err) {
        await loadScript(BASE + 'dex-data.js');
        const built = C.buildPokedex(window.__LAZYCHAMP_DEX);
        return Object.assign(built, { source: 'bundled', date: window.__LAZYCHAMP_DEX_DATE });
      }
    })();
    return dexPromise;
  }

  // ---------- the app ----------
  function mountApp(root) {
    root.classList.add('lc-root');
    root.dataset.client = client || 'unknown';
    root.replaceChildren();

    const state = { dex: null, set: null, results: [], active: -1, creep: prefs.getCreep(), benchmarks: null };
    const opts = () => ({ speedCreep: state.creep, benchmarks: state.benchmarks });
    const lookup = n => (state.dex ? state.dex.byName[String(n).trim().toLowerCase()] || null : null);
    const ui = { rows: {} };
    const on = (el, ev, fn) => { el.addEventListener(ev, fn); };
    const say = (el, msg, kind) => { el.textContent = msg; el.className = 'lc-status' + (kind ? ' ' + kind : ''); };
    const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

    // -- header
    ui.badge = h('span', { class: 'lc-badge', text: 'Loading Pok\u00e9dex\u2026' });
    const head = h('header', { class: 'lc-head' },
      h('h2', { text: 'LazyChamp' }),
      h('p', { class: 'lc-sub', text: 'Compare a Showdown EV spread with Champions stat points.' }),
      ui.badge);

    // -- search
    ui.search = h('input', { type: 'search', placeholder: 'Search a Pok\u00e9mon by name or number', autocomplete: 'off', 'aria-label': 'Search a Pok\u00e9mon', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'lc-results', disabled: true });
    ui.results = h('ul', { class: 'lc-results', id: 'lc-results', role: 'listbox', hidden: true });
    ui.name = h('strong');
    ui.types = h('span');
    ui.species = h('div', { class: 'lc-species', hidden: true }, ui.name, ui.types);
    ui.empty = h('p', { class: 'lc-empty', text: 'Pick a Pok\u00e9mon above, or paste a set under Import a set.' });
    const pickCard = h('section', { class: 'lc-card' }, h('div', { class: 'lc-search' }, ui.search, ui.results), ui.species, ui.empty);

    // -- set fields
    ui.nature = h('select', { 'aria-label': 'Nature' }, C.NATURES.map(n => {
      const hint = n.raised ? ` (+${PASTE_LABEL[n.raised]}, \u2212${PASTE_LABEL[n.lowered]})` : ' (neutral)';
      return h('option', { value: n.name, text: n.name + hint });
    }));
    ui.ability = h('select', { 'aria-label': 'Ability' });
    ui.item = h('input', { type: 'text', 'aria-label': 'Item', placeholder: 'Item', autocomplete: 'off' });
    ui.level = h('input', { type: 'number', min: 1, max: 100, step: 1, 'aria-label': 'Showdown level' });
    ui.preset = h('select', { 'aria-label': 'Preset spread' }, C.PRESETS.map(p => h('option', { value: p.label, text: p.label })));
    ui.moves = [0, 1, 2, 3].map(i => h('input', { type: 'text', 'aria-label': 'Move ' + (i + 1), placeholder: 'Move ' + (i + 1), autocomplete: 'off' }));
    const field = (label, control) => h('label', { class: 'lc-field' }, h('span', { text: label }), control);
    ui.setCard = h('section', { class: 'lc-card', hidden: true },
      h('div', { class: 'lc-fields' },
        field('Nature', ui.nature), field('Ability', ui.ability), field('Item', ui.item),
        field('Showdown level', ui.level), field('Preset spread', ui.preset)),
      h('div', { class: 'lc-moves' }, ui.moves));

    // -- comparison table
    ui.stdHead = h('div', { class: 'std', text: 'Level 100' });
    const grid = h('div', { class: 'lc-grid' },
      h('div', { class: 'lc-headrow' },
        h('div', { text: 'Stat' }), h('div', { text: 'Base' }),
        h('div', { class: 'std', text: 'Showdown EVs' }), ui.stdHead,
        h('div', { class: 'champ', text: 'Champions points' }), h('div', { class: 'champ', text: 'Level 50' })));
    for (const stat of STATS) {
      const r = ui.rows[stat] = {
        nat: h('span', { class: 'lc-nat' }),
        base: h('div', { class: 'lc-base' }),
        evRange: h('input', { type: 'range', min: 0, max: 252, step: 4, 'aria-label': STAT_LABEL[stat] + ' EVs' }),
        evNum: h('input', { type: 'number', min: 0, max: 252, step: 4, 'aria-label': STAT_LABEL[stat] + ' EVs, exact value' }),
        stdVal: h('div', { class: 'lc-val std lc-stdval' }),
        ptRange: h('input', { type: 'range', min: 0, max: 32, step: 1, 'aria-label': STAT_LABEL[stat] + ' Champions points' }),
        ptNum: h('input', { type: 'number', min: 0, max: 32, step: 1, 'aria-label': STAT_LABEL[stat] + ' Champions points, exact value' }),
        champVal: h('div', { class: 'lc-val champ lc-champval' }),
      };
      grid.append(h('div', { class: 'lc-row' },
        h('div', { class: 'lc-statname' }, STAT_LABEL[stat], r.nat),
        r.base,
        h('div', { class: 'lc-ctl std lc-evctl' }, r.evRange, r.evNum),
        r.stdVal,
        h('div', { class: 'lc-ctl champ lc-ptctl' }, r.ptRange, r.ptNum),
        r.champVal));
      const onEv = e => { setEv(stat, e.target.value); };
      const onPt = e => { setPts(stat, e.target.value); };
      on(r.evRange, 'input', onEv); on(r.evNum, 'input', onEv);
      on(r.ptRange, 'input', onPt); on(r.ptNum, 'input', onPt);
      on(r.evNum, 'change', normalize); on(r.ptNum, 'change', normalize);
    }
    ui.totEv = h('span', { class: 'lc-total std' });
    ui.totPt = h('span', { class: 'lc-total champ' });
    ui.note = h('p', { class: 'lc-note', text: 'Showdown stats assume 31 IVs. Champions stats are level 50 with 31 IVs. Linked values show the fewest points (or EVs) that reach the same level 50 stat.' });
    ui.creepToggle = h('input', { type: 'checkbox' });
    ui.creepToggle.checked = state.creep;
    const creepRow = h('div', { class: 'lc-creep-row' },
      h('label', { class: 'lc-switch' }, ui.creepToggle, h('span', { text: 'Speed-creep assumption' })),
      h('p', { class: 'lc-note', text: 'When on, converting Speed keeps you above the fastest max-Speed Pok\u00e9mon you outspeed in the source format, even after rounding at the new level. Nature is never changed.' }));
    ui.creepNote = h('p', { class: 'lc-creep', hidden: true });
    ui.tableCard = h('section', { class: 'lc-card', hidden: true }, creepRow, grid, h('div', { class: 'lc-totals' }, ui.totEv, ui.totPt), ui.creepNote, ui.note);

    // -- set text + copy, one block under each side of the calculator
    function outBlock(kind, cls, label) {
      const toggle = h('input', { type: 'checkbox' });
      toggle.checked = true;
      const pre = h('pre', { class: 'lc-paste', tabindex: '0', 'aria-label': label + ' set as text' });
      const copyBeside = h('button', { type: 'button', class: 'lc-btn', text: 'Copy ' + label + ' set', hidden: true, onclick: () => copyFrom(kind) });
      const copyBelow = h('button', { type: 'button', class: 'lc-btn primary', text: 'Copy ' + label + ' set', onclick: () => copyFrom(kind) });
      const body = h('div', { class: 'lc-out-body' }, pre, copyBelow);
      const headRow = h('div', { class: 'lc-out-head' }, h('label', { class: 'lc-switch' }, toggle, h('span', { text: 'Show ' + label + ' set' })), copyBeside);
      on(toggle, 'change', () => { body.hidden = !toggle.checked; copyBeside.hidden = toggle.checked; });
      return { el: h('div', { class: 'lc-out ' + cls }, headRow, body), pre };
    }
    ui.outStd = outBlock('standard', 'std', 'Showdown');
    ui.outChamp = outBlock('champions', 'champ', 'Champions');
    ui.outStatus = h('p', { class: 'lc-status', role: 'status', 'aria-live': 'polite' });
    ui.outCard = h('section', { class: 'lc-card', hidden: true }, h('div', { class: 'lc-outs' }, ui.outStd.el, ui.outChamp.el), ui.outStatus);

    // -- import a single set
    ui.stdText = h('textarea', { 'aria-label': 'Showdown set to import', placeholder: 'Paste a Showdown set (real EVs)', spellcheck: 'false' });
    ui.champText = h('textarea', { 'aria-label': 'Champions set to import', placeholder: 'Paste a Champions set (points, or real EVs to convert)', spellcheck: 'false' });
    const ioBlock = (cls, title, ta, kind) => h('div', null,
      h('h4', { class: cls, text: title }), ta,
      h('div', { class: 'lc-actions' }, h('button', { type: 'button', class: 'lc-btn primary', text: 'Import set', onclick: () => importFrom(kind) })));
    ui.status = h('p', { class: 'lc-status', role: 'status', 'aria-live': 'polite' });
    const ioCard = h('section', { class: 'lc-card' },
      h('h3', { text: 'Import a set' }),
      h('div', { class: 'lc-io' }, ioBlock('std', 'Showdown (EVs, level 100)', ui.stdText, 'standard'), ioBlock('champ', 'Champions (points, level 50)', ui.champText, 'champions')),
      ui.status);

    // -- convert a whole team
    ui.teamFormat = h('select', { 'aria-label': 'Import team format' },
      h('option', { value: 'showdown', text: 'Showdown 510 EVs (regular)' }),
      h('option', { value: 'champions', text: 'Champions 66 points' }));
    ui.teamText = h('textarea', { 'aria-label': 'Team paste', class: 'lc-team-text', spellcheck: 'false' });
    ui.teamBtn = h('button', { type: 'button', class: 'lc-btn primary', onclick: () => runTeam() });
    ui.warnSwitch = h('input', { type: 'checkbox' });
    ui.warnGo = h('button', { type: 'button', class: 'lc-btn primary', text: 'Continue anyway', onclick: () => continueConvert() });
    ui.warnBox = h('div', { class: 'lc-warnbox', role: 'alert', hidden: true },
      h('strong', { text: 'Speed-creep assumption is off' }),
      h('p', { text: 'Level 50 rounding can change who is faster. A Pok\u00e9mon that beats another by only 1 Speed at level 100 can end up tied with it, or slower, after the conversion. With the assumption on, every converted Speed is checked against the fastest max-Speed Pok\u00e9mon it outspeeds, and raised by the fewest points needed to keep that advantage. Natures are never changed. With it off, Speed uses the plain conversion and may lose that advantage.' }),
      h('label', { class: 'lc-switch' }, ui.warnSwitch, h('span', { text: 'Turn on speed-creep assumption' })),
      h('div', { class: 'lc-actions' }, ui.warnGo, h('button', { type: 'button', class: 'lc-btn', text: 'Cancel', onclick: () => hideWarn() })));
    ui.teamStatus = h('p', { class: 'lc-status', role: 'status', 'aria-live': 'polite' });
    ui.teamList = h('ul', { class: 'lc-issues', hidden: true });
    ui.teamOut = h('textarea', { 'aria-label': 'Converted team', class: 'lc-team-out', readOnly: true, spellcheck: 'false' });
    ui.teamResult = h('div', { class: 'lc-result', hidden: true },
      h('h4', { text: 'Converted team' }), ui.teamOut,
      h('div', { class: 'lc-actions' }, h('button', { type: 'button', class: 'lc-btn primary', text: 'Copy converted team', onclick: () => copyTeam() })));
    const teamCard = h('section', { class: 'lc-card' },
      h('h3', { text: 'Convert a whole team' }),
      h('label', { class: 'lc-field lc-team-format' }, h('span', { text: 'Import team format' }), ui.teamFormat),
      ui.teamText,
      h('div', { class: 'lc-actions' }, ui.teamBtn),
      ui.warnBox, ui.teamStatus, ui.teamList, ui.teamResult);

    root.append(head, pickCard, ui.setCard, ui.tableCard, ui.outCard, ioCard, teamCard);

    // ---------- behaviour ----------
    function renderResults() {
      ui.results.replaceChildren(...state.results.map((p, i) => {
        const li = h('li', { role: 'option', 'aria-selected': i === state.active ? 'true' : 'false' }, h('span', { text: p.name }), h('small', { text: '#' + p.num }));
        li.addEventListener('mousedown', e => { e.preventDefault(); choose(p); });
        return li;
      }));
      const open = state.results.length > 0;
      ui.results.hidden = !open;
      ui.search.setAttribute('aria-expanded', String(open));
    }
    function search() {
      if (!state.dex) return;
      state.results = C.searchPokedex(state.dex.list, ui.search.value, 50);
      state.active = state.results.length ? 0 : -1;
      renderResults();
    }
    function closeResults() { state.results = []; state.active = -1; renderResults(); }
    function choose(p) {
      state.set = C.newSet(p);
      ui.search.value = p.name;
      closeResults(); refreshControls(); update();
      say(ui.status, ''); say(ui.outStatus, '');
    }
    on(ui.search, 'input', search);
    on(ui.search, 'focus', search);
    on(ui.search, 'blur', () => setTimeout(closeResults, 120));
    on(ui.search, 'keydown', e => {
      if (!state.results.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); state.active = (state.active + 1) % state.results.length; renderResults(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); state.active = (state.active - 1 + state.results.length) % state.results.length; renderResults(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(state.results[Math.max(0, state.active)]); }
      else if (e.key === 'Escape') { closeResults(); }
    });

    function resetPreset() { ui.preset.value = 'Custom'; }
    function setEv(stat, raw) {
      const set = state.set; if (!set) return;
      set.evs[stat] = raw; set.lastEdited = 'std';
      C.syncStat(set, stat, 'std', opts());
      resetPreset(); update();
    }
    function setPts(stat, raw) {
      const set = state.set; if (!set) return;
      set.pts[stat] = raw; set.lastEdited = 'champ';
      C.syncStat(set, stat, 'champ', opts());
      resetPreset(); update();
    }
    function normalize() {
      const set = state.set; if (!set) return;
      for (const s of STATS) { set.evs[s] = C.clamp(set.evs[s], 0, 252); set.pts[s] = C.clamp(set.pts[s], 0, 32); }
      set.level = C.clamp(set.level, 1, 100);
      ui.level.value = set.level;
      update(true);
    }

    on(ui.nature, 'change', () => { if (!state.set) return; state.set.nature = ui.nature.value; C.resync(state.set, opts()); resetPreset(); update(); });
    on(ui.ability, 'change', () => { if (state.set) state.set.ability = ui.ability.value; update(); });
    on(ui.item, 'input', () => { if (state.set) { state.set.item = ui.item.value; update(); } });
    ui.moves.forEach((el, i) => on(el, 'input', () => { if (state.set) { state.set.moves[i] = el.value; update(); } }));
    on(ui.level, 'input', () => { if (!state.set) return; state.set.level = ui.level.value; update(); });
    on(ui.level, 'change', normalize);
    on(ui.preset, 'change', () => {
      if (!state.set || ui.preset.value === 'Custom') return;
      C.applyPreset(state.set, ui.preset.value);
      ui.nature.value = state.set.nature;
      update();
    });

    // the single switch that controls the speed-creep assumption everywhere (panel, team converter, team button)
    function applyCreep() {
      const v = prefs.getCreep();
      if (v === state.creep) { ui.creepToggle.checked = v; return; }
      state.creep = v;
      ui.creepToggle.checked = v;
      if (state.set) C.syncStat(state.set, 'spe', state.set.lastEdited, opts());
      update(true);
    }
    const setCreep = on => { prefs.setCreep(!!on); applyCreep(); };
    on(ui.creepToggle, 'change', () => setCreep(ui.creepToggle.checked));
    const onPrefs = () => applyCreep();
    window.addEventListener('lazychamp-prefs', onPrefs);

    function creepText(i) {
      const who = i.names.slice(0, 3).join(', ') + (i.names.length > 3 ? ' and ' + (i.names.length - 3) + ' more' : '');
      const above = i.srcStat - i.srcMax === 1 ? 'just above' : 'above';
      if (i.kind === 'toChampions') {
        const lead = 'Speed-creep: your Showdown Speed (' + i.srcStat + ' at level ' + i.srcLevel + ') is ' + above + ' max-Speed ' + who + ' (' + i.srcMax + '). At level 50 that benchmark reaches ' + i.tgtMax + ', ';
        if (i.unreachable) return lead + 'and even 32 points only give you ' + i.tgtStat + ', so you cannot stay above it.';
        if (i.bumped) return lead + 'so Champions Speed was raised to ' + i.tgtStat + ' (' + plural(i.value - i.plain, 'point') + ' more than the plain conversion).';
        return lead + 'and your Champions Speed of ' + i.tgtStat + ' already stays above it.';
      }
      const lead = 'Speed-creep: your Champions Speed (' + i.srcStat + ' at level 50) is ' + above + ' max-Speed ' + who + ' (' + i.srcMax + '). At level ' + i.tgtLevel + ' that benchmark reaches ' + i.tgtMax + ', ';
      if (i.unreachable) return lead + 'and even 252 EVs only give you ' + i.tgtStat + ', so you cannot stay above it.';
      if (i.bumped) return lead + 'so Showdown Speed EVs were raised to ' + i.value + ' (' + plural(i.value - i.plain, 'EV') + ' more than the plain conversion), giving ' + i.tgtStat + '.';
      return lead + 'and your Showdown Speed of ' + i.tgtStat + ' already stays above it.';
    }

    // fill the form controls from the current set (when the Pokemon or set changes)
    function refreshControls() {
      const set = state.set; if (!set) return;
      ui.nature.value = set.nature;
      const abilities = C.abilityList(set.pkmn);
      if (set.ability && !abilities.includes(set.ability)) abilities.push(set.ability);
      ui.ability.replaceChildren(...(abilities.length ? abilities : ['']).map(a => h('option', { value: a, text: a || '(none)' })));
      ui.ability.value = set.ability;
      ui.item.value = set.item;
      ui.level.value = set.level;
      ui.moves.forEach((el, i) => { el.value = set.moves[i] || ''; });
      ui.preset.value = 'Custom';
    }

    // refresh numbers, sliders, totals and the set text
    function update(force) {
      const set = state.set, has = !!(set && set.pkmn);
      ui.empty.hidden = has; ui.species.hidden = !has; ui.setCard.hidden = !has; ui.tableCard.hidden = !has; ui.outCard.hidden = !has;
      if (!has) return;
      ui.name.textContent = set.pkmn.name;
      ui.types.replaceChildren(...set.pkmn.types.map(t => h('span', { class: 'lc-chip', text: t })));
      const level = C.clamp(set.level, 1, 100);
      ui.stdHead.textContent = 'Level ' + level;
      const fx = C.fixedHp(set.pkmn);
      for (const stat of STATS) {
        const r = ui.rows[stat], base = set.pkmn.baseStats[stat], isHp = stat === 'hp';
        const mult = C.natureMult(set.nature, stat);
        const ev = C.clamp(set.evs[stat], 0, 252), pt = C.clamp(set.pts[stat], 0, 32);
        r.base.textContent = base;
        r.nat.textContent = mult > 1 ? '+10%' : mult < 1 ? '\u221210%' : '';
        r.nat.className = 'lc-nat' + (mult > 1 ? ' up' : mult < 1 ? ' down' : '');
        r.evRange.value = ev; r.ptRange.value = pt;
        if (force || document.activeElement !== r.evNum) r.evNum.value = ev;
        if (force || document.activeElement !== r.ptNum) r.ptNum.value = pt;
        r.stdVal.textContent = C.stdStat(base, ev, level, mult, isHp, fx);
        r.champVal.textContent = C.champStat(base, pt, mult, isHp, fx);
      }
      const t = C.totals(set);
      ui.totEv.className = 'lc-total std' + (t.ev > 510 ? ' over' : '');
      ui.totEv.replaceChildren('EVs ', h('b', { text: t.ev }), ' of 510' + (t.ev > 510 ? ' (over by ' + (t.ev - 510) + ')' : ''));
      ui.totPt.className = 'lc-total champ' + (t.pt > 66 ? ' over' : '');
      ui.totPt.replaceChildren('Points ', h('b', { text: t.pt }), ' of 66' + (t.pt > 66 ? ' (over by ' + (t.pt - 66) + ')' : ''));
      const showCreep = state.creep && set.creep !== undefined;
      ui.creepNote.hidden = !showCreep;
      if (showCreep) ui.creepNote.textContent = set.creep ? creepText(set.creep) : 'Speed-creep: no Pok\u00e9mon is slower than your Speed, so there is nothing to protect.';
      ui.outStd.pre.textContent = C.formatPaste(set, 'standard');
      ui.outChamp.pre.textContent = C.formatPaste(set, 'champions');
    }

    function importFrom(kind) {
      const ta = kind === 'standard' ? ui.stdText : ui.champText;
      const text = ta.value.trim();
      if (!text) return say(ui.status, 'Paste a set first.', 'warn');
      if (!state.dex) return say(ui.status, 'The Pok\u00e9dex is still loading. Try again in a moment.', 'warn');
      const parsed = C.parsePaste(text, lookup, kind === 'champions');
      if (!parsed) return say(ui.status, 'Could not find that Pok\u00e9mon on the first line. Use the Showdown export format.', 'warn');
      const { set, converted } = kind === 'standard' ? C.importStandard(parsed, opts()) : C.importChampions(parsed, opts());
      state.set = set; ta.value = ''; ui.search.value = set.pkmn.name;
      closeResults(); refreshControls(); update(true);
      say(ui.outStatus, '');
      say(ui.status, converted ? 'Real EVs detected, converted to Champions points.' : 'Set imported.', 'ok');
    }

    async function copyFrom(kind) {
      const text = C.formatPaste(state.set, kind);
      const label = kind === 'standard' ? 'Showdown' : 'Champions';
      if (!text) return say(ui.outStatus, 'Choose a Pok\u00e9mon first.', 'warn');
      const ok = await copyText(text);
      say(ui.outStatus, ok ? label + ' set copied.' : 'The browser blocked copying. Turn on "Show ' + label + ' set" and copy the text by hand.', ok ? 'ok' : 'warn');
    }

    // ----- whole team -----
    function refreshTeamUi() {
      const toChamp = ui.teamFormat.value === 'showdown';
      ui.teamBtn.textContent = toChamp ? 'Convert Showdown \u2192 Champions' : 'Convert Champions \u2192 Showdown';
      ui.teamText.placeholder = toChamp
        ? 'Paste a whole team of Showdown sets (real EVs, up to 510 each)'
        : 'Paste a whole team of Champions sets (stat points, up to 66 each)';
      hideWarn(); clearTeamResult();
    }
    function clearTeamResult() {
      ui.teamList.replaceChildren(); ui.teamList.hidden = true;
      ui.teamResult.hidden = true; ui.teamOut.value = '';
      say(ui.teamStatus, '');
    }
    function hideWarn() { ui.warnBox.hidden = true; }
    function showWarn() {
      ui.warnSwitch.checked = false;
      ui.warnGo.textContent = 'Continue anyway';
      ui.warnBox.hidden = false;
    }
    on(ui.warnSwitch, 'change', () => { ui.warnGo.textContent = ui.warnSwitch.checked ? 'Continue' : 'Continue anyway'; });
    on(ui.teamFormat, 'change', refreshTeamUi);

    function runTeam() {
      clearTeamResult();
      if (!ui.teamText.value.trim()) return say(ui.teamStatus, 'Paste a team first.', 'warn');
      if (!state.dex) return say(ui.teamStatus, 'The Pok\u00e9dex is still loading. Try again in a moment.', 'warn');
      const toChampions = ui.teamFormat.value === 'showdown';
      if (toChampions && !state.creep) { showWarn(); return; }   // only this direction warns
      doConvert(toChampions ? 'toChampions' : 'toShowdown');
    }
    function continueConvert() {
      if (ui.warnSwitch.checked) setCreep(true);
      hideWarn();
      doConvert('toChampions');
    }
    function doConvert(mode) {
      clearTeamResult();
      const r = C.convertTeam(ui.teamText.value, mode, lookup, opts());
      if (r.empty) return say(ui.teamStatus, 'Paste a team first.', 'warn');
      const items = [];
      for (const res of r.results) {
        const who = 'Pok\u00e9mon ' + res.index + (res.name ? ' (' + res.name + ')' : '');
        for (const m of res.errors) items.push(['bad', who + ': ' + m]);
        for (const m of res.warnings) items.push(['warn', who + ': ' + m]);
        for (const m of res.notes) items.push(['note', who + ': ' + m]);
      }
      ui.teamList.replaceChildren(...items.map(([cls, text]) => h('li', { class: cls, text })));
      ui.teamList.hidden = !items.length;
      if (!r.ok) return say(ui.teamStatus, 'Nothing was converted. Fix the problems listed below and try again.', 'warn');
      ui.teamOut.value = r.output;
      ui.teamOut.rows = Math.min(20, r.output.split('\n').length + 1);
      ui.teamResult.hidden = false;
      const hasWarn = r.results.some(x => x.warnings.length);
      say(ui.teamStatus, 'Converted ' + plural(r.results.length, 'Pok\u00e9mon') + (hasWarn ? ', with warnings.' : '.'), hasWarn ? 'warn' : 'ok');
    }
    async function copyTeam() {
      const ok = await copyText(ui.teamOut.value);
      if (!ok) { ui.teamOut.focus(); ui.teamOut.select(); }
      say(ui.teamStatus, ok ? 'Converted team copied.' : 'The browser blocked copying. The text is selected, press Ctrl+C.', ok ? 'ok' : 'warn');
    }

    // data
    loadDex().then(dex => {
      state.dex = dex;
      state.benchmarks = C.buildBenchmarks(dex.list);
      ui.search.disabled = false;
      ui.badge.textContent = dex.source === 'live' ? 'Live Showdown data' : 'Offline copy from ' + (dex.date || 'bundled');
      ui.badge.className = 'lc-badge ' + (dex.source === 'live' ? 'live' : 'offline');
    }).catch(() => {
      ui.badge.textContent = 'Pok\u00e9dex failed to load';
      ui.badge.className = 'lc-badge offline';
    });

    refreshTeamUi();
    update();
    return { destroy() { window.removeEventListener('lazychamp-prefs', onPrefs); root.replaceChildren(); }, focus() { ui.search.focus(); } };
  }

  // ---------- tab logic shared by both clients ----------
  // Open (and focus) the tab when the Teambuilder opens. Close it when the Teambuilder AND every Team tab are closed.
  // Only those transitions act, so switching to another side tab, or closing LazyChamp by hand, is respected.
  function startTabLogic(adapter) {
    let tbPrev = false, activePrev = false;
    const sync = () => {
      const tb = adapter.teambuilderOpen();
      const active = tb || adapter.teamTabCount() > 0;
      const tbOpened = tb && !tbPrev;
      const allClosed = !active && activePrev;
      tbPrev = tb; activePrev = active;
      if (tbOpened && !adapter.hasTab()) setTimeout(() => { try { adapter.openTab(true); } catch (e) { console.warn('[LazyChamp] could not open the tab', e); } }, 0);
      else if (allClosed && adapter.hasTab()) setTimeout(() => { try { adapter.closeTab(); } catch (e) { console.warn('[LazyChamp] could not close the tab', e); } }, 0);
    };
    adapter.onChange(sync);
    sync();
  }

  // ---------- new client (Preact panels) ----------
  function registerNewClient() {
    const preact = window.preact, PS = window.PS;
    class LazyChampView extends preact.Component {
      shouldComponentUpdate() { return false; }
      componentDidMount() { this.app = mountApp(this.base); }
      componentWillUnmount() { if (this.app) this.app.destroy(); }
      render() { return preact.h('div', { class: 'lc-host' }); }
    }
    class LazyChampPanel extends window.PSRoomPanel {
      render() { return preact.h(window.PSPanelWrapper, { room: this.props.room }, preact.h(LazyChampView, null)); }
    }
    LazyChampPanel.id = ROOM_ID;
    LazyChampPanel.routes = [ROOM_ID];
    LazyChampPanel.title = 'LazyChamp';
    LazyChampPanel.location = 'right';   // secondary panel, next to Hellodex, usable while the Teambuilder is open
    LazyChampPanel.noURL = true;         // do not rewrite the address bar
    LazyChampPanel.icon = preact.h('i', { class: 'fa fa-calculator', 'aria-hidden': 'true' });
    PS.addRoomType(LazyChampPanel);

    startTabLogic({
      teambuilderOpen: () => !!(PS.rooms && PS.rooms.teambuilder),
      // "Team" tabs (one per team being edited) are rooms called team-<key> and exist only on the new client
      teamTabCount: () => Object.keys(PS.rooms || {}).filter(id => /^team-/.test(id)).length,
      hasTab: () => !!(PS.rooms && PS.rooms[ROOM_ID]),
      openTab: focus => PS.join(ROOM_ID, focus ? undefined : { autofocus: false }),
      closeTab: () => PS.leave(ROOM_ID),
      onChange: cb => { if (typeof PS.subscribe === 'function') PS.subscribe(cb); },
    });
  }

  function openNewClient() {
    const PS = window.PS;
    if (PS.rooms && PS.rooms[ROOM_ID] && PS.room && PS.room.id !== ROOM_ID && typeof PS.focusRoom === 'function') PS.focusRoom(ROOM_ID);
    else PS.join(ROOM_ID);
  }

  // ---------- classic client (Backbone rooms) ----------
  function classicOpen(focus) {
    const app = window.app;
    let room = app.rooms[CLASSIC_ID];
    if (!room) {
      room = app._addRoom(CLASSIC_ID, 'html', true, 'LazyChamp');   // adds the room to app.roomList
      if (!room || !room.el) throw new Error('the classic room could not be created');
      room.isSideRoom = true;
      app.sideRoomList.push(app.roomList.pop());                     // move it to the side-room tabs
      room.minWidth = 320; room.maxWidth = 1024;
      room.el.replaceChildren();                                     // drop the default "Page unavailable"
      const host = document.createElement('div');
      room.el.appendChild(host);
      const inst = mountApp(host);
      const originalDestroy = room.destroy;
      room.destroy = function () { try { inst.destroy(); } catch (e) { /* already gone */ } return originalDestroy && originalDestroy.apply(this, arguments); };
      app.topbar.updateTabbar();
    }
    if (focus) { app.focusRoomRight(CLASSIC_ID); app.topbar.updateTabbar(); }
  }

  function startClassic() {
    const app = window.app;
    startTabLogic({
      teambuilderOpen: () => !!(app.rooms && app.rooms.teambuilder),
      teamTabCount: () => 0,                         // the classic client has no Team tabs
      hasTab: () => !!(app.rooms && app.rooms[CLASSIC_ID]),
      openTab: focus => classicOpen(focus),
      closeTab: () => app.removeRoom(CLASSIC_ID),
      onChange: cb => setInterval(cb, 400),          // the classic client has no change event for rooms
    });
  }

  // ---------- fallback floating window ----------
  let overlay = null;
  function closeOverlay() {
    if (!overlay) return;
    overlay.app.destroy(); overlay.wrap.remove();
    document.removeEventListener('keydown', overlay.onKey, true);
    overlay = null;
  }
  function openOverlay() {
    if (overlay) { overlay.app.focus(); return; }
    const host = h('div');
    const wrap = h('div', { class: 'lc-overlay', role: 'dialog', 'aria-label': 'LazyChamp' },
      h('div', { class: 'lc-overlay-card' }, h('button', { type: 'button', class: 'lc-close', text: 'Close', 'aria-label': 'Close LazyChamp', onclick: closeOverlay }), host));
    document.body.appendChild(wrap);
    const onKey = e => { if (e.key === 'Escape') closeOverlay(); };
    document.addEventListener('keydown', onKey, true);
    overlay = { wrap, app: mountApp(host), onKey };
    overlay.app.focus();
  }

  // ---------- startup: find out which client this is ----------
  const newReady = () => {
    const PS = window.PS;
    return !!(PS && typeof PS.addRoomType === 'function' && typeof PS.join === 'function' && window.PSRoomPanel && window.PSPanelWrapper && window.preact);
  };
  const classicReady = () => {
    const app = window.app;
    return !!(!window.PS && app && typeof app.receive === 'function' && typeof app._addRoom === 'function' && app.rooms && app.roomList && app.sideRoomList && app.topbar);
  };
  function announceClient(value) {
    client = value;
    document.documentElement.dataset.lazychampClient = value || 'unknown';
  }
  const ready = new Promise(resolve => {
    let tries = 0;
    const poll = () => {
      if (newReady()) {
        try { registerNewClient(); announceClient('new'); }
        catch (e) { console.warn('[LazyChamp] could not set up the new client tab, using a floating window instead.', e); announceClient(null); }
        return resolve();
      }
      if (classicReady()) {
        try { startClassic(); announceClient('classic'); }
        catch (e) { console.warn('[LazyChamp] could not set up the classic client tab, using a floating window instead.', e); announceClient(null); }
        return resolve();
      }
      if (++tries > 150) { announceClient(null); return resolve(); }   // ~15 s: no recognisable client
      setTimeout(poll, 100);
    };
    poll();
  });

  function open() {
    try {
      if (client === 'new') return openNewClient();
      if (client === 'classic') return classicOpen(true);
    } catch (e) { console.warn('[LazyChamp] opening the tab failed, using a floating window.', e); }
    openOverlay();
  }

  window.addEventListener('message', ev => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (d && d.source === 'lazychamp-ext' && d.type === 'open') ready.then(open);
  });
  window.LazyChamp = { open, mountApp, ready, loadDex, prefs, h, copyText };
  Object.defineProperty(window.LazyChamp, 'client', { get: () => client, enumerable: true });
})();
