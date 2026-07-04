/* ============ main.js — bootstrap, game loop, menu flow ============ */
window.RTS = window.RTS || {};

RTS.main = (function () {
  'use strict';
  const C = RTS.config;

  let running = false;
  let paused = false;
  let accumulator = 0;
  let lastT = 0;
  let rafId = 0;

  function $(id) { return document.getElementById(id); }

  function boot() {
    RTS.sprites.init();
    RTS.render.init($('game-canvas'), $('fx-canvas'));
    RTS.ui.init();
    RTS.input.init($('game-canvas'));
    wireMenus();
    lastT = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  /* ---------------- fixed-step loop ---------------- */
  function loop(now) {
    rafId = requestAnimationFrame(loop);
    let dtF = (now - lastT) / 1000;
    lastT = now;
    if (dtF > 0.25) dtF = 0.25; // background tab catch-up guard

    if (running && !paused) {
      accumulator += dtF;
      let steps = 0;
      while (accumulator >= C.SIM_DT && steps < 6) {
        RTS.game.tick();
        accumulator -= C.SIM_DT;
        steps++;
      }
      if (steps === 6) accumulator = 0; // give up catching up, stay smooth
      RTS.input.update(dtF);
      RTS.ui.update(dtF);
    }

    /* dispatch sim events to presentation layers */
    if (RTS.events.length) {
      for (const e of RTS.events) {
        RTS.render.onEvent(e);
        RTS.ui.onEvent(e);
        if (e.t === 'gameover') onGameOver(e);
      }
      RTS.events.length = 0;
    }

    const alpha = running && !paused ? accumulator / C.SIM_DT : 1;
    RTS.render.render(alpha, dtF, now);
  }

  /* ---------------- flow ---------------- */
  function startGame(opts) {
    RTS.net.disconnect();
    const state = RTS.game.newGame(opts);
    afterStart(state);
  }

  function startMultiplayer(info) {
    const state = RTS.game.newGame({
      seed: info.seed, mp: true, localPlayer: info.localPlayer
    });
    afterStart(state);
  }

  function afterStart(state) {
    RTS.ui.resetForNewGame();
    const start = state.buildings.find(function (b) {
      return b.owner === state.localPlayer && b.type === 'hq';
    });
    if (start) RTS.render.centerOn(start.x, start.y);
    $('menu-screen').classList.add('hidden');
    $('pause-screen').classList.add('hidden');
    $('end-screen').classList.add('hidden');
    RTS.ui.show();
    RTS.input.setEnabled(true);
    running = true;
    paused = false;
    accumulator = 0;
    RTS.ui.toast('Build your base. Destroy the enemy HQ. Good luck, Commander.');
  }

  function quitToMenu() {
    running = false;
    paused = false;
    RTS.net.disconnect();
    RTS.game.clear();
    RTS.input.setEnabled(false);
    RTS.ui.hide();
    $('pause-screen').classList.add('hidden');
    $('end-screen').classList.add('hidden');
    $('menu-screen').classList.remove('hidden');
    refreshLoadButtons();
  }

  function togglePause() {
    if (!running) return;
    if (RTS.game.state && RTS.game.state.mp) {
      RTS.ui.toast('Cannot pause a multiplayer match', true);
      return;
    }
    paused = !paused;
    $('pause-screen').classList.toggle('hidden', !paused);
  }

  function quickLoad() {
    const st = RTS.save.load();
    if (st) {
      afterStart(st);
      RTS.ui.toast('Game loaded.');
    } else {
      RTS.ui.toast('No saved game found.', true);
    }
  }

  function onGameOver(e) {
    const state = RTS.game.state;
    if (!state) return;
    running = true; // keep rendering the aftermath
    const won = e.winner === state.localPlayer;
    const title = $('end-title');
    title.textContent = won ? 'VICTORY' : 'DEFEAT';
    title.classList.toggle('defeat', !won);
    $('end-text').textContent = won
      ? 'The enemy headquarters lies in ruins. The frontier is yours.'
      : 'Your headquarters has fallen. The war is lost… this time.';
    setTimeout(function () {
      $('end-screen').classList.remove('hidden');
    }, 1600);
  }

  /* ---------------- menu wiring ---------------- */
  function wireMenus() {
    $('btn-newgame').addEventListener('click', function () {
      $('difficulty-row').classList.toggle('hidden');
      $('mp-row').classList.add('hidden');
    });
    document.querySelectorAll('.diff').forEach(function (b) {
      b.addEventListener('click', function () {
        startGame({ difficulty: b.dataset.diff });
      });
    });

    $('btn-multiplayer').addEventListener('click', function () {
      $('mp-row').classList.toggle('hidden');
      $('difficulty-row').classList.add('hidden');
      const srv = $('mp-server');
      if (!srv.value) {
        srv.value = (location.protocol === 'https:' ? 'wss://' : 'ws://') +
          (location.hostname || 'localhost') + ':8765';
      }
    });
    $('btn-mp-join').addEventListener('click', function () {
      const url = $('mp-server').value.trim();
      const room = $('mp-room').value.trim() || 'default';
      if (!url) { $('mp-status').textContent = 'Enter a server address.'; return; }
      $('mp-status').textContent = 'Connecting…';
      RTS.net.connect(url, room, {
        onStatus: function (s) { $('mp-status').textContent = s; },
        onStart: function (info) { startMultiplayer(info); }
      });
    });

    $('btn-load').addEventListener('click', quickLoad);
    $('btn-howto').addEventListener('click', function () {
      $('howto').classList.toggle('hidden');
    });

    $('btn-menu').addEventListener('click', togglePause);
    $('btn-resume').addEventListener('click', togglePause);
    $('btn-save').addEventListener('click', function () {
      if (RTS.save.save()) RTS.ui.toast('Game saved.');
      togglePause();
    });
    $('btn-load2').addEventListener('click', function () {
      quickLoad();
    });
    $('btn-quit').addEventListener('click', quitToMenu);
    $('btn-end-menu').addEventListener('click', quitToMenu);

    refreshLoadButtons();
  }

  function refreshLoadButtons() {
    const has = RTS.save.hasSave();
    $('btn-load').style.opacity = has ? 1 : 0.45;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  return { togglePause: togglePause, quickLoad: quickLoad, quitToMenu: quitToMenu };
})();
