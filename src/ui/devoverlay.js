// The `?dev=1` overlay. A tool, not a screen.
//
// main.js already imports this behind a swallowed catch, so for the whole of
// phase 1 `?dev=1` silently did nothing at all. Signature is fixed by that call
// site: `mountDevOverlay({state, bus, scenes, loop, ctx})`.
//
// TWO RULES, both about staying out of the way:
//   1. It must never eat a click meant for the board. The fixed positioner is
//      pointer-events:none and only the panel itself opts back in, which is the
//      same trick #hud uses. Verify with document.elementFromPoint, never by
//      looking at it.
//   2. It owns NO stylesheet. Every rule here is inline on an element this file
//      created, so a debug panel can never collide with, or leak into, the
//      designer's `src/styles/**`. That is deliberate — do not "tidy" it into a
//      class, the class would have to live in someone else's file.
import { h, mount, clear, bindText } from './dom.js';
import { REGION_IDS, REGION_BY_ID } from '../content/regions.data.js';
import { defaultSelection } from '../meta/boosters.js';
import { recalcIncome } from '../meta/idle.js';
import { SAVE_KEY, BACKUP_KEY } from '../meta/save.js';
import { compact, rate } from './format.js';

const SPEEDS = [0, 0.25, 1, 2, 4, 8];
const GRANTS = [1e3, 1e4, 1e5, 1e6];
const REFRESH_MS = 250;
/** Open/closed is remembered, so a role that lives in this panel opens it once
 *  and a role that does not never has it in the way. */
const OPEN_KEY = 'hexdominion.dev.open';

const S = {
  host: {
    // Top-right, below the HUD's clock and Withdraw button, and DELIBERATELY
    // not full height: expanded it stops above the outcome preview in the
    // bottom-right rather than sitting on top of it. Both numbers are measured
    // against the real HUD, not guessed — a debug panel that swallows the
    // Withdraw button is the exact bug class this overlay exists to catch.
    position: 'fixed', top: '100px', right: '8px', zIndex: '9999',
    pointerEvents: 'none', width: '272px', maxHeight: 'min(66vh, calc(100vh - 268px))',
    display: 'flex', flexDirection: 'column', font: '11px/1.45 ui-monospace, monospace',
  },
  panel: {
    pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: '6px',
    background: 'rgba(10,13,20,0.94)', border: '1px solid #2c3547', borderRadius: '8px',
    padding: '8px', color: '#e7ebf3', overflow: 'auto',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  },
  head: {
    display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
    pointerEvents: 'auto', userSelect: 'none',
  },
  title: { flex: '1', fontWeight: '700', letterSpacing: '0.08em', color: '#3ddc97' },
  label: { color: '#7d8798', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '9px' },
  row: { display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' },
  btn: {
    flex: '1 1 auto', minWidth: '34px', padding: '4px 6px', borderRadius: '4px',
    border: '1px solid #37415a', background: '#171c27', color: '#e7ebf3',
    font: 'inherit', cursor: 'pointer',
  },
  input: {
    flex: '1 1 60px', minWidth: '0', padding: '4px 6px', borderRadius: '4px',
    border: '1px solid #37415a', background: '#0e1219', color: '#e7ebf3', font: 'inherit',
  },
  pre: {
    margin: '0', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    color: '#9fb0c9', maxHeight: '38vh', overflow: 'auto',
  },
};

/** Every control carries a stable `data-dev` handle so the browser smoke walk
 *  can drive the overlay by name instead of by nth-child. */
const btn = (text, onClick, extra) => h('button', {
  type: 'button', text, title: extra?.title, 'data-dev': extra?.dev,
  style: { ...S.btn, ...(extra?.style ?? {}) },
  on: { click: onClick },
});

const group = (label, ...kids) => h('div', { style: { display: 'grid', gap: '3px' } },
  h('div', { text: label, style: S.label }), h('div', { style: S.row }, ...kids));

/**
 * @param {{state:object, bus:object, scenes:object, loop:object, ctx:object}} o
 * @returns {{el:HTMLElement, dispose:()=>void, refresh:()=>void}}
 */
export function mountDevOverlay(o = {}) {
  const { state, bus, scenes, loop, ctx } = o;
  const body = h('div', { style: { display: 'grid', gap: '8px' } });
  const readout = h('pre', { style: S.pre });
  const status = h('div', { style: { ...S.label, color: '#5aa9ff', minHeight: '12px' } });
  const speedBtns = [];
  let collapsed = false;

  const say = bindText(status, '');
  const note = (m) => { say(m); window.clearTimeout(note.t); note.t = window.setTimeout(() => say(''), 2500); };
  const battle = () => state.battle;
  const dirty = () => { if (state.session) state.session.dirty = true; };

  // ---- speed --------------------------------------------------------------
  for (const s of SPEEDS) {
    const b = btn(s === 0 ? 'II' : `${s}x`, () => setSpeed(s),
      { title: s === 0 ? 'Pause the fixed-step loop' : `Run the sim at ${s}x` });
    speedBtns.push({ s, el: b });
    b.dataset.speed = String(s);
  }

  function setSpeed(s) {
    loop?.setSpeed?.(s);
    if (state.session) state.session.speed = s;
    bus?.emit('dev:speed', s);
    paintSpeed();
  }

  function paintSpeed() {
    const cur = loop?.speed ?? 1;
    for (const { s, el } of speedBtns) {
      el.style.background = s === cur ? '#1d3a2c' : '#171c27';
      el.style.borderColor = s === cur ? '#3ddc97' : '#37415a';
    }
  }

  // ---- crowns -------------------------------------------------------------
  const grantRow = GRANTS.map((n) => btn(`+${compact(n)}`, () => {
    state.meta.crowns += n;
    recalcIncome(state.meta, bus);
    dirty();
    note(`granted ${compact(n)} crowns`);
  }, { dev: `grant-${n}` }));
  grantRow.push(btn('0', () => {
    state.meta.crowns = 0; dirty(); note('treasury emptied');
  }, { dev: 'grant-zero', title: 'Empty the treasury' }));

  // ---- battle end ---------------------------------------------------------
  /** Set the terminal status and let screens/battle.js notice on its next tick,
   *  so the outcome still goes through toOutcome/assertBattleOutcome/rewards —
   *  a shortcut straight to the results scene would skip the seam this exists
   *  to exercise. */
  const endBattle = (result) => {
    const b = battle();
    if (!b || b.status !== 'running') { note('no battle running'); return; }
    b.status = result;
    note(`battle forced to ${result}`);
  };

  // ---- region jump --------------------------------------------------------
  const regionSel = h('select', { 'data-dev': 'region', style: { ...S.input, flex: '1 1 100%' } },
    ...REGION_IDS.map((id) => h('option', {
      value: id, text: `${REGION_BY_ID[id].name} — T${REGION_BY_ID[id].tier}`,
    })));

  function jump() {
    const id = regionSel.value;
    if (!REGION_BY_ID[id]) return;
    // Dev tool: unlock on the way in rather than making the tester conquer a
    // path to tier 4 by hand.
    const rec = state.meta.regions[id];
    if (rec && rec.status === 'locked') rec.status = 'available';
    dirty();
    scenes.replace(ctx.screens.battle, { regionId: id, boosters: defaultSelection(state.meta) });
    note(`invading ${id}`);
  }

  function unlockAll() {
    for (const id of REGION_IDS) {
      const rec = state.meta.regions[id];
      if (rec && rec.status === 'locked') rec.status = 'available';
    }
    dirty();
    bus?.emit('meta:region-unlocked', { regionId: null });
    note('all regions available');
  }

  // ---- seed ---------------------------------------------------------------
  const seedInput = h('input', {
    type: 'number', 'data-dev': 'seed', value: String(state.seed ?? 1), style: S.input,
    title: 'World seed. Every battle map derives from this.',
  });

  function applySeed() {
    const n = Number(seedInput.value);
    if (!Number.isFinite(n)) { note('seed must be a number'); return; }
    const seed = n >>> 0;
    state.seed = seed;
    // buildBattleConfig reads `metaState?.seed` and is handed ctx.state.meta,
    // so the meta slice is where the seed actually has to land today. Setting
    // both means the override works whichever one gets fixed. (See report.)
    state.meta.seed = seed;
    seedInput.value = String(seed);
    dirty();
    note(`seed = ${seed} (takes effect next battle)`);
  }

  // ---- coach / save -------------------------------------------------------
  function coachReset() {
    delete state.meta.tutorialSeen;
    dirty();
    note('tutorialSeen cleared — coach re-arms next battle');
  }

  function wipeSave() {
    try {
      window.localStorage.removeItem(SAVE_KEY);
      window.localStorage.removeItem(BACKUP_KEY);
      note('save wiped — reload for a fresh account');
    } catch { note('storage refused the write'); }
  }

  // ---- assembly -----------------------------------------------------------
  mount(body,
    group('Sim speed', ...speedBtns.map((b) => b.el)),
    group('Grant crowns', ...grantRow),
    group('Battle',
      btn('Win', () => endBattle('win'), { dev: 'win' }),
      btn('Lose', () => endBattle('loss'), { dev: 'lose' }),
      btn('Timeout', () => endBattle('timeout'), { dev: 'timeout' }),
      btn('Withdraw', () => {
        const b = battle();
        if (b) b.commands.push({ t: 'WITHDRAW' }); else note('no battle running');
      }, { dev: 'withdraw', title: 'Push a real WITHDRAW command through the sim' })),
    group('Region', regionSel, btn('Invade', jump, { dev: 'invade' }),
      btn('Unlock all', unlockAll, { dev: 'unlock-all' })),
    group('World seed', seedInput, btn('Apply', applySeed, { dev: 'seed-apply' })),
    group('Coach / save',
      btn('Reset coach', coachReset, { dev: 'coach-reset' }),
      btn('Wipe save', wipeSave, { dev: 'wipe-save' }),
      btn('Reload', () => window.location.reload(), { dev: 'reload' })),
    h('div', { style: { display: 'grid', gap: '3px' } },
      h('div', { text: 'State', style: S.label }), readout),
    status);

  const toggle = btn('+', null, { dev: 'collapse', style: { flex: '0 0 auto', minWidth: '20px' } });
  const head = h('div', {
    style: S.head, title: 'Toggle the dev panel — key `',
    on: { click: () => setCollapsed(!collapsed) },
  }, h('span', { text: 'DEV', style: S.title }), toggle);

  const panel = h('div', { style: S.panel }, head, body);
  const host = h('div', { id: 'dev-overlay', style: S.host }, panel);
  document.body.appendChild(host);

  /** Starts CLOSED. The world map's Invade button and the battle HUD's preview
   *  both live in this corner, and a debug panel that silently eats a real
   *  control is exactly the class of bug this overlay exists to find. */
  function setCollapsed(next) {
    collapsed = !!next;
    body.style.display = collapsed ? 'none' : 'grid';
    toggle.textContent = collapsed ? '+' : '–';
    host.dataset.open = collapsed ? '0' : '1';
    try { window.localStorage.setItem(OPEN_KEY, collapsed ? '0' : '1'); } catch { /* private mode */ }
  }

  let wasOpen = false;
  try { wasOpen = window.localStorage.getItem(OPEN_KEY) === '1'; } catch { /* private mode */ }
  setCollapsed(!wasOpen);

  // Typing a seed must not also toggle a unit filter: battle-input listens on
  // window, so stop our own key events before they get there.
  const stop = (ev) => ev.stopPropagation();
  panel.addEventListener('keydown', stop);
  const onKey = (ev) => {
    if (ev.key === '`' || ev.key === '~') { ev.preventDefault(); setCollapsed(!collapsed); }
  };
  window.addEventListener('keydown', onKey);

  const timer = window.setInterval(refresh, REFRESH_MS);
  paintSpeed();
  refresh();

  function refresh() {
    paintSpeed();
    readout.textContent = inspect(state, scenes, loop);
  }

  const api = {
    el: host,
    refresh,
    setSpeed,
    setCollapsed,
    jump,
    grant(n) { state.meta.crowns += n; dirty(); },
    endBattle,
    dispose() {
      window.clearInterval(timer);
      window.clearTimeout(note.t);
      window.removeEventListener('keydown', onKey);
      panel.removeEventListener('keydown', stop);
      clear(host);
      host.remove();
    },
  };
  // Reachable from the console and from the browser smoke walk.
  if (window.__game) window.__game.__dev = api;
  return api;
}

// ---------------------------------------------------------------------------
// The inspector. Text, because text is diffable by eye and a tree view is not.
// ---------------------------------------------------------------------------

const pad = (k) => `${k}:`.padEnd(11, ' ');
const line = (k, v) => `${pad(k)}${v}`;

/** Everything worth watching, in one string. Rebuilt at 4Hz. */
export function inspect(state, scenes, loop) {
  const out = [];
  const meta = state.meta ?? {};
  out.push(line('scene', `${document.body.dataset.scene ?? '—'}  [${scenes?.ids?.join(' > ') ?? ''}]`));
  out.push(line('speed', `${loop?.speed ?? '?'}x  ${loop?.isRunning ? 'running' : 'STOPPED'}`));
  out.push(line('crowns', `${compact(meta.crowns ?? 0)}  ${rate(meta.incomePerSec ?? 0)}`));
  out.push(line('regions', regionSummary(meta)));
  out.push(line('seed', `${state.seed}  meta:${meta.seed ?? '—'}`));
  out.push(line('upgrades', short(meta.upgrades)));
  out.push(line('boosters', short(meta.boosters)));
  out.push(line('coach', `tutorialSeen=${meta.tutorialSeen ?? false}  ${hintText()}`));
  out.push(line('fx', fxSummary()));
  out.push('');
  out.push(battleSummary(state.battle));
  return out.join('\n');
}

function regionSummary(meta) {
  let conquered = 0;
  let available = 0;
  for (const rec of Object.values(meta.regions ?? {})) {
    if (rec.status === 'conquered') conquered++;
    else if (rec.status === 'available') available++;
  }
  return `${conquered} conquered, ${available} open`;
}

function short(map) {
  const entries = Object.entries(map ?? {}).filter(([, v]) => v > 0);
  return entries.length ? entries.map(([k, v]) => `${k}:${v}`).join(' ') : '—';
}

function hintText() {
  const el = document.querySelector('.hint');
  if (!el) return 'strip:absent';
  return el.classList.contains('is-on') ? `“${el.textContent}”` : 'strip:idle';
}

function fxSummary() {
  const fx = window.__game?.__fx;
  if (!fx?.live) return '—';
  return `${fx.live()}/${fx.max} live`;
}

function battleSummary(b) {
  if (!b) return 'battle:    —';
  const own = (f) => b.sites.filter((s) => s.owner === f).length;
  const army = (f) => {
    let n = 0;
    for (const s of b.sites) if (s.owner === f) n += totalComp(s.garrison);
    for (const s of b.sites) if (s.siege?.owner === f) n += totalComp(s.siege.comp);
    for (const sq of b.squads) if (sq.owner === f) n += totalComp(sq.comp);
    return n;
  };
  return [
    line('battle', `${b.regionId}  ${b.status}  t${b.tick}`),
    line('gold', `${(b.factions.player.goldCg / 100).toFixed(1)} v `
      + `${(b.factions.enemy.goldCg / 100).toFixed(1)}`),
    line('sites', `you ${own('player')} · foe ${own('enemy')} · free ${own('neutral')}`),
    line('army', `you ${army('player')} v foe ${army('enemy')}`),
    line('squads', `${b.squads.length} in flight, ${b.sites.filter((s) => s.siege).length} sieges`),
    line('cmds', `${b.commands.length} queued, ${b.events.length} events`),
  ].join('\n');
}

function totalComp(comp) {
  let n = 0;
  for (const v of Object.values(comp ?? {})) n += v || 0;
  return n;
}
