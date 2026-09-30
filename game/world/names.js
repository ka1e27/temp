// Syllable-combination fantasy names (English/Norse/Celtic flavour),
// deterministic from the world seed, unique within a world (DESIGN §3.2).

const ROOTS = [
  'Ash', 'Kald', 'Thorn', 'Bryn', 'Dusk', 'Mill', 'Oak', 'Elm', 'Fen', 'Stone',
  'Iron', 'Raven', 'Wolf', 'Storm', 'Frost', 'Gold', 'Silver', 'Red', 'Green',
  'Black', 'White', 'North', 'South', 'East', 'West', 'Winter', 'Grey',
  'Vale', 'Glen', 'Fjord', 'Bran', 'Cor', 'Dun', 'Kil', 'Loch', 'Tor', 'Bel',
  'Car', 'Pen', 'Wyn', 'Thistle', 'Bramble', 'Reed', 'Hazel', 'Rowan',
  'Birch', 'Wren', 'Falcon', 'Hawk', 'Fox', 'Stag', 'Barrow', 'Cairn',
  'Elder', 'Amber', 'Copper', 'Shadow', 'Bright', 'Long', 'High', 'Low',
];

const SUFFIXES = [
  'ford', 'mere', 'wick', 'vale', 'hollow', 'burg', 'ton', 'stead', 'haven',
  'moor', 'shire', 'hold', 'gard', 'heim', 'dale', 'brook', 'wood', 'field',
  'ridge', 'cliff', 'bay', 'port', 'watch', 'reach', 'fell', 'crag', 'spire',
  'ham', 'borough', 'glen', 'marsh', 'water', 'bourne', 'worth', 'thorpe',
  'gate', 'wall', 'fall', 'stone', 'edge', 'bridge',
];

/**
 * A deterministic name generator, unique across every call made against the
 * SAME instance (region and settlement names should share one instance so
 * nothing collides across the whole world — see generate.js).
 * @param {import('../core/rng.js').Rng} rng forked for the 'names' phase
 */
export function createNameGenerator(rng) {
  const used = new Set();

  return function generateName() {
    for (let attempt = 0; attempt < 500; attempt++) {
      const name = rng.pick(ROOTS) + rng.pick(SUFFIXES);
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
    }
    // With ~2400 root/suffix combinations and well under 200 names ever
    // needed, this is only a safety net, not a real code path.
    let n = 2;
    let name = `${rng.pick(ROOTS)}${rng.pick(SUFFIXES)} ${n}`;
    while (used.has(name)) {
      n++;
      name = `${rng.pick(ROOTS)}${rng.pick(SUFFIXES)} ${n}`;
    }
    used.add(name);
    return name;
  };
}
