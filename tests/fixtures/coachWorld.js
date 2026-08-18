// The battle-shaped stub every coach test drives, shared by coach.test.js and
// coachcastle.test.js. Split out when the castle-beat pair took coach.test.js
// past the 400-line cap — the same seam the source uses, since the pair is the
// one beat that depends on a RULE of the region rather than on player events.
import { COACH_REGION } from '../../src/ui/coach.js';

// --- a battle-shaped stub, only the fields the machine reads ---------------

export function battle(over = {}) {
  return {
    regionId: COACH_REGION,
    status: 'running',
    factions: { player: { goldCg: 0 }, enemy: { goldCg: 0 } },
    squads: [],
    // `hex` and `seen` are here because the castle beat is FOG-GATED now
    // (ui/coach.js castleTouchesPlayer): a hint is speech about the board, so it
    // is bound by the same rule the board is. The default stub is a player who
    // has already looked at the throne, because every test in this file is about
    // the beat TABLE rather than about fog; the gate itself is pinned against a
    // REAL battle in tests/fogleaks.test.js, beside the other surfaces that used
    // to narrate what the board hides.
    sites: [
      { id: 'camp', kind: 'camp', owner: 'player', hex: [0, 0], adj: ['nf01'] },
      { id: 'nf01', kind: 'farm', owner: 'neutral', hex: [1, 0], adj: ['camp', 'castle'] },
      { id: 'castle', kind: 'castle', owner: 'enemy', hex: [2, 0], adj: ['nf01'] },
    ],
    vision: { player: {}, enemy: {} },
    seen: { player: { castle: 'enemy' }, enemy: {} },
    // A GATED region by default, and it has to be explicit. The castle beat
    // splits on `castleGateFrac`: the line that describes the gate must not
    // fire where there is no gate, and Riverfen — the campaign opener, the one
    // battle a first-timer is guaranteed to play — ships 0. An absent `rules`
    // reads as 0, so a fixture that omits this is testing the OTHER branch
    // while looking like it tests this one.
    rules: { castleGateFrac: 0.5 },
    ...over,
  };
}

export const gold = (n) => ({ factions: { player: { goldCg: Math.round(n * 100) } } });

/** Drive the machine and collect the beats it emitted, in order. `pump` runs
 *  before every step so the caller can advance the world; a step that returns
 *  nothing is normal and never ends the run. */
export function drain(machine, world, pump, limit = 40) {
  const out = [];
  for (let i = 0; i < limit; i++) {
    pump?.(i);
    const beat = machine.step(world.battle, world.meta);
    if (beat) out.push(beat.id);
  }
  return out;
}
