// Title scene (DESIGN §6 step 1, PLAYFEEL §1): the living map drifts slowly
// behind the title card. Continue / New Realm / Settings.
//
// The backdrop is the CLEAR continent (no fog): it shows off the art, and the
// mists roll in over the undiscovered regions when the player enters the world.
import { TITLE } from './timing.js';
import { createModal } from '../ui/modal.js';
import { createSiteDrawer, openCameraLimits } from './worldLayers.js';

/**
 * @param {object} services shared instances built in main.js
 */
export function createTitleScene(services) {
  const {
    camera, renderer, ui, input, container, goto, version,
  } = services;

  let driftCx = 0;
  let driftCy = 0;
  let driftRx = 1;
  let driftRy = 1;
  let baseZoom = 1;
  let tAccum = 0;
  let siteDrawer = null;
  let siteDrawerWorld = null;
  let fadeEl = null;

  function layoutDrift() {
    const world = container.get().world;
    const b = world.bounds;
    driftCx = (b.minX + b.maxX) / 2;
    driftCy = (b.minY + b.maxY) / 2;
    const fit = camera.fitZoom(b, 40);
    // Portrait phones would otherwise see the wide continent as a thin strip: fill the height instead
    // and let the slow drift carry the view across it.
    const portrait = camera.viewH > camera.viewW * 1.1;
    baseZoom = portrait ? Math.max(fit * 1.22, (camera.viewH * 0.8) / (b.maxY - b.minY)) : fit * 1.22;
    // The visible half-extent at baseZoom, in world units, tells us how much of
    // the continent hangs outside the view and can be drifted across.
    const halfW = camera.viewW / 2 / baseZoom;
    const halfH = camera.viewH / 2 / baseZoom;
    const spanX = Math.max(0, (b.maxX - b.minX) / 2 - halfW);
    const spanY = Math.max(0, (b.maxY - b.minY) / 2 - halfH);
    driftRx = Math.max(spanX, (b.maxX - b.minX) * 0.04) * (0.6 + TITLE.driftRadiusFrac);
    driftRy = Math.max(spanY, (b.maxY - b.minY) * 0.04) * (0.6 + TITLE.driftRadiusFrac);
  }

  /** Cross-fade through the sea colour while `swap` replaces the world under us. */
  function fadeThrough(swap) {
    if (!fadeEl) {
      fadeEl = document.createElement('div');
      fadeEl.className = 'hd-fade';
      document.body.appendChild(fadeEl);
    }
    fadeEl.classList.add('on');
    setTimeout(() => {
      swap();
      requestAnimationFrame(() => fadeEl.classList.remove('on'));
    }, 260);
  }

  function beginRealm(newWorld) {
    services.startSession();
    goto.world({ freshRealm: true, newWorld });
    services.autosave.save();
  }

  function startFreshRealm() {
    if (services.hasSaveOnDisk()) {
      // A saved realm is being replaced: a brand-new continent, hidden behind a fade.
      fadeThrough(() => {
        container.newRealm();
        services.applyWorld();
        beginRealm(true);
      });
    } else {
      // Nothing to lose: the player starts on the continent they have been admiring.
      container.restart();
      beginRealm(false);
    }
  }

  function onNewRealm() {
    if (services.hasSaveOnDisk()) {
      const modal = createModal({
        title: 'Start a new realm?',
        body: 'Your current realm and its save will be overwritten. This cannot be undone.',
        actions: [
          { label: 'Cancel', variant: 'secondary', onClick: () => modal.destroy() },
          { label: 'New Realm', variant: 'primary', onClick: () => { modal.destroy(); startFreshRealm(); } },
        ],
      }, { onDismiss: () => modal.destroy() });
      document.body.appendChild(modal.el);
    } else {
      startFreshRealm();
    }
  }

  function onContinue() {
    services.startSession();
    goto.world({ resume: true });
  }

  function enter() {
    input.setEnabled(false); // no map interaction beyond the overlay buttons
    const world = container.get().world;
    if (siteDrawerWorld !== world) { siteDrawer = createSiteDrawer(world); siteDrawerWorld = world; }
    openCameraLimits(camera);
    layoutDrift();
    camera.setZoomLimits(baseZoom * 0.5, baseZoom * 3);
    camera.cancelFlight();
    camera.x = driftCx;
    camera.y = driftCy;
    camera.zoom = baseZoom;
    tAccum = 0;

    services.hideAllPanels();
    ui.title.el.hidden = false;
    ui.title.update({ hasSave: services.hasSaveOnDisk(), version });
  }

  function exit() {
    ui.title.el.hidden = true;
    input.setEnabled(true);
  }

  function frame(dt, t, nowMs) {
    // Reduce Motion: no drift, no breathing, no moving clouds: the title is a still picture
    const still = !!container.get().state.settings.reduceMotion;
    if (!still) tAccum += dt;
    const tm = still ? 0 : t;
    camera.x = driftCx + Math.sin(tAccum * TITLE.driftSpeedX * 2.2) * driftRx;
    camera.y = driftCy + Math.cos(tAccum * TITLE.driftSpeedY * 2.6) * driftRy;
    camera.zoom = baseZoom * (1 + Math.sin(tAccum * TITLE.zoomBreatheSpeed) * TITLE.zoomBreatheAmount);

    const { state, world } = container.get();
    const { ctx } = renderer;
    renderer.beginFrame(camera);
    renderer.terrain.draw(ctx, camera, state.owner, undefined, { newBakeMs: 30 }); // the boot's chunks fill in over a few frames under the splash (Phase 8 perf)
    renderer.terrain.drawGlints(ctx, camera, tm);
    renderer.clouds.drawShadows(ctx, camera, tm);
    siteDrawer.draw(ctx, renderer, camera, state.owner, tm);
    renderer.clouds.drawAmbient(ctx, camera, tm);
    void world; void nowMs;
  }

  return {
    enter, exit, frame, onContinue, onNewRealm, onResize: layoutDrift,
  };
}
