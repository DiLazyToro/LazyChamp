/**
 * LazyChamp team buttons. Runs inside the Pokemon Showdown page (injected by content.js after panel.js).
 *
 * Adds two small buttons next to "Add Pokemon" in the team you are editing:
 *   - Convert to Champions: converts THIS team (format + every set) with the same logic as the LazyChamp calculator.
 *   - A settings button: target format ([Champions] Draft / [Champions] NatDex Draft) and the speed-creep assumption.
 * Works on the new client (Team tab) and on the classic client (Teambuilder team view).
 * Nothing is changed until you press Convert, and a successful conversion offers Undo.
 */
(function () {
  'use strict';
  if (window.__lazychampConverterLoaded) return;
  window.__lazychampConverterLoaded = true;

  const C = window.LazyChampCore;
  const LC = window.LazyChamp;
  if (!C || !LC || !LC.ready) return;
  const h = LC.h;

  const CONFIG_ID = 'lazychampconfig';
  const TARGET_LABEL = { draft: '[Champions] Draft', natdex: '[Champions] NatDex Draft' };
  const ADD_SELECTOR = 'button[name="addpokemon"].big, button[name="addPokemon"].big';
  let client = null;
  let busy = false;

  // ---------- formats: always read from what Showdown has loaded right now ----------
  function findChampionsFormats() {
    const ids = Object.keys(window.BattleFormats || {}).filter(id => /champions/.test(id) && /draft/.test(id));
    const shortest = list => list.sort((a, b) => a.length - b.length)[0] || null;
    return {
      draft: shortest(ids.filter(id => !/natdex|nationaldex/.test(id))),
      natdex: shortest(ids.filter(id => /natdex|nationaldex/.test(id))),
    };
  }

  /** Gen 1 and 2 (also OMs that run on a gen 1/2 mod), Let's Go (no EVs) and Champions teams are left alone. */
  function eligibility(formatId) {
    let f = null;
    try { f = window.Dex && window.Dex.formats ? window.Dex.formats.get(formatId) : null; } catch (e) { f = null; }
    const id = String(formatId || '');
    const mod = String((f && f.mod) || '');
    const gen = f && typeof f.gen === 'number' ? f.gen : null;
    if ((gen !== null && gen <= 2) || /^gen[12](?!\d)/.test(mod) || /^gen[12](?!\d)/.test(id)) return { ok: false, info: f, reason: 'gen12' };
    if (f && f.isLetsGo) return { ok: false, info: f, reason: 'letsgo' };
    if ((f && f.isChampions) || /champions/.test(id)) return { ok: false, info: f, reason: 'champions' };
    return { ok: true, info: f };
  }

  const dexFor = formatId => { try { return window.Dex.forFormat(formatId); } catch (e) { return undefined; } };

  // ---------- one adapter per client: how to read, write and undo the team being edited ----------
  const NewClient = {
    context(roomEl) {
      const PS = window.PS;
      if (!roomEl || !PS || !PS.teams) return null;
      const roomId = roomEl.id.replace(/^room-/, '');
      const key = roomId.slice(5);
      const team = PS.teams.byKey[key];
      const room = PS.rooms && PS.rooms[roomId];
      if (!team || !room || !window.Teams) return null;
      return { key: 'n:' + key, team, room };
    },
    format: ctx => ctx.team.format,
    readonly: ctx => !!(ctx.room.editor && ctx.room.editor.readonly),
    sets: ctx => window.Teams.unpack(ctx.team.packedTeam),
    toText: (ctx, sets) => window.Teams.export(sets, dexFor(ctx.team.format)),
    fromText: (ctx, text) => window.Teams.import(text),
    snapshot: ctx => ({ format: ctx.team.format, packed: ctx.team.packedTeam }),
    stillHere: ctx => !!(window.PS.teams.byKey[ctx.key.slice(2)] === ctx.team),
    write(ctx, formatId, packed) {
      ctx.team.packedTeam = packed;
      ctx.team.iconCache = null;
      ctx.room.setFormat(formatId);
      ctx.room.save();
      ctx.room.update(null);
    },
    apply(ctx, formatId, sets) { this.write(ctx, formatId, window.Teams.pack(sets)); },
    restore(ctx, snap) { this.write(ctx, snap.format, snap.packed); },
  };

  const Classic = {
    context() {
      const app = window.app;
      const tb = app && app.rooms && app.rooms.teambuilder;
      if (!tb || !tb.curTeam || tb.curSet || tb.exportMode || !tb.curSetList || !window.Storage) return null;
      const idx = window.Storage.teams ? window.Storage.teams.indexOf(tb.curTeam) : -1;
      return { key: 'c:' + idx + ':' + tb.curTeam.name, tb, team: tb.curTeam };
    },
    format: ctx => ctx.team.format,
    readonly: () => false,
    sets: ctx => ctx.tb.curSetList,
    toText: (ctx, sets) => window.Storage.exportTeam(sets),
    fromText: (ctx, text) => window.Storage.importTeam(text),
    snapshot: ctx => ({ format: ctx.team.format, packed: window.Storage.packTeam(ctx.tb.curSetList) }),
    stillHere: ctx => !!(window.app.rooms.teambuilder && window.app.rooms.teambuilder.curTeam === ctx.team),
    apply(ctx, formatId, sets) {
      const tb = ctx.tb;
      tb.curSetList = sets;
      window.Storage.activeSetList = sets;
      tb.curTeam.team = window.Storage.packTeam(sets);
      tb.curTeam.iconCache = '';
      tb.changeFormat(formatId);   // switches format, saves and redraws
    },
    restore(ctx, snap) { this.apply(ctx, snap.format, window.Storage.unpackTeam(snap.packed)); },
  };

  // ---------- notices under the buttons ----------
  const notices = {};
  function setNotice(key, n) {
    n.v = (notices[key] ? notices[key].v : 0) + 1;
    notices[key] = n;
    scan();
  }
  function renderNotice(el, key) {
    const n = notices[key];
    if (el.dataset.k !== key) { el.dataset.k = key; el.dataset.v = ''; }
    if (!n) { el.hidden = true; el.replaceChildren(); el.dataset.v = ''; return; }
    if (el.dataset.v === String(n.v)) return;
    el.dataset.v = String(n.v);
    el.hidden = false;
    el.className = 'lc-notice ' + n.kind;
    const shown = n.lines.slice(0, 14);
    const more = n.lines.length - shown.length;
    const parts = [
      h('div', { class: 'lc-notice-head' },
        h('strong', { text: n.title }),
        h('span', { class: 'lc-notice-actions' },
          n.undo ? h('button', { type: 'button', class: 'lc-notice-btn', text: 'Undo', onclick: () => n.undo() }) : null,
          h('button', { type: 'button', class: 'lc-notice-btn', text: 'Dismiss', 'aria-label': 'Dismiss', onclick: () => { delete notices[key]; scan(); } }))),
    ];
    if (shown.length) parts.push(h('ul', null, shown.map(l => h('li', { class: l.cls, text: l.text }))));
    if (more > 0) parts.push(h('p', { class: 'lc-notice-more', text: '+' + more + ' more' }));
    el.replaceChildren(...parts);   // never pass null here: it would be written as the text "null"
  }

  // ---------- the conversion ----------
  async function convert(adapter, getCtx) {
    if (busy) return;
    const ctx = getCtx();
    if (!ctx) return;
    const key = ctx.key;
    const fail = (title, lines) => setNotice(key, { kind: 'bad', title, lines: (lines || []).map(t => ({ cls: 'bad', text: t })), undo: null });
    busy = true;
    try {
      const fmtId = adapter.format(ctx);
      const el = eligibility(fmtId);
      if (!el.ok) return fail('This format cannot be converted.');
      if (adapter.readonly(ctx)) return fail('Nothing was changed.', ['This team is read-only. Make it editable first.']);

      const target = findChampionsFormats()[LC.prefs.getTarget()];
      if (!target) {
        return fail('Nothing was changed.', ['Showdown\'s format list does not include ' + TARGET_LABEL[LC.prefs.getTarget()] + ' right now. Check that you are connected to Showdown, or pick the other format in the settings.']);
      }

      const dex = await LC.loadDex();
      const fresh = getCtx();                      // the page may have changed while the Pokedex loaded
      if (!fresh || fresh.key !== key) return;
      const all = adapter.sets(fresh) || [];
      const sets = all.filter(s => s && s.species);
      if (!sets.length) return fail('Nothing was changed.', ['Add a Pok\u00e9mon to the team first.']);

      // Showdown pastes leave out the level when it is the format's default: write it out so speed-creep sees it.
      const defaultLevel = (el.info && el.info.defaultLevel) || 100;
      const withLevel = sets.map(s => Object.assign({}, s, { level: s.level || defaultLevel }));
      const text = adapter.toText(fresh, withLevel).split('\n').filter(l => l.trim() !== '-').join('\n');

      const lookup = n => dex.byName[String(n).trim().toLowerCase()] || null;
      const r = C.convertTeam(text, 'toChampions', lookup, { speedCreep: LC.prefs.getCreep(), benchmarks: C.buildBenchmarks(dex.list) });
      const lines = [];
      for (const res of r.results) {
        const who = 'Pok\u00e9mon ' + res.index + (res.name ? ' (' + res.name + ')' : '');
        for (const m of res.errors) lines.push({ cls: 'bad', text: who + ': ' + m });
        for (const m of res.warnings) lines.push({ cls: 'warn', text: who + ': ' + m });
        for (const m of res.notes) lines.push({ cls: 'note', text: who + ': ' + m });
      }
      if (!r.ok) return setNotice(key, { kind: 'bad', title: 'Nothing was changed. Fix these first:', lines, undo: null });

      const converted = adapter.fromText(fresh, r.output);
      if (!converted || converted.length !== sets.length) {
        return fail('Nothing was changed.', ['Showdown could not read the converted team back. Please report this.']);
      }

      const snap = adapter.snapshot(fresh);
      adapter.apply(fresh, target, converted);
      const hasWarn = r.results.some(x => x.warnings.length);
      setNotice(key, {
        kind: hasWarn ? 'warn' : 'ok',
        title: 'Converted ' + sets.length + ' Pok\u00e9mon to ' + TARGET_LABEL[LC.prefs.getTarget()] + (hasWarn ? ', with warnings.' : '.'),
        lines,
        undo: () => {
          const again = getCtx();
          if (!again || again.key !== key || !adapter.stillHere(again)) {
            return setNotice(key, { kind: 'bad', title: 'Could not undo: open that team first.', lines: [], undo: null });
          }
          adapter.restore(again, snap);
          setNotice(key, { kind: 'ok', title: 'Restored the team as it was (' + (snap.format || 'no format') + ').', lines: [], undo: null });
        },
      });
    } catch (e) {
      console.warn('[LazyChamp] conversion failed', e);
      fail('Nothing was changed.', ['Something went wrong: ' + (e && e.message ? e.message : e)]);
    } finally {
      busy = false;
    }
  }

  // ---------- settings box (same content in both clients) ----------
  function buildConfig(root) {
    root.classList.add('lc-config');
    root.replaceChildren();
    const select = h('select', { 'aria-label': 'Format to convert to' },
      h('option', { value: 'draft', text: TARGET_LABEL.draft }),
      h('option', { value: 'natdex', text: TARGET_LABEL.natdex }));
    select.value = LC.prefs.getTarget();
    const missing = h('p', { class: 'lc-config-warn', hidden: true, text: 'Showdown\'s format list does not include this format right now.' });
    const refresh = () => { missing.hidden = !!findChampionsFormats()[select.value]; };
    select.addEventListener('change', () => { LC.prefs.setTarget(select.value); refresh(); });
    const creep = h('input', { type: 'checkbox' });
    creep.checked = LC.prefs.getCreep();
    creep.addEventListener('change', () => LC.prefs.setCreep(creep.checked));
    const sync = () => {
      if (!root.isConnected) { window.removeEventListener('lazychamp-prefs', sync); return; }
      creep.checked = LC.prefs.getCreep();
      select.value = LC.prefs.getTarget();
      refresh();
    };
    window.addEventListener('lazychamp-prefs', sync);
    refresh();
    root.append(
      h('h4', { text: 'Convert to Champions' }),
      h('label', { class: 'lc-config-field' }, h('span', { text: 'Format to convert to' }), select),
      missing,
      h('label', { class: 'lc-config-switch' }, creep, h('span', { text: 'Speed-creep assumption' })),
      h('p', { class: 'lc-config-help', text: 'Keeps each Pok\u00e9mon\'s Speed above the fastest max-Speed Pok\u00e9mon it outspeeds, even after level 50 rounding. It is the same switch as in the LazyChamp tab.' }),
      h('p', { class: 'lc-config-help', text: 'Converting changes this team\'s format and rewrites its EVs as Champions points. Use Undo right after if you change your mind.' }));
  }

  // new client: a native Showdown popup, opened by the button's data-href
  function registerConfigPanel() {
    const preact = window.preact;
    class ConfigView extends preact.Component {
      shouldComponentUpdate() { return false; }
      componentDidMount() { buildConfig(this.base); }
      render() { return preact.h('div', { class: 'lc-config-host' }); }
    }
    class ConfigPanel extends window.PSRoomPanel {
      render() { return preact.h(window.PSPanelWrapper, { room: this.props.room, width: 330 }, preact.h('div', { class: 'pad' }, preact.h(ConfigView, null))); }
    }
    ConfigPanel.id = CONFIG_ID;
    ConfigPanel.routes = [CONFIG_ID];
    ConfigPanel.location = 'popup';
    ConfigPanel.noURL = true;
    ConfigPanel.title = 'LazyChamp settings';
    window.PS.addRoomType(ConfigPanel);
  }

  // classic client: a small box under the button
  let cfgBox = null;
  function closeConfigBox() {
    if (!cfgBox) return;
    cfgBox.box.remove();
    document.removeEventListener('mousedown', cfgBox.onDoc, true);
    document.removeEventListener('keydown', cfgBox.onKey, true);
    cfgBox = null;
  }
  function toggleConfigBox(anchor) {
    if (cfgBox) return closeConfigBox();
    const box = h('div', { class: 'lc-cfgbox', role: 'dialog', 'aria-label': 'LazyChamp conversion settings' });
    buildConfig(box);
    document.body.appendChild(box);
    const r = anchor.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 8)) + 'px';
    box.style.top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - box.offsetHeight - 8)) + 'px';
    const onDoc = e => { if (!box.contains(e.target) && !anchor.contains(e.target)) closeConfigBox(); };
    const onKey = e => { if (e.key === 'Escape') closeConfigBox(); };
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    cfgBox = { box, onDoc, onKey };
  }

  // ---------- putting the buttons next to "Add Pokemon" ----------
  function buildButtons(adapter, getCtx) {
    const convertBtn = h('button', { type: 'button', class: 'button big lc-conv', title: 'Convert this team to Champions' },
      h('i', { class: 'fa fa-exchange', 'aria-hidden': 'true' }), ' Convert to Champions');
    convertBtn.addEventListener('click', () => convert(adapter, getCtx));
    const cfgBtn = h('button', { type: 'button', class: 'button big lc-cfg', 'aria-label': 'LazyChamp conversion settings', title: 'Conversion settings' },
      h('i', { class: 'fa fa-cog', 'aria-hidden': 'true' }));
    if (client === 'new') cfgBtn.setAttribute('data-href', CONFIG_ID);   // Showdown opens the popup room
    else cfgBtn.addEventListener('click', () => toggleConfigBox(cfgBtn));
    return h('span', { class: 'lc-inject' }, ' ', convertBtn, ' ', cfgBtn);
  }

  function clean(list) {
    for (const el of list.querySelectorAll('.lc-inject, .lc-notice, .lc-fallback-host')) el.remove();
  }

  // list = the element that holds the sets; addBtn = Showdown's own button (missing when the team is full)
  // A team that cannot be converted (gen 1/2, Let's Go, already Champions) gets no buttons, but a notice that is
  // still on screen (for example the Undo of a conversion that just made it a Champions team) stays visible.
  function place(list, addBtn, tag, adapter, getCtx) {
    const ctx = getCtx();
    if (!ctx) { clean(list); return; }
    const eligible = eligibility(adapter.format(ctx)).ok;
    if (!eligible && !notices[ctx.key]) { clean(list); return; }
    const fallback = list.querySelector(':scope > .lc-fallback-host');
    let target;
    if (addBtn) {
      if (fallback) fallback.remove();
      target = addBtn.parentElement;
    } else {
      target = fallback || list.appendChild(h(tag, { class: 'lc-fallback-host' }));
    }
    const buttons = target.querySelector(':scope > .lc-inject');
    if (eligible && !buttons) target.appendChild(buildButtons(adapter, getCtx));
    else if (!eligible && buttons) buttons.remove();
    let note = target.querySelector(':scope > .lc-notice');
    if (!note) { note = h('div', { class: 'lc-notice', hidden: true }); target.appendChild(note); }
    renderNotice(note, ctx.key);
  }

  function scan() {
    if (client === 'new') {
      for (const list of document.querySelectorAll('[id^="room-team-"] .set-list')) {
        const roomEl = list.closest('[id^="room-team-"]');
        place(list, list.querySelector('button[name="addpokemon"].big'), 'p', NewClient, () => NewClient.context(roomEl));
      }
    } else if (client === 'classic') {
      for (const list of document.querySelectorAll('.teamchartbox ol.teamchart')) {
        place(list, list.querySelector('button[name="addPokemon"].big'), 'li', Classic, () => Classic.context());
      }
    }
  }

  let timer = null;
  const scheduleScan = () => { if (timer) return; timer = setTimeout(() => { timer = null; try { scan(); } catch (e) { console.warn('[LazyChamp]', e); } }, 100); };

  LC.ready.then(() => {
    client = LC.client;
    if (client !== 'new' && client !== 'classic') return;   // floating-window mode has no team to convert
    if (client === 'new') {
      try { registerConfigPanel(); } catch (e) { console.warn('[LazyChamp] settings popup unavailable', e); }
    }
    new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true, characterData: true });
    scheduleScan();
  });

  LC.converter = { eligibility, findChampionsFormats, scan };
})();
