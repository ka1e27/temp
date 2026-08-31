// Tiny DOM helpers. Not a framework — an element factory plus a value cache.
//
// The one idea worth having: the HUD refreshes at 10Hz forever, and the vast
// majority of those refreshes change nothing. bindText/bindStyle/bindClass
// remember the last value and skip the write, so a static HUD costs zero
// layout and zero style recalculation.

/**
 * Element factory. `tag` accepts an emmet-ish selector: 'div.panel.row#hud'.
 * Props: `class`, `text`, `html`, `style` (object), `data` (object),
 * `on` (event map), anything else becomes an attribute; `null`/`undefined`
 * values are skipped so callers can inline conditionals.
 *
 * @param {string} tag
 * @param {object|null} [props]
 * @param {...(Node|string|null|undefined|Array)} children
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][^.#]+)*)$/i.exec(tag) || [];
  const el = document.createElement(m[1] || 'div');
  if (m[2]) {
    for (const part of m[2].match(/[.#][^.#]+/g) || []) {
      if (part[0] === '#') el.id = part.slice(1);
      else el.classList.add(part.slice(1));
    }
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.classList.add(...String(v).split(/\s+/).filter(Boolean));
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'html') el.innerHTML = String(v);
      else if (k === 'style') Object.assign(el.style, v);
      else if (k === 'data') for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = dv;
      else if (k === 'on') for (const [ek, ev] of Object.entries(v)) el.addEventListener(ek, ev);
      else if (k === 'vars') for (const [vk, vv] of Object.entries(v)) el.style.setProperty(vk, vv);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const mount = (parent, ...els) => append(parent, els);

export function unmount(el) {
  el?.remove();
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const qs = (sel, root = document) => root.querySelector(sel);

/**
 * Cache a text write. Returns an updater; calling it with an unchanged value
 * is a single string comparison and no DOM touch at all.
 * @param {HTMLElement} el
 * @param {string} [initial]
 * @returns {(value:string|number)=>boolean} true when the DOM actually changed
 */
export function bindText(el, initial) {
  let last = initial === undefined ? Symbol('unset') : initial;
  if (initial !== undefined) el.textContent = String(initial);
  return (value) => {
    if (value === last) return false;
    last = value;
    el.textContent = String(value);
    return true;
  };
}

/** Same contract for a single CSS class. */
export function bindClass(el, name) {
  let last = null;
  return (on) => {
    on = !!on;
    if (on === last) return false;
    last = on;
    el.classList.toggle(name, on);
    return true;
  };
}

/** Same contract for a single ATTRIBUTE — the member of this family that was
 *  missing, and its absence is why `aria-hidden` on the unit hover card was
 *  written once at construction and never toggled again. A null or false value
 *  REMOVES the attribute rather than writing the string "null", because that is
 *  what `aria-hidden` and friends mean by absent. */
export function bindAttr(el, name) {
  let last = null;
  return (value) => {
    const v = value === null || value === false ? null : String(value);
    if (v === last) return false;
    last = v;
    if (v === null) el.removeAttribute(name);
    else el.setAttribute(name, v);
    return true;
  };
}

/** Same contract for one CSS custom property or style field. */
export function bindStyle(el, prop) {
  let last = null;
  const isVar = prop.startsWith('--');
  return (value) => {
    const v = String(value);
    if (v === last) return false;
    last = v;
    if (isVar) el.style.setProperty(prop, v);
    else el.style[prop] = v;
    return true;
  };
}

/**
 * Collects unsubscribes so a scene tears down in one call. Screens accumulate
 * listeners fast; forgetting one is the classic leak in a scene-based game.
 */
export function createDisposer() {
  const fns = [];
  const add = (fn) => (fns.push(fn), fn);
  add.listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    add(() => target.removeEventListener(type, fn, opts));
  };
  add.dispose = () => {
    for (let i = fns.length - 1; i >= 0; i--) fns[i]();
    fns.length = 0;
  };
  return add;
}

/**
 * IS THERE MORE BELOW THE FOLD OF A SCROLL CONTAINER?
 *
 * Takes the three METRICS rather than the element, so it is a pure function
 * with no document in it and the off-by-one can be pinned in a test — the
 * failure it exists to prevent is a fade that never appears (`>= 0` misread as
 * "fits") or one that never goes away (fractional layout heights leaving a
 * sub-pixel remainder at the very bottom of the scroll).
 *
 * The 4px slack is that second case: a scroll container whose content is a
 * fractional number of pixels tall reports `scrollTop + clientHeight` a hair
 * under `scrollHeight` even when the user is at the end of it.
 */
export function moreBelow({ scrollHeight = 0, clientHeight = 0, scrollTop = 0 } = {}) {
  return scrollHeight - clientHeight - scrollTop > 4;
}

/**
 * Keep a `has-more` fade in step with a set of scroll containers, and hand back
 * the disposer.
 *
 * Lives beside `moreBelow` because it is the same concern one layer up, and it
 * is shared because the failure it prevents is not a niche one: a container
 * that clips its last child leaves that child DRAWN BUT UNCLICKABLE, since the
 * click lands wherever the clipped pixels fall through to. The battle HUD's
 * rails hit exactly that — a booster at a full 44px whose press reached the
 * canvas — and the loadout screen hit it before them.
 *
 * `resize` is a required trigger rather than a nicety: the shortfall is a
 * function of viewport height, so a window the player drags crosses the
 * boundary with nothing else re-rendering.
 */
export function watchOverflow(els) {
  const list = els.filter(Boolean);
  const sync = () => {
    for (const el of list) el.classList.toggle('has-more', moreBelow(el));
  };
  sync();
  window.addEventListener('resize', sync);
  for (const el of list) el.addEventListener('scroll', sync, { passive: true });
  // ...AND A RESIZE IS NOT THE ONLY WAY THE SHORTFALL MOVES. Measured: arming
  // the withdraw confirm inserts a transient hint ABOVE the rails in the same
  // flex column, which pushes them down and re-clips the bottom card — with no
  // resize event anywhere, so a listener-only version went on showing "it
  // fits" while a control sat out of reach. A ResizeObserver on the rails
  // themselves catches every cause, including the ones nobody has thought of.
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null;
  for (const el of list) ro?.observe(el);
  return () => {
    window.removeEventListener('resize', sync);
    for (const el of list) el.removeEventListener('scroll', sync);
    ro?.disconnect();
  };
}
