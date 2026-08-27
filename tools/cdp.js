// A tiny Chrome DevTools Protocol client, so the browser smoke test needs no
// dependencies. Node 22 ships a global WebSocket and fetch, which is all this
// takes — adding Playwright for one script would put a 200MB node_modules into
// a project whose whole premise is that it has none.
import { spawn } from 'node:child_process';

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Launch headless Chromium and wait for its first page target.
 *
 * `port` MUST default to something that cannot collide across concurrent or
 * back-to-back calls. It used to default to a fixed 9333: if anything was
 * already bound there (a prior run that never got killed, an orphaned
 * process), this spawn's OWN debugging port silently failed to bind, and the
 * polling loop below then happily found the OLD process's pre-existing page
 * instead — connecting to a foreign, already-navigated, already-mutating tab
 * with NO indication anything was wrong. That tab can go on accumulating
 * state (drags, sieges, sim ticks) from every unrelated script that ever
 * calls launch() again, for as long as it lives — a single stale Chrome
 * silently answering for every "fresh browser" verification is exactly the
 * kind of failure that makes a passing check meaningless. Random port PLUS a
 * loud runtime check that the tab we got is actually OUR tab, not a hitchhiker.
 */
export async function launch({ url, port, width = 1440, height = 900 } = {}) {
  const debugPort = port ?? (20000 + Math.floor(Math.random() * 20000));
  const proc = spawn(CHROME, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    `--remote-debugging-port=${debugPort}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(250);
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* not up yet */ }
  }
  if (!target) {
    proc.kill();
    throw new Error('Chromium DevTools endpoint never came up');
  }
  // A target this soon after spawn should still be the blank page we asked
  // for. If it is already somewhere else, this debug port was not exclusively
  // ours — a leftover process answered instead of the one just spawned, and
  // every subsequent command in this session would silently act on a browser
  // nobody meant to be testing. Fail loudly rather than pretend.
  if (target.url && !target.url.startsWith('about:blank') && target.url !== '') {
    proc.kill();
    throw new Error(`launch(): got a foreign tab already at "${target.url}" on port `
      + `${debugPort} — a leftover Chrome process is answering instead of this one. `
      + 'Kill stray chromium processes and retry.');
  }

  const client = await connect(target.webSocketDebuggerUrl);
  client.close = ((inner) => async () => { inner(); proc.kill(); })(client.close);
  // AND REAPED EVEN IF THE DRIVER NEVER CALLS close(). Exiting this process
  // does not kill a spawned child, so a probe that ends with `process.exit(0)`
  // — which is most of them, written by hand and thrown away — leaves a whole
  // Chrome behind. Measured after one afternoon of that: 134 orphaned
  // processes and a load average of 28, at which point `smoke.mjs` fails with
  // `could not reach a battle from "null"` and looks exactly like a broken
  // game rather than a busy box. Discipline was the wrong fix; this is free.
  process.once('exit', () => { try { proc.kill(); } catch { /* already gone */ } });
  await client.goto(url);
  return client;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const listeners = [];
    let nextId = 1;

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: ok, reject: no } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) no(new Error(`${msg.error.message} (${msg.error.code})`));
        else ok(msg.result);
      } else if (msg.method) {
        for (const fn of listeners) fn(msg.method, msg.params);
      }
    });
    ws.addEventListener('error', () => reject(new Error('CDP socket error')));

    ws.addEventListener('open', async () => {
      const send = (method, params = {}) => new Promise((ok, no) => {
        const id = nextId++;
        pending.set(id, { resolve: ok, reject: no });
        ws.send(JSON.stringify({ id, method, params }));
      });

      const api = {
        send,
        on: (fn) => { listeners.push(fn); },

        /** Evaluate in the page and return the value, throwing on page errors. */
        async eval(fn, ...args) {
          const expr = `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`;
          const res = await send('Runtime.evaluate', {
            expression: expr, awaitPromise: true, returnByValue: true,
          });
          if (res.exceptionDetails) {
            const e = res.exceptionDetails;
            throw new Error(e.exception?.description || e.text || 'page exception');
          }
          return res.result.value;
        },

        async screenshot(path) {
          const { data } = await send('Page.captureScreenshot', { format: 'png' });
          const { writeFile } = await import('node:fs/promises');
          await writeFile(path, Buffer.from(data, 'base64'));
          return path;
        },

        async goto(url) {
          await send('Page.navigate', { url });
          await sleep(500);
        },

        /** Real mouse gestures, so drag orders go through the same pointer path
         *  a player uses rather than a synthetic shortcut. */
        /** `buttons` is the held-button BITMASK (left 1, right 2), which is
         *  separate from `button` and is what makes a move count as a drag
         *  rather than a hover. */
        async mouse(type, x, y, button = 'left', buttons = 0) {
          await send('Input.dispatchMouseEvent', {
            type, x, y, button, buttons, clickCount: type === 'mousePressed' ? 1 : 0,
          });
        },
        /**
         * A REAL KEY EVENT, for the same reason `mouse` dispatches a real
         * pointer one: the board's keys are bound on `window` and read
         * `ev.target`, so a synthetic `new KeyboardEvent` fired from page
         * script can be made to say anything and proves nothing about whether
         * the listener is attached where the game thinks it is.
         *
         * `key` is what `ev.key` reports and is the only field this game's
         * handler reads; `rawKeyDown` rather than `keyDown` because the latter
         * expects `text` for printable characters and silently sends nothing
         * without it.
         */
        async key(key, type = 'rawKeyDown') {
          await send('Input.dispatchKeyEvent', { type, key, windowsVirtualKeyCode: 0 });
        },
        async press(key) {
          await api.key(key, 'rawKeyDown');
          await api.key(key, 'keyUp');
        },
        async drag(from, to, steps = 12, button = 'left') {
          const mask = button === 'right' ? 2 : 1;
          await api.mouse('mouseMoved', from.x, from.y, 'none', 0);
          await api.mouse('mousePressed', from.x, from.y, button, mask);
          for (let i = 1; i <= steps; i++) {
            await api.mouse('mouseMoved',
              from.x + ((to.x - from.x) * i) / steps,
              from.y + ((to.y - from.y) * i) / steps, button, mask);
            await sleep(12);
          }
          await api.mouse('mouseReleased', to.x, to.y, button, 0);
        },

        close: () => ws.close(),
        sleep,
      };

      await send('Page.enable');
      await send('Runtime.enable');
      await send('Log.enable');
      resolve(api);
    });
  });
}
