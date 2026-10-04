// Words for Phase 4's goals (docs/PLAN-PHASE4.md): what each Deed asks for its next tier. The goals and rewards themselves are config
// (game/config/deeds.js); only the sentence around the number lives here. Pure.

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
const plural = (n, one, many) => (n === 1 ? one : many);

/** "Conquer 50 regions", from a deed id and the next tier's goal. */
export function deedGoalText(id, goal) {
  const n = Math.max(0, Math.floor(goal || 0));
  switch (id) {
    case 'conqueror': return `Conquer ${n} ${plural(n, 'region', 'regions')}`;
    case 'warden': return `Win ${n} ${plural(n, 'defense', 'defenses')}`;
    case 'crowned': return `Earn ${n} ${plural(n, 'crown', 'crowns')}`;
    case 'dragonslayer': return n <= 1 ? 'Slay a Dragon' : `Slay ${n} Dragons`;
    case 'kingbreaker': return n <= 1 ? 'Topple a rival capital' : `Topple ${n} rival capitals`;
    case 'contractor': return `Complete ${n} ${plural(n, 'contract', 'contracts')}`;
    case 'unstoppable': return `Reach a streak of ${n}`;
    case 'patron': return `Raise a region to Prosperity ${ROMAN[n] || n}`;
    case 'mentor': return `A General reaches level ${n}`;
    case 'builder': return `Build ${n} fortification ${plural(n, 'level', 'levels')}`;
    case 'duellist': return n <= 1 ? 'Win a Duel' : `Win ${n} Duels`;
    case 'nemesis': return n <= 1 ? 'Beat a Vendetta' : `Beat ${n} Vendettas`;
    default: return `Reach ${n}`;
  }
}
