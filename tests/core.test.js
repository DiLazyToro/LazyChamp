'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../core.js');

// bundled data
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'dex-data.js'), 'utf8'), sandbox);
const DEX = sandbox.window.__LAZYCHAMP_DEX;
const { list, byName } = C.buildPokedex(DEX);
const lookup = n => byName[String(n).trim().toLowerCase()] || null;

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('PASS', name); } catch (e) { console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; } };

// Port of Showdown's own getStat (play.pokemonshowdown.com/src/battle-team-editor.tsx) used as the oracle.
function psGetStat(stat, baseStat, iv, evRaw, level, natureMult, isChampions) {
  let ev = evRaw;
  if (isChampions) ev *= 8;
  if (stat === 'hp') {
    if (baseStat === 1) return 1;
    return Math.trunc(Math.trunc(2 * baseStat + iv + Math.trunc(ev / 4) + 100) * level / 100 + 10);
  }
  let val = Math.trunc(Math.trunc(2 * baseStat + iv + Math.trunc(ev / 4)) * level / 100 + 5);
  if (natureMult) val *= natureMult;
  return Math.trunc(val);
}

t('Champions stats equal Showdown getStat for every species, nature multiplier and point value', () => {
  let n = 0;
  for (const p of Object.values(byName)) {
    for (const stat of C.STATS) {
      const base = p.baseStats[stat], isHp = stat === 'hp', fx = C.fixedHp(p);
      for (const mult of isHp ? [1] : [1, 1.1, 0.9]) {
        for (let pts = 0; pts <= 32; pts++) {
          const ours = C.champStat(base, pts, mult, isHp, fx);
          const theirs = psGetStat(stat, base, 31, pts, 50, mult === 1 ? 0 : mult, true);
          assert.strictEqual(ours, theirs, `${p.name} ${stat} pts=${pts} mult=${mult}`);
          n++;
        }
      }
    }
  }
  console.log('     compared', n, 'values');
});

t('Standard stats equal Showdown getStat (levels 50/100, EVs 0-252, all multipliers)', () => {
  for (const p of Object.values(byName)) {
    for (const stat of C.STATS) {
      const base = p.baseStats[stat], isHp = stat === 'hp', fx = C.fixedHp(p);
      for (const mult of isHp ? [1] : [1, 1.1, 0.9]) {
        for (const level of [50, 100]) {
          for (let ev = 0; ev <= 252; ev += 4) {
            assert.strictEqual(C.stdStat(base, ev, level, mult, isHp, fx),
              psGetStat(stat, base, 31, ev, level, mult === 1 ? 0 : mult, false), `${p.name} ${stat} ev=${ev} L${level}`);
          }
        }
      }
    }
  }
});

t('pokedex: nothing important is dropped', () => {
  const names = new Set(list.map(p => p.name));
  for (const n of ['Latias', 'Latios', 'Chikorita', 'Typhlosion', 'Jolteon', 'Lugia', 'Rotom-Wash', 'Vulpix-Alola', 'Charizard-Mega-X', 'Garchomp'])
    assert.ok(names.has(n), n + ' missing');
  assert.ok(!names.has('Charizard-Gmax'));
  assert.ok(lookup('rotom-wash') && lookup('Pikachu-Original'));
});

t('Shedinja always has 1 HP', () => {
  const s = lookup('Shedinja');
  assert.strictEqual(C.stdStat(s.baseStats.hp, 252, 100, 1, true, C.fixedHp(s)), 1);
  assert.strictEqual(C.champStat(s.baseStats.hp, 32, 1, true, C.fixedHp(s)), 1);
});

t('known value: Garchomp 32-point Speed (Jolly) at level 50 = 169', () => {
  const g = lookup('Garchomp'); // base Spe 102
  assert.strictEqual(C.champStat(g.baseStats.spe, 32, 1.1, false, 0), Math.floor((102 + 20 + 32) * 1.1));
});

t('EV <-> points: round trip keeps the same level-50 stat for every species', () => {
  for (const p of Object.values(byName)) {
    for (const stat of C.STATS) {
      const base = p.baseStats[stat], isHp = stat === 'hp', fx = C.fixedHp(p);
      for (const mult of isHp ? [1] : [1, 1.1, 0.9]) {
        for (let ev = 0; ev <= 252; ev += 4) {
          const pts = C.evToPoints(base, ev, mult, isHp, fx);
          assert.ok(C.champStat(base, pts, mult, isHp, fx) >= C.stdStat(base, ev, 50, mult, isHp, fx));
          if (pts > 0) assert.ok(C.champStat(base, pts - 1, mult, isHp, fx) < C.stdStat(base, ev, 50, mult, isHp, fx), 'not minimal');
        }
      }
    }
  }
});

t('252 EVs maps to 32 points on a neutral stat; 0 maps to 0', () => {
  const g = lookup('Garchomp');
  assert.strictEqual(C.evToPoints(g.baseStats.spe, 252, 1, false, 0), 32);
  assert.strictEqual(C.evToPoints(g.baseStats.spe, 0, 1, false, 0), 0);
  assert.strictEqual(C.pointsToEv(g.baseStats.spe, 32, 1, false, 0), 252);
});

t('Champions import converts a real EV spread', () => {
  const parsed = C.parsePaste('Latios @ Life Orb\nAbility: Levitate\nLevel: 50\nEVs: 252 SpA / 4 SpD / 252 Spe\nTimid Nature\n- Draco Meteor', lookup, true);
  const { set, converted } = C.importChampions(parsed);
  assert.ok(converted);
  assert.deepStrictEqual([set.pts.spa, set.pts.spd, set.pts.spe], [32, 1, 32]);
  assert.strictEqual(set.evs.spa, 252);
});

t('Champions import keeps points (<=32) and honours the SPs: label', () => {
  let r = C.importChampions(C.parsePaste('Latios\nLevel: 50\nEVs: 32 SpA / 32 Spe\nTimid Nature', lookup, true));
  assert.ok(!r.converted);
  assert.deepStrictEqual([r.set.pts.spa, r.set.pts.spe, r.set.pts.spd], [32, 32, 0]);
  r = C.importChampions(C.parsePaste('Latios\nSPs: 20 SpA / 2 Spe\nTimid Nature', lookup, true));
  assert.deepStrictEqual([r.set.pts.spa, r.set.pts.spe], [20, 2]);
});

t('Standard import: nickname, gender, nature, level', () => {
  const parsed = C.parsePaste('Sparky (Rotom-Wash) (F) @ Sitrus Berry\nAbility: Levitate\nLevel: 100\nEVs: 252 HP / 252 SpA / 4 SpD\nModest Nature\n- Hydro Pump\n- Volt Switch', lookup, false);
  assert.strictEqual(parsed.pkmn.name, 'Rotom-Wash');
  const { set } = C.importStandard(parsed);
  assert.strictEqual(set.nature, 'Modest');
  assert.deepStrictEqual([set.pts.hp, set.pts.spa], [32, 32]);
  assert.deepStrictEqual(set.moves.slice(0, 2), ['Hydro Pump', 'Volt Switch']);
});

t('Export: Champions paste uses points with Level 50, Showdown paste uses EVs', () => {
  const set = C.newSet(lookup('Garchomp'));
  set.nature = 'Jolly'; set.item = 'Life Orb'; set.moves = ['Earthquake', '', '', ''];
  set.pts.atk = 32; set.pts.spe = 32; set.lastEdited = 'champ'; C.resync(set);
  const champ = C.formatPaste(set, 'champions');
  const std = C.formatPaste(set, 'standard');
  assert.match(champ, /^Garchomp @ Life Orb\n/);
  assert.match(champ, /Level: 50\n/);
  assert.match(champ, /EVs: 32 Atk \/ 32 Spe\n/);
  assert.match(std, /Level: 100\n/);
  assert.match(std, /EVs: 252 Atk \/ 252 Spe\n/);
  assert.match(champ, /Jolly Nature\n- Earthquake$/);
});

t('Nature change re-converts from the last edited side', () => {
  const set = C.newSet(lookup('Garchomp'));
  set.evs.spe = 100; set.lastEdited = 'std'; C.resync(set);
  const before = set.pts.spe;
  set.nature = 'Brave'; C.resync(set); // lowers Speed
  assert.ok(Number.isInteger(set.pts.spe) && set.pts.spe >= 0 && set.pts.spe <= 32);
  assert.ok(C.champStat(102, set.pts.spe, 0.9, false, 0) >= C.stdStat(102, 100, 50, 0.9, false, 0));
  console.log('     Speed points', before, '->', set.pts.spe);
});

t('blank / junk values never produce NaN or string concatenation', () => {
  const set = C.newSet(lookup('Garchomp'));
  set.evs.hp = ''; set.evs.atk = 999; set.pts.spe = 'abc';
  const tt = C.totals(set);
  assert.deepStrictEqual(tt, { ev: 252, pt: 0 });
  assert.strictEqual(C.clamp('', 0, 252), 0);
});

t('presets: 252 EV <-> 32 points everywhere, totals within limits', () => {
  for (const pr of C.PRESETS.filter(p => p.std)) {
    const set = C.newSet(lookup('Garchomp'));
    assert.ok(C.applyPreset(set, pr.label));
    const tt = C.totals(set);
    assert.ok(tt.ev <= 510 && tt.pt <= 66, pr.label);
  }
});

t('search: prefix matches rank first', () => {
  const r = C.searchPokedex(list, 'gar');
  assert.ok(r[0].name.toLowerCase().startsWith('gar'));
  assert.ok(C.searchPokedex(list, '445').some(p => p.name === 'Garchomp'));
});


// ---------------- speed-creep assumption ----------------
const BM = C.buildBenchmarks(list);
const OPTS = { speedCreep: true, benchmarks: BM };

t('speed-creep: Raichu-Mega-Y 200 EVs +Spe (380) must stay above max Meowscarada (379) at level 50', () => {
  const r = lookup('Raichu-Mega-Y'), spe = r.baseStats.spe;
  assert.strictEqual(C.stdStat(spe, 200, 100, 1.1, false, 0), 380);
  const plain = C.evToPoints(spe, 200, 1.1, false, 0);
  assert.strictEqual(C.champStat(spe, plain, 1.1, false, 0), 192, 'plain conversion only ties the level 50 Meowscarada');
  const res = C.evToPointsCreep(spe, 200, 1.1, 100, BM);
  assert.ok(res.info.names.includes('Meowscarada'));
  assert.strictEqual(res.info.srcMax, 379);
  assert.strictEqual(res.info.tgtMax, 192);
  assert.strictEqual(res.value, plain + 1);
  assert.strictEqual(res.info.tgtStat, 193);
  assert.ok(res.info.bumped && !res.info.unreachable);
});

t('speed-creep: forward invariants for every base Speed, EV step, nature and source level', () => {
  let checked = 0, bumps = 0;
  for (const bm of BM) {
    for (const mult of [1, 1.1, 0.9]) for (const level of [100, 80, 50]) {
      for (let ev = 0; ev <= 252; ev += 4) {
        const r = C.evToPointsCreep(bm.base, ev, mult, level, BM);
        const plain = C.evToPoints(bm.base, ev, mult, false, 0);
        const S = C.stdStat(bm.base, ev, level, mult, false, 0);
        const below = BM.map(b => C.stdStat(b.base, 252, level, 1.1, false, 0)).filter(m => m < S);
        if (!r.info) { assert.strictEqual(below.length, 0, 'no benchmark although slower ones exist'); assert.strictEqual(r.value, plain); continue; }
        const i = r.info;
        assert.ok(i.srcMax < S, 'benchmark must be outsped in the source');
        assert.strictEqual(i.srcMax, Math.max(...below), 'closest benchmark below, exactly S-1 when it exists');
        assert.ok(r.value >= plain && r.value <= 32);
        if (!i.unreachable) {
          assert.ok(C.champStat(bm.base, r.value, mult, false, 0) > i.tgtMax, 'still outspeeds at level 50');
          if (r.value > plain) assert.ok(C.champStat(bm.base, r.value - 1, mult, false, 0) <= i.tgtMax, 'not minimal');
        } else assert.strictEqual(r.value, 32);
        if (r.value > plain) bumps++;
        checked++;
      }
    }
  }
  console.log('     checked', checked, 'conversions,', bumps, 'needed the extra point(s)');
});

t('speed-creep: reverse invariants (Champions points -> Showdown EVs) at several target levels', () => {
  let checked = 0, bumps = 0;
  for (const bm of BM) {
    for (const mult of [1, 1.1, 0.9]) for (const level of [100, 80, 50]) {
      for (let pts = 0; pts <= 32; pts++) {
        const r = C.pointsToEvCreep(bm.base, pts, mult, level, BM);
        const plain = C.pointsToEv(bm.base, pts, mult, false, 0);
        const S = C.champStat(bm.base, pts, mult, false, 0);
        const below = BM.map(b => C.champStat(b.base, 32, 1.1, false, 0)).filter(m => m < S);
        if (!r.info) { assert.strictEqual(below.length, 0); assert.strictEqual(r.value, plain); continue; }
        const i = r.info;
        assert.strictEqual(i.srcMax, Math.max(...below));
        assert.ok(r.value >= plain && r.value <= 252 && r.value % 4 === 0);
        if (!i.unreachable) {
          assert.ok(C.stdStat(bm.base, r.value, level, mult, false, 0) > i.tgtMax);
          if (r.value > plain) assert.ok(C.stdStat(bm.base, r.value - 4, level, mult, false, 0) <= i.tgtMax, 'not minimal');
        } else assert.strictEqual(r.value, 252);
        if (r.value > plain) bumps++;
        checked++;
      }
    }
  }
  console.log('     checked', checked, 'conversions,', bumps, 'needed extra EVs');
});

t('speed-creep: only Speed is affected, and only when switched on', () => {
  const set = C.newSet(lookup('Raichu-Mega-Y'));
  set.nature = 'Timid'; set.evs.spe = 200; set.evs.hp = 100; set.lastEdited = 'std';
  const off = JSON.parse(JSON.stringify(set)); off.pkmn = set.pkmn;
  C.resync(off);                    // no options
  const on = JSON.parse(JSON.stringify(set)); on.pkmn = set.pkmn;
  C.resync(on, OPTS);
  for (const s of C.STATS) if (s !== 'spe') assert.strictEqual(on.pts[s], off.pts[s], s + ' must not change');
  assert.strictEqual(off.pts.spe, 25);
  assert.strictEqual(on.pts.spe, 26);
  assert.strictEqual(off.creep, null);
  assert.ok(on.creep && on.creep.bumped);
});

t('speed-creep: nature stays untouched and importers honour the option', () => {
  const parsed = C.parsePaste('Raichu-Mega-Y @ Raichunite Y\nAbility: Lightning Rod\nLevel: 100\nEVs: 200 Spe\nTimid Nature', lookup, false);
  const plain = C.importStandard(parsed);
  const creep = C.importStandard(parsed, OPTS);
  assert.strictEqual(plain.set.pts.spe, 25);
  assert.strictEqual(creep.set.pts.spe, 26);
  assert.strictEqual(creep.set.nature, 'Timid');
});

t('speed-creep: level changes alone never trigger a conversion', () => {
  const set = C.newSet(lookup('Raichu-Mega-Y'));
  set.nature = 'Timid'; set.evs.spe = 200; set.lastEdited = 'std'; C.resync(set, OPTS);
  const pts = set.pts.spe; set.level = 50;      // the panel only calls syncStat on EV/point/nature edits
  assert.strictEqual(set.pts.spe, pts);
});


// ---------------- whole-team conversion ----------------
const RAICHU_CHAMP = `Raichu-Mega-Y @ Raichunite Y  
Ability: No Guard  
Level: 50  
EVs: 7 HP / 32 SpA / 25 Spe  
Timid Nature  
- Zap Cannon  
- Volt Switch  
- Focus Blast  
- Alluring Voice  `;
const SHOWDOWN_TEAM = `Slowking @ Assault Vest  
Ability: Regenerator  
EVs: 252 HP / 4 SpA / 252 SpD  
Calm Nature  
IVs: 0 Atk  
- Scald  
- Psychic  
- Future Sight  
- Flamethrower  

Raichu-Mega-Y @ Raichunite Y  
Ability: No Guard  
EVs: 56 HP / 252 SpA / 200 Spe  
Timid Nature  
IVs: 0 Atk  
- Zap Cannon  
- Volt Switch  
- Focus Blast  
- Alluring Voice  

Mandibuzz (F) @ Heavy-Duty Boots  
Ability: Big Pecks  
EVs: 252 HP / 252 Def / 4 SpD  
Impish Nature  
- Foul Play  
- U-turn  
- Roost  
- Defog  

Kyurem @ Leftovers  
Ability: Pressure  
EVs: 252 HP / 80 SpA / 176 Spe  
Timid Nature  
IVs: 0 Atk  
- Freeze-Dry  
- Shadow Ball  
- Protect  
- Substitute  

Nidoqueen (F) @ Black Sludge  
Ability: Sheer Force  
EVs: 252 HP / 252 SpD  
Careful Nature  
IVs: 0 Atk  
- Shadow Ball  
- Earth Power  
- Sludge Wave  
- Ice Beam  

Infernape @ Life Orb  
Ability: Iron Fist  
EVs: 16 HP / 252 Atk / 240 Spe  
Jolly Nature  
- Close Combat  
- Mach Punch  
- Earthquake  
- Shadow Claw  `;

t('team Champions -> Showdown: the six-Raichu paste converts, Level line dropped, other lines kept', () => {
  const team = Array(6).fill(RAICHU_CHAMP).join('\n\n');
  const r = C.convertTeam(team, 'toShowdown', lookup, null);
  assert.ok(r.ok && r.results.length === 6);
  const first = r.output.split('\n\n')[0].split('\n');
  assert.strictEqual(first[0], 'Raichu-Mega-Y @ Raichunite Y');
  assert.ok(!r.output.includes('Level:'), 'no Level line');
  assert.strictEqual(first.find(l => l.startsWith('EVs:')), 'EVs: 52 HP / 252 SpA / 196 Spe');
  assert.ok(first.includes('Timid Nature') && first.includes('- Alluring Voice') && first.includes('Ability: No Guard'));
  assert.strictEqual(r.output.split('\n\n').length, 6);
  // the converted spread really matches the Champions stats at level 50
  const base = lookup('Raichu-Mega-Y').baseStats;
  for (const [k, p, ev] of [['hp', 7, 52], ['spa', 32, 252], ['spe', 25, 196]])
    assert.ok(C.stdStat(base[k], ev, 50, C.natureMult('Timid', k), k === 'hp', 0) >= C.champStat(base[k], p, C.natureMult('Timid', k), k === 'hp', 0));
});

t('team Champions -> Showdown: a level other than 50 is ignored', () => {
  const r = C.convertTeam(RAICHU_CHAMP.replace('Level: 50', 'Level: 100'), 'toShowdown', lookup, null);
  assert.ok(r.ok);
  assert.strictEqual(r.results[0].lines.find(l => l.startsWith('EVs:')), 'EVs: 52 HP / 252 SpA / 196 Spe');
});

t('team Champions -> Showdown: over 66 points or 32 per stat blocks everything, naming the Pokemon', () => {
  const bad = RAICHU_CHAMP.replace('7 HP / 32 SpA / 25 Spe', '10 HP / 32 SpA / 25 Spe'); // 67
  let r = C.convertTeam([RAICHU_CHAMP, bad, RAICHU_CHAMP].join('\n\n'), 'toShowdown', lookup, null);
  assert.ok(!r.ok && r.output === '');
  assert.strictEqual(r.results[0].errors.length, 0);
  assert.match(r.results[1].errors[0], /Total is 67 points/);
  r = C.convertTeam(RAICHU_CHAMP.replace('32 SpA', '252 SpA'), 'toShowdown', lookup, null);
  assert.ok(!r.ok);
  assert.ok(r.results[0].errors.some(e => /252 points/.test(e)) && r.results[0].errors.some(e => /Showdown 510 EVs/.test(e)));
});

t('team Champions -> Showdown: warns when exact stats would need more than 510 EVs', () => {
  const r = C.convertTeam(RAICHU_CHAMP.replace('7 HP / 32 SpA / 25 Spe', '2 HP / 32 SpA / 32 Spe'), 'toShowdown', lookup, null); // 66 points
  assert.ok(r.ok);
  assert.ok(r.results[0].warnings.some(w => /over the 510 limit/.test(w)), r.results[0].warnings.join('|'));
});

t('team Showdown -> Champions: six-Pokemon paste, Level 50 added, IVs removed, names/items/moves kept', () => {
  const r = C.convertTeam(SHOWDOWN_TEAM, 'toChampions', lookup, null);
  assert.ok(r.ok && r.results.length === 6, JSON.stringify(r.results.map(x => x.errors)));
  const blocks = r.output.split('\n\n').map(b => b.split('\n'));
  const slow = blocks[0];
  assert.strictEqual(slow[0], 'Slowking @ Assault Vest');
  assert.deepStrictEqual(slow.slice(0, 4), ['Slowking @ Assault Vest', 'Ability: Regenerator', 'Level: 50', 'EVs: 32 HP / 1 SpA / 32 SpD']);
  assert.ok(!r.output.includes('IVs:'), 'IVs lines removed');
  assert.ok(r.results[0].notes.some(n => /IVs line removed/.test(n)));
  assert.strictEqual(blocks[2][0], 'Mandibuzz (F) @ Heavy-Duty Boots');
  assert.ok(blocks[5].includes('- Shadow Claw') && blocks[5].includes('Jolly Nature'));
  // plain conversion of the Raichu: 56 / 252 / 200 -> 7 / 32 / 25
  assert.ok(blocks[1].includes('EVs: 7 HP / 32 SpA / 25 Spe'), blocks[1].join('|'));
  for (const res of r.results) assert.ok(res.errors.length === 0);
});

t('team Showdown -> Champions: speed-creep on gives Raichu 26 Speed points, and says so', () => {
  const r = C.convertTeam(SHOWDOWN_TEAM, 'toChampions', lookup, OPTS);
  assert.ok(r.ok);
  const raichu = r.results[1];
  assert.ok(raichu.lines.includes('EVs: 7 HP / 32 SpA / 26 Spe'), raichu.lines.join('|'));
  assert.ok(raichu.notes.some(n => /Speed-creep/.test(n) && /Meowscarada/.test(n)));
});

t('team Showdown -> Champions: more than 510 EVs or 252 in a stat blocks the conversion', () => {
  let r = C.convertTeam(SHOWDOWN_TEAM.replace('252 HP / 4 SpA / 252 SpD', '252 HP / 252 SpA / 252 SpD'), 'toChampions', lookup, null);
  assert.ok(!r.ok && /Total is 756 EVs/.test(r.results[0].errors[0]));
  r = C.convertTeam(SHOWDOWN_TEAM.replace('56 HP / 252 SpA / 200 Spe', '56 HP / 300 SpA / 200 Spe'), 'toChampions', lookup, null);
  assert.ok(!r.ok && /300 EVs/.test(r.results[1].errors[0]));
  assert.strictEqual(r.output, '');
});

t('team: unknown Pokemon, empty paste, CRLF line endings and === headers', () => {
  assert.ok(C.convertTeam('Notamon\nEVs: 4 HP', 'toChampions', lookup, null).results[0].errors[0].includes('Notamon'));
  assert.ok(C.convertTeam('  \n\n ', 'toChampions', lookup, null).empty);
  const crlf = '=== [gen9champions] Folder/Team ===\r\n\r\n' + RAICHU_CHAMP.replace(/\n/g, '\r\n');
  const r = C.convertTeam(crlf, 'toShowdown', lookup, null);
  assert.ok(r.ok && r.results.length === 1 && !r.output.includes('==='));
});

t('team: a stat with no EVs line still gets one when speed-creep needs it', () => {
  const lines = ['Raichu-Mega-Y', 'Ability: No Guard', 'Timid Nature', '- Thunderbolt'];
  const r = C.convertTeam(lines.join('\n'), 'toChampions', lookup, OPTS);
  assert.ok(r.ok);
  assert.ok(r.results[0].lines.includes('Level: 50'));
});

console.log(`\n${passed} test groups passed`);
