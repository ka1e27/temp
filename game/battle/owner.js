// Faction/owner id constants shared across the battle module (ARCHITECTURE §4: faction id 0
// is always the player, 1 is always Free Folk). Kept in their own tiny module so every file
// that needs them (arena, sim, combat, squads, powers, ai, bot, difficulty) can import them
// without depending on each other.
export const PLAYER_OWNER = 0;
export const FREE_FOLK_OWNER = 1;
