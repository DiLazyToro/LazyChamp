/**
 * LazyChamp core: pure logic, no DOM. Works in the browser (window.LazyChampCore) and in Node (tests).
 * Champions stats: level 50, IVs fixed at 31, 0-32 stat points per stat, 66 total.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LazyChampCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  const STAT_LABEL = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed' };
  const PASTE_LABEL = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

  const NATURES = [
    ['Hardy'], ['Lonely', 'atk', 'def'], ['Brave', 'atk', 'spe'], ['Adamant', 'atk', 'spa'], ['Naughty', 'atk', 'spd'],
    ['Bold', 'def', 'atk'], ['Docile'], ['Relaxed', 'def', 'spe'], ['Impish', 'def', 'spa'], ['Lax', 'def', 'spd'],
    ['Timid', 'spe', 'atk'], ['Hasty', 'spe', 'def'], ['Serious'], ['Jolly', 'spe', 'spa'], ['Naive', 'spe', 'spd'],
    ['Modest', 'spa', 'atk'], ['Mild', 'spa', 'def'], ['Quiet', 'spa', 'spe'], ['Bashful'], ['Rash', 'spa', 'spd'],
    ['Calm', 'spd', 'atk'], ['Gentle', 'spd', 'def'], ['Sassy', 'spd', 'spe'], ['Careful', 'spd', 'spa'], ['Quirky'],
  ].map(([name, raised, lowered]) => ({ name, raised: raised || null, lowered: lowered || null }));

  const zeroes = () => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });

  function makePreset(label, nature, maxed) {
    const std = zeroes(), champ = zeroes();
    for (const s of maxed) { std[s] = 252; champ[s] = 32; }
    return { label, nature, std, champ };
  }
  const PRESETS = [
    makePreset('Custom', null, []),
    makePreset('Max Speed (Jolly)', 'Jolly', ['spe']),
    makePreset('Max Speed (Timid)', 'Timid', ['spe']),
    makePreset('Max Speed (Naive)', 'Naive', ['spe']),
    makePreset('Max Speed (No Nature)', 'Hardy', ['spe']),
    makePreset('Max Attack (Adamant)', 'Adamant', ['atk']),
    makePreset('Max Attack (No Nature)', 'Hardy', ['atk']),
    makePreset('Max Defense (Impish)', 'Impish', ['def']),
    makePreset('Max Defense (Bold)', 'Bold', ['def']),
    makePreset('Max SpA (Modest)', 'Modest', ['spa']),
    makePreset('Max SpA (No Nature)', 'Hardy', ['spa']),
    makePreset('Max SpD (Careful)', 'Careful', ['spd']),
    makePreset('Max SpD (No Nature)', 'Hardy', ['spd']),
    makePreset('Max HP', 'Hardy', ['hp']),
    makePreset('Physical Sweeper (Jolly)', 'Jolly', ['atk', 'spe']),
    makePreset('Special Sweeper (Timid)', 'Timid', ['spa', 'spe']),
    makePreset('Bulky Attacker (Adamant)', 'Adamant', ['hp', 'atk']),
    makePreset('Bulky Wall (Impish)', 'Impish', ['hp', 'def']),
  ];
  PRESETS[0].std = null; PRESETS[0].champ = null;

  function clamp(v, min, max) {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function natureMult(natureName, stat) {
    const n = NATURES.find(x => x.name === natureName);
    if (!n || !n.raised) return 1;
    if (n.raised === stat) return 1.1;
    if (n.lowered === stat) return 0.9;
    return 1;
  }

  // ---- stat formulas (verified against Showdown's own getStat in tests) ----
  function fixedHp(pkmn) {
    return pkmn && (pkmn.maxHP || (pkmn.baseStats && pkmn.baseStats.hp === 1 ? 1 : 0)) || 0;
  }

  function stdStat(base, ev, level, mult, isHp, fixedHP) {
    if (isHp && fixedHP) return fixedHP;
    const core = Math.floor((2 * base + 31 + Math.floor(ev / 4)) * level / 100);
    if (isHp) return core + level + 10;
    return Math.floor((core + 5) * mult);
  }

  function champStat(base, points, mult, isHp, fixedHP) {
    if (isHp && fixedHP) return fixedHP;
    if (isHp) return base + 75 + points;
    return Math.floor((base + 20 + points) * mult);
  }

  /** Smallest Champions points whose level-50 stat is at least the level-50 stat of this EV investment. */
  function evToPoints(base, ev, mult, isHp, fixedHP) {
    const target = stdStat(base, ev, 50, mult, isHp, fixedHP);
    for (let p = 0; p <= 32; p++) if (champStat(base, p, mult, isHp, fixedHP) >= target) return p;
    return 32;
  }

  /** Smallest EVs (steps of 4) whose level-50 stat is at least the stat of these Champions points. */
  function pointsToEv(base, points, mult, isHp, fixedHP) {
    const target = champStat(base, points, mult, isHp, fixedHP);
    for (let ev = 0; ev <= 252; ev += 4) if (stdStat(base, ev, 50, mult, isHp, fixedHP) >= target) return ev;
    return 252;
  }

  // ---- speed-creep assumption ----
  // Idea: if your Speed outspeeds a max-Speed Pokemon (252 EVs / 32 points, +Speed nature) in the source format,
  // it must still outspeed that same Pokemon's max Speed in the target format, despite rounding at the new level.
  function buildBenchmarks(list) {
    const byBase = new Map();
    for (const p of list) {
      const b = p.baseStats.spe;
      if (!byBase.has(b)) byBase.set(b, []);
      byBase.get(b).push(p.name);
    }
    const rank = n => (n.indexOf('-') === -1 ? 0 : 1);
    return [...byBase.entries()]
      .map(([base, names]) => ({ base, names: names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)) }))
      .sort((a, b) => a.base - b.base);
  }
  const maxSpeedStd = (b, level) => stdStat(b, 252, level, 1.1, false, 0);
  const maxSpeedChamp = b => champStat(b, 32, 1.1, false, 0);

  /** The benchmark with the highest max Speed that is still below `speed` (exactly speed - 1 when one exists). */
  function findBenchmark(benchmarks, speed, maxAt) {
    let best = null;
    for (const bm of benchmarks) {
      const max = maxAt(bm.base);
      if (max >= speed) continue;
      if (!best || max > best.max || (max === best.max && bm.base > best.base)) best = { base: bm.base, names: bm.names, max };
    }
    return best;
  }

  /** Showdown EVs (at `level`) -> Champions points, keeping Speed above the benchmark's level 50 max. */
  function evToPointsCreep(base, ev, mult, level, benchmarks) {
    const plain = evToPoints(base, ev, mult, false, 0);
    const srcStat = stdStat(base, ev, level, mult, false, 0);
    const bm = findBenchmark(benchmarks, srcStat, b => maxSpeedStd(b, level));
    if (!bm) return { value: plain, info: null };
    const tgtMax = maxSpeedChamp(bm.base);
    let needed = 32, reachable = false;
    for (let p = 0; p <= 32; p++) if (champStat(base, p, mult, false, 0) > tgtMax) { needed = p; reachable = true; break; }
    const value = Math.max(plain, needed);
    return { value, info: {
      kind: 'toChampions', names: bm.names, benchBase: bm.base, srcLevel: level, srcStat, srcMax: bm.max,
      tgtLevel: 50, tgtMax, tgtStat: champStat(base, value, mult, false, 0), plain, value, bumped: value > plain, unreachable: !reachable,
    } };
  }

  /** Champions points -> Showdown EVs, keeping Speed above the benchmark's max at the Showdown `level`. */
  function pointsToEvCreep(base, points, mult, level, benchmarks) {
    const plain = pointsToEv(base, points, mult, false, 0);
    const srcStat = champStat(base, points, mult, false, 0);
    const bm = findBenchmark(benchmarks, srcStat, maxSpeedChamp);
    if (!bm) return { value: plain, info: null };
    const tgtMax = maxSpeedStd(bm.base, level);
    let needed = 252, reachable = false;
    for (let ev = 0; ev <= 252; ev += 4) if (stdStat(base, ev, level, mult, false, 0) > tgtMax) { needed = ev; reachable = true; break; }
    const value = Math.max(plain, needed);
    return { value, info: {
      kind: 'toShowdown', names: bm.names, benchBase: bm.base, srcLevel: 50, srcStat, srcMax: bm.max,
      tgtLevel: level, tgtMax, tgtStat: stdStat(base, value, level, mult, false, 0), plain, value, bumped: value > plain, unreachable: !reachable,
    } };
  }

  // ---- Pokedex ----
  function buildPokedex(data) {
    const slim = (id, p) => ({
      id, name: p.name, num: p.num, baseStats: p.baseStats,
      types: p.types || ['???'], abilities: p.abilities || {},
      requiredItem: p.requiredItem || null, maxHP: p.maxHP || null,
    });
    const usable = [];
    const byName = {};
    for (const [id, p] of Object.entries(data)) {
      if (!p.baseStats || !(p.num > 0)) continue;
      if (p.isNonstandard === 'Custom' || p.isNonstandard === 'CAP') continue;
      const entry = { raw: p, slim: slim(id, p) };
      usable.push(entry);
      byName[p.name.toLowerCase()] = entry.slim;
    }
    const isMega = p => /Mega/.test(p.forme || '');
    const selectable = usable.filter(({ raw: p }) =>
      !p.isCosmeticForme && p.forme !== 'Gmax' && !/Totem/.test(p.forme || '') && (!p.battleOnly || isMega(p)));
    const score = p => (p.baseSpecies && p.name !== p.baseSpecies ? 1 : 0) + (p.changesFrom ? 1 : 0) + (p.placeholderFor ? 1 : 0);
    const keyOf = p => [
      p.baseSpecies || p.name,
      STATS.map(k => p.baseStats[k]).join('/'),
      (p.types || []).join('/'),
      Object.values(p.abilities || {}).join('/'),
    ].join('|');
    const best = new Map();
    for (const entry of selectable) {
      const k = keyOf(entry.raw);
      const cur = best.get(k);
      if (!cur || score(entry.raw) < score(cur.raw)) best.set(k, entry);
    }
    const list = [...best.values()].map(e => e.slim).sort((a, b) => a.num - b.num || a.name.localeCompare(b.name));
    return { list, byName };
  }

  function searchPokedex(list, query, limit) {
    const max = limit || 50;
    const q = String(query || '').trim().toLowerCase();
    if (!q) return list.slice(0, max);
    const starts = [], contains = [];
    for (const p of list) {
      const n = p.name.toLowerCase();
      if (String(p.num) === q || n.startsWith(q)) starts.push(p);
      else if (n.includes(q)) contains.push(p);
    }
    return starts.concat(contains).slice(0, max);
  }

  function abilityList(pkmn) {
    if (!pkmn) return [];
    const order = { '0': 0, '1': 1, '2': 2, 'H': 3, 'S': 4 };
    return Object.entries(pkmn.abilities || {})
      .filter(([k]) => k in order)
      .sort((a, b) => order[a[0]] - order[b[0]])
      .map(([, name]) => name);
  }

  // ---- sets ----
  function newSet(pkmn) {
    return {
      pkmn,
      nature: 'Hardy',
      ability: abilityList(pkmn)[0] || '',
      item: (pkmn && pkmn.requiredItem) || '',
      moves: ['', '', '', ''],
      level: 100,
      evs: zeroes(),
      pts: zeroes(),
      lastEdited: 'champ',
    };
  }

  /**
   * Convert one stat from the side the user edited (`from`: 'std' or 'champ') to the other side.
   * opts = { speedCreep: boolean, benchmarks: [...] } enables the speed-creep assumption for Speed only.
   */
  function syncStat(set, stat, from, opts) {
    const base = set.pkmn.baseStats[stat], isHp = stat === 'hp', fx = fixedHp(set.pkmn);
    const mult = natureMult(set.nature, stat);
    const creep = stat === 'spe' && !!(opts && opts.speedCreep && opts.benchmarks && opts.benchmarks.length);
    if (from === 'std') {
      const ev = clamp(set.evs[stat], 0, 252);
      if (creep) {
        const r = evToPointsCreep(base, ev, mult, clamp(set.level, 1, 100), opts.benchmarks);
        set.pts[stat] = r.value; set.creep = r.info;
      } else {
        set.pts[stat] = evToPoints(base, ev, mult, isHp, fx);
        if (stat === 'spe') set.creep = null;
      }
    } else {
      const pt = clamp(set.pts[stat], 0, 32);
      if (creep) {
        const r = pointsToEvCreep(base, pt, mult, clamp(set.level, 1, 100), opts.benchmarks);
        set.evs[stat] = r.value; set.creep = r.info;
      } else {
        set.evs[stat] = pointsToEv(base, pt, mult, isHp, fx);
        if (stat === 'spe') set.creep = null;
      }
    }
  }

  function resync(set, opts) {
    if (!set || !set.pkmn) return;
    for (const stat of STATS) syncStat(set, stat, set.lastEdited, opts);
  }

  function applyPreset(set, label) {
    const preset = PRESETS.find(p => p.label === label);
    if (!preset || !preset.std) return false;
    set.nature = preset.nature;
    set.evs = Object.assign(zeroes(), preset.std);
    set.pts = Object.assign(zeroes(), preset.champ);
    set.lastEdited = 'champ';
    set.creep = undefined;
    return true;
  }

  function totals(set) {
    let ev = 0, pt = 0;
    for (const s of STATS) { ev += clamp(set.evs[s], 0, 252); pt += clamp(set.pts[s], 0, 32); }
    return { ev, pt };
  }


  // ---- whole-team conversion ----
  function spreadText(values, max) {
    return STATS.filter(k => clamp(values[k], 0, max) > 0).map(k => clamp(values[k], 0, max) + ' ' + PASTE_LABEL[k]).join(' / ');
  }

  function splitTeam(text) {
    return String(text || '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)
      .map(b => b.split('\n').map(l => l.trim()).filter(l => l && !/^===/.test(l)))
      .filter(lines => lines.length);
  }

  function withSpread(lines, text) {
    const out = lines.slice();
    const i = out.findIndex(l => /^(EVs|SPs):/i.test(l));
    if (i >= 0) { if (text) out[i] = 'EVs: ' + text; else out.splice(i, 1); return out; }
    if (!text) return out;
    let at = out.findIndex(l => / Nature$/.test(l));
    if (at < 0) at = out.findIndex(l => l.startsWith('- '));
    if (at < 0) at = out.length;
    out.splice(at, 0, 'EVs: ' + text);
    return out;
  }

  function withLevel(lines, level) {
    const out = lines.slice();
    const i = out.findIndex(l => /^Level:/i.test(l));
    if (level == null) { if (i >= 0) out.splice(i, 1); return out; }
    if (i >= 0) { out[i] = 'Level: ' + level; return out; }
    const a = out.findIndex(l => /^Ability:/i.test(l));
    out.splice((a >= 0 ? a : 0) + 1, 0, 'Level: ' + level);
    return out;
  }

  function stripIvs(lines) {
    const odd = [];
    const kept = lines.filter(l => {
      if (!/^IVs:/i.test(l)) return true;
      for (const part of l.replace(/^IVs:/i, '').split('/')) {
        const m = part.trim().match(/^(\d+)\s+(.+)$/);
        if (m && parseInt(m[1], 10) !== 31) odd.push(part.trim());
      }
      return false;
    });
    return { lines: kept, odd };
  }

  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const whoIs = names => names.slice(0, 3).join(', ');

  /**
   * mode 'toChampions': Showdown paste (real EVs, max 510) -> Champions paste (points, Level 50).
   * mode 'toShowdown' : Champions paste (points, max 66)   -> Showdown paste (real EVs, no Level line).
   * Original lines (nickname, item, ability, moves, Tera Type...) are kept; only EVs, Level and IVs lines change.
   */
  function convertBlock(lines, mode, lookup, opts, index) {
    const toChampions = mode === 'toChampions';
    const res = { index, name: '', errors: [], warnings: [], notes: [], lines: null };
    const parsed = parsePaste(lines.join('\n'), lookup, !toChampions);
    if (!parsed) { res.errors.push('Could not find "' + lines[0] + '" in the Pok\u00e9dex. Check the name on the first line.'); return res; }
    res.name = parsed.pkmn.name;
    const raw = parsed.evsRaw;
    const total = STATS.reduce((a, k) => a + raw[k], 0);

    if (toChampions) {
      for (const k of STATS) if (raw[k] > 252) res.errors.push(PASTE_LABEL[k] + ' has ' + raw[k] + ' EVs (the limit is 252 per stat).');
      if (total > 510) res.errors.push('Total is ' + total + ' EVs (the limit is 510).');
    } else {
      let big = false;
      for (const k of STATS) if (raw[k] > 32) { big = true; res.errors.push(PASTE_LABEL[k] + ' has ' + raw[k] + ' points (the limit is 32 per stat).'); }
      if (total > 66) { big = true; res.errors.push('Total is ' + total + ' points (the limit is 66).'); }
      if (big) res.errors.push('If this is a normal EV spread, switch the format to "Showdown 510 EVs (regular)".');
    }
    if (res.errors.length) return res;

    const set = newSet(parsed.pkmn);
    set.nature = parsed.nature;
    if (toChampions) {
      set.level = parsed.level;              // the paste's own level (100 when missing)
      set.evs = Object.assign(zeroes(), parsed.evs);
      set.lastEdited = 'std';
    } else {
      set.level = 100;                       // Showdown pastes without a Level line are level 100
      for (const k of STATS) set.pts[k] = Math.min(32, parsed.evsRaw[k]);
      set.lastEdited = 'champ';              // any Level line in the paste is ignored: points are level 50
    }
    resync(set, opts);

    let out = lines.slice();
    const ci = set.creep;
    if (toChampions) {
      const iv = stripIvs(out); out = iv.lines;
      if (iv.odd.length) res.notes.push('IVs line removed because Champions fixes IVs at 31 (it had ' + iv.odd.join(', ') + ').');
      out = withLevel(out, 50);
      out = withSpread(out, spreadText(set.pts, 32));
      const pts = STATS.reduce((a, k) => a + clamp(set.pts[k], 0, 32), 0);
      if (pts > 66) res.warnings.push('Needs ' + pts + ' points after conversion, which is ' + (pts - 66) + ' over the 66 limit. Lower a stat yourself.');
      if (ci && ci.bumped && !ci.unreachable) res.notes.push('Speed-creep: Speed raised by ' + plural(ci.value - ci.plain, 'point') + ' to stay above max-Speed ' + whoIs(ci.names) + '.');
      if (ci && ci.unreachable) res.warnings.push('Speed-creep: even 32 points only give Speed ' + ci.tgtStat + ', which cannot stay above max-Speed ' + whoIs(ci.names) + ' (' + ci.tgtMax + ').');
    } else {
      out = withLevel(out, null);
      out = withSpread(out, spreadText(set.evs, 252));
      const evt = STATS.reduce((a, k) => a + clamp(set.evs[k], 0, 252), 0);
      if (evt > 510) res.warnings.push('Matching these stats exactly needs ' + evt + ' EVs, which is ' + (evt - 510) + ' over the 510 limit, so Showdown will not accept it as written. Lower an EV on a stat you can spare.');
      if (ci && ci.bumped && !ci.unreachable) res.notes.push('Speed-creep: Speed EVs raised by ' + plural(ci.value - ci.plain, 'EV') + ' to stay above max-Speed ' + whoIs(ci.names) + '.');
      if (ci && ci.unreachable) res.warnings.push('Speed-creep: even 252 EVs only give Speed ' + ci.tgtStat + ', which cannot stay above max-Speed ' + whoIs(ci.names) + ' (' + ci.tgtMax + ').');
    }
    res.lines = out;
    return res;
  }

  function convertTeam(text, mode, lookup, opts) {
    const blocks = splitTeam(text);
    if (!blocks.length) return { ok: false, empty: true, results: [], output: '' };
    const results = blocks.map((lines, i) => convertBlock(lines, mode, lookup, opts, i + 1));
    const ok = results.every(r => !r.errors.length);
    return { ok, empty: false, results, output: ok ? results.map(r => r.lines.join('\n')).join('\n\n') : '' };
  }

  // ---- paste import / export ----
  function parsePaste(text, lookup, isChampions) {
    const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return null;
    let head = lines[0].replace(/^- /, '');
    let item = '';
    if (head.includes(' @ ')) {
      const parts = head.split(' @ ');
      head = parts[0];
      item = parts.slice(1).join(' @ ').trim();
    }
    head = head.replace(/\s+\((M|F)\)$/i, '').trim();
    let pkmn = lookup(head);
    if (!pkmn) {                       // "Nickname (Species)"
      const m = head.match(/^.*\s\((.+)\)$/);
      if (m) pkmn = lookup(m[1].trim());
    }
    if (!pkmn) return null;

    let nature = 'Hardy', ability = '', level = isChampions ? 50 : 100, evLabel = null;
    const evs = zeroes();
    const evsRaw = zeroes();
    const moves = ['', '', '', ''];

    const natureLine = lines.find(l => / Nature$/.test(l));
    if (natureLine) {
      const n = natureLine.replace(/ Nature$/, '').trim();
      if (NATURES.some(x => x.name === n)) nature = n;
    }
    const abilityLine = lines.find(l => /^Ability:/i.test(l));
    if (abilityLine) ability = abilityLine.replace(/^Ability:/i, '').trim();

    const evLine = lines.find(l => /^(EVs|SPs):/i.test(l));
    if (evLine) {
      evLabel = /^SPs:/i.test(evLine) ? 'SPs' : 'EVs';
      for (const part of evLine.replace(/^(EVs|SPs):/i, '').split('/')) {
        const m = part.trim().match(/^(\d+)\s+(.+)$/);
        if (!m) continue;
        let stat = m[2].toLowerCase().trim();
        if (stat === 'spatk') stat = 'spa'; else if (stat === 'spdef') stat = 'spd';
        if (STATS.includes(stat)) { evsRaw[stat] = parseInt(m[1], 10); evs[stat] = clamp(m[1], 0, 252); }
      }
    }
    const levelLine = lines.find(l => /^Level:\s*\d+/i.test(l));
    if (levelLine) level = clamp(levelLine.replace(/^Level:/i, '').trim(), 1, 100);

    let i = 0;
    for (const l of lines) if (l.startsWith('- ') && i < 4) moves[i++] = l.slice(2).trim();
    return { pkmn, nature, ability, item, evs, evsRaw, evLabel, level, moves };
  }

  /** Build a set from a Showdown (real EV) paste. */
  function importStandard(parsed, opts) {
    const set = newSet(parsed.pkmn);
    Object.assign(set, { nature: parsed.nature, ability: parsed.ability || set.ability, item: parsed.item || set.item, moves: parsed.moves, level: parsed.level });
    set.evs = Object.assign(zeroes(), parsed.evs);
    set.lastEdited = 'std';
    resync(set, opts);
    return { set, converted: false };
  }

  /** Build a set from a Champions paste. A real EV spread (any value above 32, not labelled SPs) is converted. */
  function importChampions(parsed, opts) {
    const set = newSet(parsed.pkmn);
    Object.assign(set, { nature: parsed.nature, ability: parsed.ability || set.ability, item: parsed.item || set.item, moves: parsed.moves });
    const looksLikeEVs = parsed.evLabel !== 'SPs' && STATS.some(s => parsed.evs[s] > 32);
    if (looksLikeEVs) {
      set.evs = Object.assign(zeroes(), parsed.evs);
      set.lastEdited = 'std';
    } else {
      for (const s of STATS) set.pts[s] = Math.min(32, parsed.evs[s]);
      set.lastEdited = 'champ';
    }
    resync(set, opts);
    return { set, converted: looksLikeEVs };
  }

  function formatPaste(set, kind) {
    if (!set || !set.pkmn) return '';
    const champions = kind === 'champions';
    const src = champions ? set.pts : set.evs;
    const max = champions ? 32 : 252;
    const spread = STATS.filter(s => clamp(src[s], 0, max) > 0).map(s => clamp(src[s], 0, max) + ' ' + PASTE_LABEL[s]);
    const lines = [set.item ? set.pkmn.name + ' @ ' + set.item : set.pkmn.name];
    if (set.ability) lines.push('Ability: ' + set.ability);
    lines.push('Level: ' + (champions ? 50 : clamp(set.level, 1, 100)));
    lines.push('IVs: 31 HP / 31 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe');
    if (spread.length) lines.push('EVs: ' + spread.join(' / '));
    if (set.nature !== 'Hardy') lines.push(set.nature + ' Nature');
    for (const m of set.moves) if (m) lines.push('- ' + m);
    return lines.join('\n');
  }

  return {
    STATS, STAT_LABEL, PASTE_LABEL, NATURES, PRESETS, zeroes, clamp, natureMult, fixedHp,
    stdStat, champStat, evToPoints, pointsToEv,
    buildBenchmarks, findBenchmark, evToPointsCreep, pointsToEvCreep, syncStat,
    buildPokedex, searchPokedex, abilityList,
    newSet, resync, applyPreset, totals,
    parsePaste, importStandard, importChampions, formatPaste,
    splitTeam, spreadText, convertTeam,
  };
});
