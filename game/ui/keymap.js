// The rebindable keyboard map (PLAN-PHASE14 §14B.5). DOM-free: an action table, the live bindings (one module-wide map, set from the player's
// options by main.js), matching against a KeyboardEvent-like object, labels, conflict detection and the swap a rebind makes.
// Keys are PHYSICAL (`event.code`), so a binding means the same place on every keyboard layout, as the shortcuts always have.
// Fixed keys that are not rebindable: Escape, Tab, Enter, the arrows, brackets, plus and minus (the map's and the dialogs' own keys).

export const KEY_ACTIONS = Object.freeze([
  { id: 'send25', label: 'Send 25%', group: 'battle', def: 'Digit1' },
  { id: 'send50', label: 'Send 50%', group: 'battle', def: 'Digit2' },
  { id: 'send75', label: 'Send 75%', group: 'battle', def: 'Digit3' },
  { id: 'send100', label: 'Send 100%', group: 'battle', def: 'Digit4' },
  { id: 'power1', label: 'Power 1 (Rally)', group: 'battle', def: 'KeyQ' },
  { id: 'power2', label: 'Power 2 (Firestorm)', group: 'battle', def: 'KeyW' },
  { id: 'power3', label: 'Power 3 (Bulwark)', group: 'battle', def: 'KeyE' },
  { id: 'power4', label: 'Power 4 (Forced March)', group: 'battle', def: 'KeyR' },
  { id: 'power5', label: 'Power 5 (Levy)', group: 'battle', def: 'KeyT' },
  { id: 'ability', label: 'Commander ability', group: 'battle', def: 'KeyG' },
  { id: 'auto', label: 'Auto (supply lines)', group: 'battle', def: 'KeyS' },
  { id: 'selectAll', label: 'Select all settlements', group: 'battle', def: 'KeyA' },
  { id: 'pause', label: 'Pause', group: 'battle', def: 'Space' },
  { id: 'speed', label: 'Battle speed', group: 'battle', def: 'KeyF' },
  { id: 'mute', label: 'Mute / unmute', group: 'any', def: 'KeyM' },
]);
const ACTION_IDS = KEY_ACTIONS.map((a) => a.id);

/** Keys the game uses for fixed purposes: never bindable. */
export const RESERVED_CODES = Object.freeze([
  'Escape', 'Tab', 'Enter', 'NumpadEnter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'BracketLeft', 'BracketRight', 'Equal', 'Minus',
  'NumpadAdd', 'NumpadSubtract', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
  'CapsLock', 'ContextMenu', 'OSLeft', 'OSRight',
]);
const CODE_RE = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F([1-9]|1[0-2])|Space|Backquote|Backslash|Semicolon|Quote|Comma|Period|Slash|Home|End|PageUp|PageDown|Insert|Delete|Backspace|NumpadDecimal|NumpadMultiply|NumpadDivide|IntlBackslash)$/;

export const isBindable = (code) => typeof code === 'string' && CODE_RE.test(code) && !RESERVED_CODES.includes(code);

export function defaultBindings() {
  const out = {};
  for (const a of KEY_ACTIONS) out[a.id] = a.def;
  return out;
}

/** Whitelists actions and codes; a duplicate keeps the first action (table order) and the later one falls back to its default when that is free. */
export function sanitizeBindings(raw) {
  const d = defaultBindings();
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const id of ACTION_IDS) out[id] = isBindable(src[id]) ? src[id] : d[id];
  const used = new Map();
  for (const id of ACTION_IDS) {
    const c = out[id];
    if (!used.has(c)) { used.set(c, id); continue; }
    out[id] = null; // resolved below
  }
  for (const id of ACTION_IDS) {
    if (out[id] != null) continue;
    out[id] = used.has(d[id]) ? null : d[id];
    if (out[id]) used.set(out[id], id);
  }
  return out;
}

/** Every code bound to more than one action: [{ code, actions: [id, ...] }]. */
export function findConflicts(bindings) {
  const by = new Map();
  for (const id of ACTION_IDS) {
    const c = bindings[id];
    if (!c) continue;
    if (!by.has(c)) by.set(c, []);
    by.get(c).push(id);
  }
  return [...by.entries()].filter(([, ids]) => ids.length > 1).map(([code, actions]) => ({ code, actions }));
}

/**
 * Binds `action` to `code`. When another action already holds that key, the two SWAP (the other takes this action's old key), so the map never
 * holds a conflict. Returns { bindings, swapped: otherActionId|null, error: null|'reserved'|'unknown' }.
 */
export function rebind(bindings, action, code) {
  if (!ACTION_IDS.includes(action)) return { bindings, swapped: null, error: 'unknown' };
  if (!isBindable(code)) return { bindings, swapped: null, error: 'reserved' };
  const next = { ...bindings };
  const other = ACTION_IDS.find((id) => id !== action && next[id] === code) || null;
  if (other) next[other] = bindings[action] || null;
  next[action] = code;
  return { bindings: next, swapped: other, error: null };
}

/** "Q", "1", "Num 1", "Space", "F2", ";" ... */
export function keyLabel(code) {
  if (!code) return 'None';
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit([0-9])$/.exec(code);
  if (m) return m[1];
  m = /^Numpad([0-9])$/.exec(code);
  if (m) return `Num ${m[1]}`;
  const named = { Space: 'Space', Backquote: '`', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', PageUp: 'Page Up', PageDown: 'Page Down', Backspace: 'Backspace', NumpadDecimal: 'Num .', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', IntlBackslash: '\\' };
  return named[code] || code;
}

export const actionLabel = (id) => (KEY_ACTIONS.find((a) => a.id === id) || { label: id }).label;

// --- the live map ------------------------------------------------------------------------------------------------------------------------------
let live = defaultBindings();
const listeners = new Set();

export function setBindings(b) {
  live = sanitizeBindings(b);
  for (const fn of listeners) { try { fn(live); } catch { /* a listener never breaks a rebind */ } }
}
export const getBindings = () => ({ ...live });
export const bindingOf = (action) => live[action] || null;
export const labelOf = (action) => keyLabel(live[action]);
/** Called whenever the bindings change (the battle HUD relabels its power hotkeys). */
export function onBindingsChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/**
 * Does this key event mean `action`? A digit binding also answers to the same digit on the numpad, and (no `code`, as some virtual keyboards
 * send) to the typed digit.
 */
export function matches(action, e) {
  const code = live[action];
  if (!code || !e) return false;
  if (e.code === code) return true;
  const m = /^Digit([0-9])$/.exec(code);
  if (m && (e.code === `Numpad${m[1]}` || (!e.code && e.key === m[1]))) return !Object.values(live).includes(e.code);
  return false;
}

/** The action a key event means, or null. */
export function actionFor(e) {
  for (const id of ACTION_IDS) if (matches(id, e)) return id;
  return null;
}
