// Phase 13, the Crown of Ages (docs/PLAN-PHASE13.md; docs/briefs/phase13-hookup.md), integration side: the browser glue between the pure modules
// (meta/crown.js, meta/ascension.js) and the UI. It owns no rules and does no maths. It builds the ceremony's final choice and Ascension picker, the
// Realm panel's ladder and crown pips, the title's Crown, and plays the ending (ui/ending.js, loaded lazily) once the Throne of Ages has fallen.
//
//   const crown = createCrown({ getState, getWorld, ui, services, camera, storage, reduceMotion, sfx });
//   crown.ceremony(house)      -> { crown, ascension } for ui/ceremony.js (null each when not offered)
//   crown.realm()              -> { ascension, crownPips } for ui/realm.js
//   crown.title()              -> { line, pips } | null for ui/title.js
//   crown.tick(nowMs, canPlay) the world scene, every frame: plays the ending once a toppled Throne is waiting and the map is calm
//   crown.playEnding()         plays it now (dev / checks); resolves { skipped }
import { crownOfAgesAvailable, ascensionInfo, endingRecord, crownLine } from '../meta/crown.js';
import { ascensionHighest, isCrowned } from '../meta/ascension.js';
import { chronicleText } from '../meta/chronicle.js';
import { CROWN, ENDING } from '../config/crown.js';
import { ASCENSION } from '../config/ascension.js';
import { PLAYER_FACTION } from '../meta/state.js';
import { shortNumber } from '../ui/format.js';
import { toRoman } from '../ui/ceremony.js';

const SEEN_KEY = 'hexdominion.v2.endingSeen'; // how many toppled Thrones have had their ending played on this device (a reload never loses one)
const pct = (x) => `${Math.round(x * 100)}%`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`; // "1 rival capital", "2 rival capitals"
const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/** "+50% Legacy at the next founding" for a level (config copy and numbers only). */
export function ascensionLegacyText(level) {
  return ASCENSION.copy.legacy.replace('{pct}', String(Math.round(ASCENSION.legacyPerLevel * level * 100)));
}

/**
 * @param {{ getState: () => object, getWorld: () => object, ui: object, services: object, camera: object, storage?: object,
 *   reduceMotion: () => boolean, sfx?: object }} deps
 */
export function createCrown({ getState, getWorld, ui, services, camera, storage, reduceMotion, sfx }) {
  let view = null; // the lazily loaded ending view
  let loading = null;
  let playing = false;
  let calmSince = 0;

  const read = () => { try { return Number(storage?.getItem(SEEN_KEY)) || 0; } catch { return 0; } };
  const write = (n) => { try { storage?.setItem(SEEN_KEY, String(n)); } catch { /* storage locked: the ending may replay once */ } };

  // --- the ceremony ---------------------------------------------------------------------------------------------------------------------
  function ceremony(house) {
    const state = getState();
    const offer = crownOfAgesAvailable(state);
    const info = ascensionInfo(state);
    return {
      crown: offer ? {
        line: CROWN.copy.choiceText,
        lead: CROWN.copy.ceremony.replace('{house}', house),
        recap: `${CROWN.copy.choice}: the Usurper waits on the Throne of Ages`,
        lines: [
          'The largest continent: two classic rivals, the Ashen Host and the Sea Kings on a broken coast',
          'The Usurper holds its heart; his capital is the last battle',
          'Topple the Throne to see the ending and unlock Ascension',
        ],
        warning: 'The final continent is the hardest of all. It is optional: choose "A new continent" to keep founding as before.',
      } : null,
      ascension: info.unlocked ? {
        max: info.maxChoice,
        note: info.highest ? `${ASCENSION.copy.highest.replace('{n}', String(info.highest))}. Pick up to ${info.maxChoice}.` : `Pick up to Ascension ${info.maxChoice}. Each level cleared raises the next.`,
        levels: info.ladder.filter((l) => l.level <= info.maxChoice).map((l) => ({ level: l.level, name: l.name, text: `${l.name}: ${l.text}`, legacy: ascensionLegacyText(l.level) })),
      } : null,
    };
  }

  // --- the Realm panel ----------------------------------------------------------------------------------------------------------------------
  function realm() {
    const state = getState();
    const info = ascensionInfo(state);
    return {
      ascension: info.unlocked ? {
        highest: info.highest, current: info.level, open: info.maxChoice,
        levels: info.ladder.map((l) => ({ level: l.level, text: `${l.name}: ${l.text}`, legacy: ascensionLegacyText(l.level) })),
        note: `Clear a level by completing a dynasty played at it. Each level cleared pays +${pct(ASCENSION.legacyPerLevel)} Legacy per level at the next founding.`,
      } : null,
      crownPips: ascensionHighest(state),
    };
  }

  /** The title's lasting Crown. */
  function title() {
    const state = services.mainState ? services.mainState() : getState();
    const line = crownLine(state);
    return line ? { line, pips: ascensionHighest(state) } : null;
  }

  // --- the ending ------------------------------------------------------------------------------------------------------------------------------
  function load() {
    if (!loading) loading = import('../ui/ending.js').then((m) => {
      view = m.createEnding({ camera, reduceMotion, sfx });
      document.body.appendChild(view.el);
      return view;
    }).catch((err) => { loading = null; throw err; });
    return loading;
  }

  /** The tour: the home region, the rival capitals taken, the Throne last; then the whole continent. */
  function tourStops(state, world, short) {
    const keepPos = (r) => { const s = world.settlements[r.keep]; const t = s ? world.tiles[s.tile] : null; return t ? { x: t.x, y: t.y } : null; };
    const close = camera.fitZoom ? camera.fitZoom(world.bounds, 40) * 2.4 : undefined;
    const stops = [];
    const home = world.regions[world.startRegion];
    if (home && keepPos(home)) stops.push({ ...keepPos(home), zoom: close, caption: `${home.name}, where the House began` });
    const throne = world.crown ? world.regions[world.crown.throne] : null;
    const capitals = world.regions.filter((r) => r.isCapital && r !== throne && r !== home && state.owner[r.id] === PLAYER_FACTION);
    const room = short ? 0 : Math.max(0, ENDING.cinematicStops - 2 - (throne ? 1 : 0));
    if (short) stops.length = 0; // a Throne toppled again (Ascension): a short tour, the Throne and the continent
    for (const r of capitals.slice(0, room)) {
      const f = world.factions.find((x) => x && x.capitalRegion === r.id);
      const p = keepPos(r);
      if (p) stops.push({ ...p, zoom: close, caption: f && f.name ? `${r.name}, once the capital of the ${f.name.replace(/^The /, '')}` : `${r.name}, a fallen capital` });
    }
    if (throne && keepPos(throne)) stops.push({ ...keepPos(throne), zoom: close, caption: 'The Throne of Ages: the Usurper is fallen' });
    const b = world.bounds;
    stops.push({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, zoom: camera.fitZoom ? camera.fitZoom(b, 40) : undefined, caption: 'The continent is yours' });
    return stops;
  }

  /** The scroll's first sentence, from the record's numbers (counted words agree with their number; endingRecord().lines do not). */
  function leadSentence(r) {
    const parts = [`Founded ${plural(r.dynasties, 'dynasty', 'dynasties')}`];
    if (r.generals.length) parts.push(`Led by ${r.generals.slice(0, 3).map((g) => g.name).join(', ')}`);
    if (r.capitalsToppled) parts.push(`Toppled ${plural(r.capitalsToppled, 'rival capital', 'rival capitals')}`);
    else if (r.regionsConquered) parts.push(`Conquered ${plural(r.regionsConquered, 'region', 'regions')}`);
    return parts.length ? `${parts.join('. ')}.` : 'The Usurper is fallen, and the Crown of Ages is yours.';
  }

  /** The Chronicle scroll's sections, from endingRecord() (words only; every number is the record's). */
  function endingData(state, world) {
    const r = endingRecord(state, { challengeRecord: services.challenge?.record || null });
    const c = r.crowned;
    const house = services.dynasty ? services.dynasty.houseName() : '';
    const sections = [];
    const crownRows = [];
    if (c) crownRows.push(['Crowned', `Year ${c.year}, Dynasty ${toRoman(c.dynasty)}`]);
    if (c && c.times > 1) crownRows.push(['Thrones toppled', shortNumber(c.times)]);
    crownRows.push(['Dynasties founded', String(r.dynasties)], ['Stars', shortNumber(r.stars)]);
    if (r.ascension.highest) crownRows.push(['Highest Ascension', String(r.ascension.highest)]);
    sections.push({ id: 'crown', icon: 'crown', heading: 'The Crown', rows: crownRows });
    if (r.edicts.length) sections.push({ id: 'edicts', icon: 'scroll', heading: 'Edicts proclaimed', lines: r.edicts.map((e) => `Dynasty ${toRoman(e.dynasty)}: ${e.name}`) });
    if (r.generals.length) sections.push({ id: 'generals', icon: 'banner', heading: 'Your Generals', lines: r.generals.map((g) => `${g.name}${g.title ? `, ${g.title}` : ''} · level ${g.level}`) });
    const deeds = [];
    deeds.push(['Regions conquered', shortNumber(r.regionsConquered)], ['Battles won', shortNumber(r.battlesWon)], ['Crowns earned', shortNumber(r.crownsEarned)]);
    if (r.capitalsToppled) deeds.push(['Rival capitals toppled', String(r.capitalsToppled)]);
    deeds.push(['Relics found', `${r.relics.found} / ${r.relics.total}`]);
    if (r.vendettasWon) deeds.push(['Vendettas won', String(r.vendettasWon)]);
    if (r.dragonsSlain) deeds.push(['Dragons slain', String(r.dragonsSlain)]);
    if (r.bestDaily) deeds.push(['Best Daily', `${clock(r.bestDaily.sec)} · ${r.bestDaily.crowns} crowns`]);
    sections.push({ id: 'deeds', icon: 'trophy', heading: 'Deeds of the reign', rows: deeds });
    const highs = (r.highlights || []).map((e) => { try { return chronicleText(e, { world }); } catch { return ''; } }).filter(Boolean);
    if (highs.length) sections.push({ id: 'highlights', icon: 'laurel', heading: 'Remembered', lines: highs });
    return {
      kicker: [c ? crownLine(state) : '', house ? `the House of ${house}` : ''].filter(Boolean).join(' · '),
      lead: leadSentence(r),
      sections,
      stops: tourStops(state, world, !!(c && c.times > 1)),
      credits: { title: r.credits?.title || ENDING.credits.title, line: r.credits?.line || ENDING.credits.line, more: ['Thank you for playing.'] },
    };
  }

  async function playEnding() {
    if (playing) return { skipped: true };
    const state = getState();
    const world = getWorld();
    playing = true;
    try {
      const v = await load();
      services.onEndingStart?.();
      const res = await v.play(endingData(state, world));
      if (isCrowned(state)) write(state.generals.crowned.times || 1);
      services.onEndingEnd?.(res);
      return res;
    } catch (err) {
      console.warn('[ending] could not play:', err);
      if (isCrowned(state)) write(state.generals.crowned.times || 1);
      return { skipped: true, error: true };
    } finally {
      playing = false;
    }
  }

  /** A toppled Throne whose ending has not played on this device yet. */
  function pending() {
    const state = getState();
    return !!(state && !state.challenge && isCrowned(state) && (state.generals.crowned.times || 1) > read());
  }

  /** Every world frame: once a Throne's ending is waiting and the map has been calm (no dialog, no choreography) for a moment, play it. */
  function tick(nowMs, canPlay) {
    if (playing || !pending()) { calmSince = 0; return; }
    if (!canPlay) { calmSince = 0; return; }
    if (!calmSince) calmSince = nowMs;
    if (nowMs - calmSince >= 1600) { calmSince = 0; playEnding(); }
  }

  return {
    ceremony, realm, title, tick, playEnding, pending, endingData, load,
    get playing() { return playing; },
    get view() { return view; },
    /** Dev: forget that the ending was seen (so it plays again). */
    devForget: () => write(0),
  };
}
