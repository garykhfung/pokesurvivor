/* Drives a local solo run. Injected only by bot/play.py into dev.html. */
(function () {
  var STEP = 40;
  var HAZARD_SOON = 0.7;
  var DIRS = [
    ['stand still', 0, 0],
    ['move north', 0, -1],
    ['move north-east', 1, -1],
    ['move east', 1, 0],
    ['move south-east', 1, 1],
    ['move south', 0, 1],
    ['move south-west', -1, 1],
    ['move west', -1, 0],
    ['move north-west', -1, -1]
  ];
  var MOVE_KEYS = {
    'stand still': [],
    'move north': ['KeyW'],
    'move south': ['KeyS'],
    'move west': ['KeyA'],
    'move east': ['KeyD'],
    'move north-east': ['KeyW', 'KeyD'],
    'move south-east': ['KeyS', 'KeyD'],
    'move south-west': ['KeyS', 'KeyA'],
    'move north-west': ['KeyW', 'KeyA']
  };

  var held = {};
  var busy = false;
  var loop = false;
  var cardSent = '';
  var overHandled = false;
  var mark = 0;

  function key(type, code) {
    window.dispatchEvent(new KeyboardEvent(type, {
      code: code, key: code, bubbles: true, cancelable: true
    }));
  }

  function tap(code) {
    key('keydown', code);
    key('keyup', code);
  }

  function releaseMove() {
    Object.keys(held).forEach(function (code) { key('keyup', code); });
    held = {};
  }

  function holdMove(label) {
    var want = MOVE_KEYS[label] || [];
    Object.keys(held).forEach(function (code) {
      if (want.indexOf(code) < 0) { key('keyup', code); delete held[code]; }
    });
    want.forEach(function (code) {
      if (!held[code]) { key('keydown', code); held[code] = true; }
    });
  }

  function open(id) {
    return G.UI && G.UI.isOpen(id);
  }

  function phase() {
    if (!G.Game) return 'other';
    if (G.Judgment && G.Judgment.cinematic && G.Game.state === 'playing') return 'cinematic';
    if (G.Game.state === 'over' || open('scr-over')) return 'over';
    if (G.Game.state === 'levelup' || open('scr-levelup')) return 'levelup';
    if (open('scr-item')) return 'item';
    if (open('scr-bond')) return 'bond';
    if (G.Game.state === 'playing') return 'playing';
    return 'other';
  }

  function cardBox(ph) {
    return document.getElementById(ph === 'levelup' ? 'cards' : ph === 'item' ? 'item-cards' : 'bond-cards');
  }

  function cardsOf(ph) {
    var box = cardBox(ph);
    if (!box) return [];
    var used = {};
    return [].map.call(box.querySelectorAll('.card'), function (el) {
      var nm = el.querySelector('.nm');
      var chip = nm && nm.querySelector('.tag-chip');
      var title = '';
      if (nm) {
        [].forEach.call(nm.childNodes, function (n) {
          if (n !== chip && n.nodeType === 3) title += n.textContent;
        });
        title = title.replace(/\s+/g, ' ').trim() || nm.textContent.replace(/\s+/g, ' ').trim();
      }
      var tag = chip ? chip.textContent.replace(/\s+/g, ' ').trim() : '';
      var ds = ((el.querySelector('.ds') || {}).textContent || '').replace(/\s+/g, ' ').trim();
      var label = title || 'reward';
      if (used[label]) label = (title + ' ' + (tag || Object.keys(used).length)).trim();
      used[label] = true;
      return { label: label, detail: [tag, ds].filter(Boolean).join('. ').slice(0, 180) };
    });
  }

  function safeDirs(pl) {
    var soon = (G.Hazards.all || []).filter(function (h) {
      return !h.hit && (h.delay - h.t) < HAZARD_SOON;
    });
    var out = [];
    DIRS.forEach(function (d) {
      var len = Math.hypot(d[1], d[2]) || 1;
      var x = pl.x + (d[0] === 'stand still' ? 0 : d[1] / len * STEP);
      var y = pl.y + (d[0] === 'stand still' ? 0 : d[2] / len * STEP);
      // isFree also rejects water. The shield will not step into a pond.
      if (d[0] !== 'stand still' && !G.World.isFree(x, y, pl.r)) return;
      if (soon.some(function (h) { return G.Hazards.inside(h, x, y, pl.r); })) return;
      out.push(d[0]);
    });
    return out;
  }

  function snapshot(ph) {
    var pl = G.Game.player;
    var foes = [];
    if (pl && G.EnemyMgr) {
      foes = G.EnemyMgr.all().filter(function (e) { return e && !e.dead; }).map(function (e) {
        var dx = e.x - pl.x, dy = e.y - pl.y;
        return { name: e.name, boss: !!e.boss, dist: Math.round(Math.hypot(dx, dy)), dx: Math.round(dx), dy: Math.round(dy) };
      }).sort(function (a, b) { return a.dist - b.dist; }).slice(0, 6);
    }
    var hazards = [];
    if (pl && G.Hazards) {
      hazards = (G.Hazards.all || []).filter(function (h) { return !h.hit; }).map(function (h) {
        var dx = (h.x || pl.x) - pl.x, dy = (h.y || pl.y) - pl.y;
        return { kind: h.kind, dist: Math.round(Math.hypot(dx, dy)), dx: Math.round(dx), dy: Math.round(dy), delay: Math.round((h.delay - h.t) * 10) / 10 };
      }).filter(function (h) { return h.dist < 220 || h.delay < HAZARD_SOON; }).slice(0, 4);
    }
    var liquid = null;
    if (pl && pl.inLiquid && G.World.liquidEffect(pl.mon.types).dmg) liquid = G.World.liquidKind();
    return {
      phase: ph,
      hp: pl ? Math.round(pl.hp) : 0,
      maxHp: pl ? Math.round(pl.maxHp) : 1,
      x: pl ? Math.round(pl.x) : 0,
      y: pl ? Math.round(pl.y) : 0,
      level: pl ? pl.level : 1,
      time: G.Game.st ? G.Game.st.time : 0,
      liquid: liquid,
      enemies: foes,
      hazards: hazards,
      safe: pl && ph === 'playing' ? safeDirs(pl) : [],
      cards: ph === 'playing' || ph === 'cinematic' || ph === 'over' ? [] : cardsOf(ph)
    };
  }

  function apply(cmd, snap) {
    if (!cmd || cmd.action === 'wait') return;
    if (cmd.action === 'card') {
      var now = phase();
      if (now !== 'levelup' && now !== 'item' && now !== 'bond') return;
      var sig = (snap.cards || []).map(function (c) { return c.label; }).join('|');
      if (cardSent === sig) return;
      cardSent = sig;
      releaseMove();
      tap('Digit' + ((cmd.index || 0) + 1));
      setTimeout(function () {
        if (cardSent === sig && phase() !== 'playing') cardSent = '';
      }, 800);
      return;
    }
    if (cmd.action === 'move' && phase() === 'playing') holdMove(cmd.label);
  }

  function tick() {
    var ph = phase();
    if (ph === 'playing') cardSent = '';
    if (ph === 'cinematic') { tap('Space'); return; }
    if (ph === 'over') {
      if (overHandled) return;
      overHandled = true;
      releaseMove();
      var btn = document.getElementById('btn-again');
      if (btn) btn.click();
      try { G.Flow.play(); } catch (e) { console.error('[bot]', e); }
      return;
    }
    overHandled = false;
    if (ph !== 'playing' && ph !== 'levelup' && ph !== 'item' && ph !== 'bond') return;
    var box = cardBox(ph);
    if (ph !== 'playing' && box && box.classList.contains('guard')) { releaseMove(); return; }
    var pl = G.Game.player;
    if (ph === 'playing' && pl && Date.now() - mark > 2000) {
      mark = Date.now();
      console.log('[bot] at', Math.round(pl.x), Math.round(pl.y), 'hp', Math.round(pl.hp));
    }
    if (busy) return;
    var snap = snapshot(ph);
    busy = true;
    fetch('/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snap)
    }).then(function (r) {
      if (!r.ok) throw new Error('decide ' + r.status);
      return r.json();
    }).then(function (cmd) {
      apply(cmd, snap);
    }).catch(function (e) {
      console.warn('[bot]', e);
    }).then(function () { busy = false; });
  }

  function begin() {
    G.DB.playAsGuest();
    var save = G.DB.save;
    save.starter = 1;
    save.partner = 1;
    G.DB.grant(1, 'starter');
    G.Flow.goMenu();
    G.Flow.play();
    console.log('[bot] run', G.Game.state);
  }

  function arm() {
    if (!window.G || !G.DB || !G.Flow || !G.Game || !G.UI) { setTimeout(arm, 50); return; }
    var boot = document.getElementById('boot');
    if (boot && !boot.classList.contains('hidden')) { setTimeout(arm, 50); return; }
    var tapEl = document.getElementById('tap-start');
    if (tapEl && !tapEl.classList.contains('hidden')) { tapEl.click(); setTimeout(arm, 50); return; }
    if (G.Game.state === 'ui') {
      try { begin(); }
      catch (e) { console.error('[bot] start', e); setTimeout(arm, 400); return; }
    }
    if (!loop) { loop = true; setInterval(tick, 200); }
  }

  arm();
})();
