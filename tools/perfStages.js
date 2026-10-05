// In-page stage setups for tools/perf.mjs. Each export is a function the tool sends to the page with page.eval (so it must be
// self-contained: no closures over this module). Dev hooks only (window.__hd, ?dev=1).

/** Installs window.__pf: path conquest, a battle start, a squad driver that keeps about `n` squads on the field, the frame sampler. */
export function installHelpers() {
  const hd = window.__hd;
  const P = 0;
  window.__pf = {
    reach(target) {
      const w = hd.world;
      const owned = (id) => hd.state.owner[id] === P;
      if (w.regions[target].neighbors.some(owned)) return true;
      const prev = new Map();
      const queue = w.regions.filter((r) => owned(r.id)).map((r) => r.id);
      for (const id of queue) prev.set(id, -1);
      while (queue.length) {
        const cur = queue.shift();
        for (const n of w.regions[cur].neighbors) {
          if (prev.has(n) || n === target) continue;
          prev.set(n, cur);
          if (w.regions[target].neighbors.includes(n)) {
            const chain = [];
            for (let x = n; x !== -1 && !owned(x); x = prev.get(x)) chain.unshift(x);
            for (const id of chain) hd.conquerRegion(id);
            return true;
          }
          queue.push(n);
        }
      }
      return false;
    },
    calm() {
      hd.hideDev(true);
      const st = hd.state;
      st.settings.hints = false;
      if (st.settings) st.settings.leaderVoices = false;
    },
    /** Keeps about `n` squads marching: every 250 ms the strongest site of a side that is short sends a quarter at a routable foe. */
    async drive(n = 14, opts = {}) {
      const S = await import(new URL('game/battle/sim.js', document.baseURI).href);
      clearInterval(window.__pfDrive);
      let k = 0;
      window.__pfDrive = setInterval(() => {
        const b = hd.battle;
        if (!b || hd.battlePhase !== 'live') return;
        if (opts.refill) for (const s of b.sites) if (s.troops < 60) s.troops = 60 + (s.id % 7) * 5;
        if (b.squads.length >= n) return;
        k += 1;
        const mine = k % 3 !== 0 || opts.playerOnly;
        const from = b.sites.filter((s) => (mine ? s.owner === P : s.owner !== P) && s.troops > 12).sort((a, c) => c.troops - a.troops);
        for (const f of from.slice(0, 3)) {
          const pool = opts.targets ? b.sites.filter((s) => opts.targets(s, b)) : b.sites.filter((s) => s.owner !== f.owner);
          const tgts = pool.filter((s) => s.id !== f.id && S.canRoute(b, f.owner, f.id, s.id));
          if (!tgts.length) continue;
          const to = tgts[(k * 7 + f.id) % tgts.length];
          S.issue(b, { type: 'send', owner: f.owner, from: [f.id], to: to.id, fraction: 0.25 });
          break;
        }
      }, 250);
      return true;
    },
    stopDrive() { clearInterval(window.__pfDrive); },
    /** rAF intervals, the frame's CPU work and the meta tick, over `ms`, with an optional slow pan. */
    sample(ms, pan = false) {
      return new Promise((resolve) => {
        const dts = []; const cpu = []; const meta = []; const squads = [];
        let last = 0; let dir = 1; let t0 = 0;
        const fn = () => {
          const now = performance.now();
          if (!t0) t0 = now;
          if (last) { dts.push(now - last); cpu.push(hd.perf.cpuMs); meta.push(hd.perf.metaMs); squads.push(hd.battle ? hd.battle.squads.length : 0); }
          last = now;
          if (pan) { if (((now - t0) / 1500 | 0) % 2) dir = -1; else dir = 1; hd.camera.panBy(dir * 1.2, dir * 0.5); }
        };
        hd.afterFrame.push(fn);
        setTimeout(() => { hd.afterFrame.splice(hd.afterFrame.indexOf(fn), 1); resolve({ dts, cpu, meta, squads }); }, ms);
      });
    },
  };
  return true;
}

/** Starts a battle on region `id` (reaching it first) and resolves once it is live. */
export async function battleAt(id) {
  const hd = window.__hd;
  window.__pf.reach(id);
  hd.selectRegion(null);
  hd.startBattle(id);
  const t0 = performance.now();
  while (performance.now() - t0 < 30000) {
    if (hd.scene === 'battle' && hd.battlePhase === 'live') return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** Turns on every meta system in the current realm: Boons, Relics, a raid on the way, a world event, a Vendetta, prosperity, gold. */
export async function everySystem() {
  const hd = window.__hd;
  const out = {};
  const safe = (k, fn) => { try { out[k] = fn(); } catch (e) { out[k] = `error: ${e && e.message}`; } };
  safe('gold', () => hd.grantGold(5e6));
  safe('tenure', () => hd.advanceTenure(9));
  const { BOON_LIST } = await import(new URL('game/config/boons.js', document.baseURI).href);
  safe('boons', () => hd.grantBoons(BOON_LIST.filter((x) => x.rarity !== 'cursed').slice(0, 12).map((x) => x.id)).length);
  safe('legacy', () => hd.grantLegacy(6));
  safe('vendetta', () => hd.vendetta(undefined, { sec: 9999 }));
  safe('event', () => hd.offerEvent('merchant'));
  safe('bounty', () => hd.bounty('conquer'));
  safe('raid', () => {
    const mine = hd.world.regions.filter((r) => hd.state.owner[r.id] === 0 && r.neighbors.some((n) => hd.state.owner[n] > 1)).map((r) => r.id);
    return mine.length ? hd.raid(mine[0], { sec: 9999 }) : 'no border';
  });
  return out;
}
