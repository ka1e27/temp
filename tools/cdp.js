// A tiny Chrome DevTools Protocol client, so the browser smoke test needs no
// dependencies. Node 22 ships a global WebSocket and fetch, which is all this
// takes — adding Playwright for one script would put a 200MB node_modules into
// a project whose whole premise is that it has none.
import { spawn } from 'node:child_process';

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Launch headless Chromium and wait for its first page target. */
export async function launch({ url, port = 9333, width = 1440, height = 900 } = {}) {
  const proc = spawn(CHROME, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--window-size=${width},${height}`,
    url,
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(250);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* not up yet */ }
  }
  if (!target) {
    proc.kill();
    throw new Error('Chromium DevTools endpoint never came up');
  }

  const client = await connect(target.webSocketDebuggerUrl);
  client.close = ((inner) => async () => { inner(); proc.kill(); })(client.close);
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
