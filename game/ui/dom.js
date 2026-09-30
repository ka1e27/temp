// Tiny DOM builder. No framework: every game/ui component is built from
// `h()` and returns `{ el, update(data), destroy() }` (ARCHITECTURE §8).
// Browser only — this file is never imported by a pure directory.

/**
 * @param {string} tag  e.g. `'div'`, or `'button.primary.big'` (dot-classes
 *   shorthand, à la hyperscript).
 * @param {Object<string, unknown>|null} [props]  DOM properties/attributes.
 *   `class`/`className` adds classes; `style` accepts an object or a CSS
 *   string; `dataset` accepts an object; any `onXyz` function is wired with
 *   `addEventListener('xyz', ...)`; everything else is set as a property
 *   when the element has one, else as an attribute.
 * @param {...(Node|string|number|null|undefined|false|Array)} children
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const [tagName, ...classes] = tag.split('.');
  const el = document.createElement(tagName || 'div');
  if (classes.length) el.classList.add(...classes);

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class' || key === 'className') {
        el.classList.add(...String(value).split(' ').filter(Boolean));
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value);
      } else if (key === 'dataset' && typeof value === 'object') {
        Object.assign(el.dataset, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key in el) {
        try {
          el[key] = value;
        } catch {
          el.setAttribute(key, value);
        }
      } else {
        el.setAttribute(key, value);
      }
    }
  }

  for (const child of children.flat(Infinity)) appendChild(el, child);
  return el;
}

function appendChild(el, child) {
  if (child == null || child === false) return;
  el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
}

/** Removes every child of `el`. */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/**
 * Clears `root` and appends `el` — a single Node, a string, or an array of
 * either.
 */
export function mount(root, el) {
  clear(root);
  for (const child of [].concat(el)) appendChild(root, child);
}
