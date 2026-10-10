/* Who gets to play? Lecture runtime.
   Plain script (no modules) so it also runs from file:// with no server. */
(function () {
  'use strict';

  var WG = window.WG;
  var W = 1600, H = 900;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var root = document.documentElement;
  var stage = $('#stage');
  var scale = 1, fluid = false, lk = 0.6;
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  // next frame, with a timer fallback so a throttled tab never stalls a transition
  var frame = function () { return new Promise(function (r) { var done = false; var go = function () { if (!done) { done = true; r(); } }; requestAnimationFrame(go); setTimeout(go, 60); }); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  /* ------------------------------------------------------------------ prefs */
  var osReduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var prefs = { reduceMotion: osReduce };
  try {
    var saved = JSON.parse(localStorage.getItem('wg-prefs') || '{}');
    if (typeof saved.reduceMotion === 'boolean') prefs.reduceMotion = saved.reduceMotion;
  } catch (e) { /* storage unavailable: keep defaults */ }
  function savePrefs() { try { localStorage.setItem('wg-prefs', JSON.stringify(prefs)); } catch (e) { /* ignore */ } }
  function rm() { return prefs.reduceMotion; }
  // stage-wide effects (zoom rects, dither wipe, the case flight) only make sense on the fixed stage
  function fxOff() { return prefs.reduceMotion || fluid; }
  function applyPrefs() {
    root.classList.toggle('rm', rm());
    $('#opt-motion').checked = rm();
  }

  /* ------------------------------------------------------------------ layout mode */
  function fit() {
    // the layout viewport: unlike innerWidth, it does not grow when a phone zooms out
    var w = root.clientWidth || window.innerWidth, h = root.clientHeight || window.innerHeight;
    var s = Math.min(w / W, h / H);
    var wasFluid = fluid;
    // phones and tablets reflow instead of shrinking the text; a projector or laptop keeps the stage
    var touch = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
    fluid = s < 0.6 || (touch && s < 0.7);
    root.classList.toggle('fluid', fluid);
    scale = fluid ? 1 : s;
    root.style.setProperty('--s', scale);
    if (fluid) {
      lk = clamp(h * 0.48 / 570, 0.42, 0.8);
      root.style.setProperty('--lk', lk);
      root.style.setProperty('--tk', Math.min(1, (w - 32) / 470, h * 0.66 / 665));
    }
    if (wasFluid !== fluid) { hideLabel(); if (popupOpen()) closePopup(true); }
  }
  function sRect(el) {
    var r = el.getBoundingClientRect(), s = stage.getBoundingClientRect();
    return { x: (r.left - s.left) / scale, y: (r.top - s.top) / scale, w: r.width / scale, h: r.height / scale };
  }
  // layout box inside the library scene (unaffected by the scene's scaling on small screens)
  function oRect(el) { return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }; }

  /* ------------------------------------------------------------------ sequence */
  var items = WG.items, byId = {}, seq = [];
  items.forEach(function (it, i) {
    it.index = i; byId[it.id] = it;
    it.pages.forEach(function (p, j) { seq.push({ item: it, pi: j, id: p.id }); });
  });
  function seqIndex(itemId, pi) {
    for (var i = 0; i < seq.length; i++) if (seq[i].item.id === itemId && seq[i].pi === (pi || 0)) return i;
    return -1;
  }
  var pos = -1;            // current index in seq while in the deck
  var visited = {};        // item id -> true
  var screen = 'title';
  var busy = false;

  function live(msg) { $('#live').textContent = msg; }

  /* ================================================================== FX */

  /* Classic Mac "zoom rects": dotted outlines travelling from a to b. */
  function zoomRects(a, b, opts) {
    opts = opts || {};
    if (fxOff() || !a || !b) return Promise.resolve();
    var layer = $('#zoom-layer'), n = opts.n || 7, dur = opts.dur || 240, made = [];
    return new Promise(function (resolve) {
      var i = 0;
      function step() {
        i++;
        var t = i / n, e = 1 - Math.pow(1 - t, 2);
        var d = document.createElement('div');
        d.className = 'zr';
        d.style.left = (a.x + (b.x - a.x) * e) + 'px';
        d.style.top = (a.y + (b.y - a.y) * e) + 'px';
        d.style.width = (a.w + (b.w - a.w) * e) + 'px';
        d.style.height = (a.h + (b.h - a.h) * e) + 'px';
        layer.appendChild(d); made.push(d);
        if (made.length > 3) layer.removeChild(made.shift());
        if (i < n) setTimeout(step, dur / n);
        else setTimeout(function () { made.forEach(function (m) { if (m.parentNode) m.parentNode.removeChild(m); }); resolve(); }, dur / n);
      }
      step();
    });
  }

  /* Ordered-dither wipe across the stage, sweeping left to right. */
  var BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
  var fx = $('#fx'), fctx = fx.getContext('2d'), CW = 160, CH = 90;
  fx.width = CW; fx.height = CH;
  var fimg = fctx.createImageData(CW, CH), fbuf = new Uint32Array(fimg.data.buffer);
  var thr = new Float32Array(CW * CH);
  for (var yy = 0; yy < CH; yy++) for (var xx = 0; xx < CW; xx++) {
    thr[yy * CW + xx] = 0.62 * (BAYER[(yy & 7) * 8 + (xx & 7)] / 64) + 0.37 * (xx / (CW - 1));
  }
  var COVER = (255 << 24) | (0xec << 16) | (0xe1 << 8) | 0xe7; // #e7e1ec, little-endian ABGR
  function drawFx(t, covering) {
    for (var i = 0; i < thr.length; i++) {
      var on = covering ? thr[i] < t : thr[i] >= t;
      fbuf[i] = on ? COVER : 0;
    }
    fctx.putImageData(fimg, 0, 0);
  }
  function animate(dur, fn) {
    return new Promise(function (resolve) {
      var t0 = performance.now(), ended = false;
      function tick() {
        if (ended) return;
        var t = clamp((performance.now() - t0) / dur, 0, 1);
        fn(t);
        if (t < 1) requestAnimationFrame(tick); else { ended = true; resolve(); }
      }
      requestAnimationFrame(tick);
      // if frames are throttled, still finish on time
      setTimeout(function () { if (!ended) { fn(1); ended = true; resolve(); } }, dur + 250);
    });
  }
  function wipe(mid) {
    if (fxOff()) { mid(); return Promise.resolve(); }
    fx.style.display = 'block';
    return animate(260, function (t) { drawFx(t, true); })
      .then(function () { mid(); return frame(); })
      .then(function () { return animate(300, function (t) { drawFx(t, false); }); })
      .then(function () { fx.style.display = 'none'; });
  }

  /* Dithered fade for a single element, using a stepped Bayer mask. */
  var maskCache = [];
  function bayerMask(k) { // k in 0..64 cells visible
    if (maskCache[k]) return maskCache[k];
    var r = '';
    for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) if (BAYER[y * 8 + x] < k) r += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" shape-rendering="crispEdges">' + r + '</svg>';
    maskCache[k] = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
    return maskCache[k];
  }
  function ditherIn(el, dur, cell) {
    if (rm()) { el.style.opacity = 1; return Promise.resolve(); }
    cell = cell || 6;
    el.style.opacity = 1;
    var set = function (k) {
      if (k >= 64) { el.style.webkitMaskImage = el.style.maskImage = ''; return; }
      el.style.webkitMaskImage = el.style.maskImage = bayerMask(k);
      el.style.webkitMaskSize = el.style.maskSize = (cell * 8) + 'px ' + (cell * 8) + 'px';
    };
    set(0);
    return animate(dur, function (t) { set(Math.round(t * 64)); });
  }

  /* ================================================================== LIGHTBOX */
  var lb = $('#lightbox');
  function openLightbox(img) {
    var i = $('img', lb);
    i.src = img.currentSrc || img.src; i.alt = img.alt;
    lb.hidden = false;
    $('.lb-close', lb).focus();
  }
  function closeLightbox() { lb.hidden = true; }
  lb.addEventListener('click', closeLightbox);

  /* ================================================================== FLOATING WINDOWS */
  var zTop = 30;
  function openWin(id, fromEl) {
    var w = document.getElementById(id);
    if (!w) return;
    var page = w.closest('.page');
    $$('.win-float', page).forEach(function (o) { if (o !== w) o.hidden = true; });
    w.hidden = false;
    w.style.zIndex = ++zTop;
    var to = sRect(w);
    w.style.visibility = 'hidden';
    var from = fromEl ? sRect(fromEl) : { x: to.x + to.w / 2 - 20, y: to.y + to.h / 2 - 20, w: 40, h: 40 };
    return zoomRects(from, to).then(function () {
      w.style.visibility = '';
      var sc = $('.win-scroll', w); if (sc) sc.scrollTop = 0;
    });
  }
  function closeFloats(page) { $$('.win-float', page || document).forEach(function (w) { w.hidden = true; w.classList.remove('max'); }); }

  stage.addEventListener('click', function (e) {
    var close = e.target.closest('.win-float .win-close');
    if (close) { close.closest('.win-float').hidden = true; return; }
    var zoom = e.target.closest('button.win-zoom');
    if (zoom) {
      var win = zoom.closest('.win');
      if ($('.win-scroll', win)) { win.classList.toggle('max'); return; }
      var img = $('.win-img img', win);
      if (img) openLightbox(img);
      return;
    }
    var im = e.target.closest('.win-img img');
    if (im && !e.target.closest('.video-box')) openLightbox(im);
  });

  // drag floating windows by their title bar (large screens only)
  (function () {
    var drag = null;
    stage.addEventListener('pointerdown', function (e) {
      if (fluid) return;
      var bar = e.target.closest('.win-float .win-bar');
      if (!bar || e.target.closest('button')) return;
      var w = bar.parentNode;
      w.style.zIndex = ++zTop;
      drag = { w: w, x: e.clientX, y: e.clientY, l: w.offsetLeft, t: w.offsetTop };
      w.classList.add('dragging');
      bar.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', function (e) {
      if (!drag) return;
      drag.w.style.left = clamp(drag.l + (e.clientX - drag.x) / scale, -200, W - 120) + 'px';
      drag.w.style.top = clamp(drag.t + (e.clientY - drag.y) / scale, 0, H - 60) + 'px';
    });
    stage.addEventListener('pointerup', function () { if (drag) { drag.w.classList.remove('dragging'); drag = null; } });
  })();

  /* ================================================================== LIBRARY */
  var FLOOR = 760;
  // x: left edge, w/h: size of the case seen from the side (from each cover's real format),
  // lying: stacked flat (b = height above the shelf), lean: tilt in degrees
  var LAYOUT = {
    title:       { x: 104, w: 42, h: 470 },
    study:       { x: 152, w: 37, h: 309 },
    gap:         { x: 380, w: 25, h: 420 },
    checklists:  { x: 409, w: 37, h: 425 },
    awards:      { x: 450, w: 26, h: 420 },
    gamechanger: { x: 520, w: 35, h: 420, lean: -6 },
    whymc:       { x: 580, w: 470, h: 37, lying: true, b: 0 },
    mcgag:       { x: 600, w: 425, h: 37, lying: true, b: 37 },
    reviews:     { x: 592, w: 420, h: 33, lying: true, b: 74 },
    skin:        { x: 1062, w: 37, h: 338 },
    damsel:      { x: 1228, w: 36, h: 338 },
    backlash:    { x: 1268, w: 36, h: 425 },
    player:      { x: 1308, w: 26, h: 420 },
    end:         { x: 1348, w: 36, h: 338 },
    refs:        { x: 1412, w: 16, h: 372, lean: -4 },
    part1:       { tag: true, x: 380 },
    part2:       { tag: true, x: 1228 }
  };
  // decorative objects: dithered photos (public domain, Evan-Amos) and a jewel case shown face-out
  var OBJECTS = [
    { src: 'crash', jewel: true, x: 196, w: 172, h: 163, lean: -2 },
    { src: 'controller', x: 640, b: 107, w: 260, h: 166 },
    { src: 'gameboy', x: 1108, w: 107, h: 179 },
    { src: 'memcard', x: 1446, w: 62, h: 55, lean: -6 },
    { src: '3ds', x: 1316, top: 121, w: 152, h: 138, sill: true }
  ];
  var shelf = $('#shelf');
  var caseEls = {};
  var selId = null;

  // url() inside a custom property resolves against style.css, hence the ../ paths
  function artStyle(dir, file, color) {
    var css = '--sp:url(\'../' + dir + '/' + file + '\');';
    if (color) {
      var c = file.replace(/\.png$/, '-c.png');
      css += '--sp-c:url(\'../' + dir + '/' + c + '\');';
      new Image().src = 'assets/' + dir + '/' + c; // preload, so the hover swap does not flicker
    }
    return css;
  }
  function spineStyle(item) {
    var sp = WG.spines[item.id];
    return sp ? artStyle('spines', sp.file, sp.color) : '';
  }

  function buildShelf() {
    OBJECTS.forEach(function (o) {
      var el = document.createElement('span');
      el.className = (o.jewel ? 'jewel' : 'obj') + (o.sill ? ' on-sill' : '');
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = 'left:' + o.x + 'px;top:' + (o.top != null ? o.top : FLOOR - (o.b || 0) - o.h) + 'px;width:' + o.w + 'px;height:' + o.h + 'px;' +
        (o.lean ? '--lean:' + o.lean + 'deg;' : '');
      el.innerHTML = '<span class="sp" style="' + artStyle('deco', o.src + '.png', true) + '"></span>';
      shelf.appendChild(el);
    });

    items.forEach(function (it) {
      var L = LAYOUT[it.id];
      if (!L) return;
      var el = document.createElement('button');
      el.type = 'button';
      el.dataset.id = it.id;
      if (L.tag) {
        el.className = 'shelf-tag';
        el.style.left = L.x + 'px';
        el.textContent = it.title;
        el.setAttribute('aria-label', 'Part ' + it.part + ': ' + it.title);
      } else {
        el.className = 'case' + (L.lying ? ' lying' : '');
        el.style.left = L.x + 'px';
        el.style.width = L.w + 'px';
        el.style.height = L.h + 'px';
        el.style.top = (FLOOR - (L.b || 0) - L.h) + 'px';
        if (L.lean) {
          el.style.setProperty('--lean', L.lean + 'deg');
          el.style.setProperty('--ox', L.lean < 0 ? '0%' : '100%');
        }
        el.setAttribute('aria-label', (it.num ? it.num + '. ' : '') + it.title);
        var inner;
        if (it.kind === 'title') {
          inner = '<span class="sp-own"><span class="spine-own"><span class="so-title">WHO GETS TO PLAY?</span><span class="so-author">DI LEO</span></span></span>';
        } else if (L.lying) {
          inner = '<span class="sp" style="width:' + L.h + 'px;height:' + L.w + 'px;left:' + ((L.w - L.h) / 2) + 'px;top:' + ((L.h - L.w) / 2) + 'px;transform:rotate(-90deg);' + spineStyle(it) + '"></span>';
        } else {
          inner = '<span class="sp" style="' + spineStyle(it) + '"></span>';
        }
        el.innerHTML = inner + (it.num ? '<span class="sticker">' + it.num + '</span>' : '');
      }
      shelf.appendChild(el);
      caseEls[it.id] = el;
    });
  }

  var label = $('#hover-label');
  function showLabel(id) {
    var el = caseEls[id];
    if (!el) return;
    var r = oRect(el);
    label.textContent = byId[id].title;
    label.classList.add('on');
    var lh = label.offsetHeight;
    var top = r.y - lh - (el.classList.contains('shelf-tag') ? 24 : 16);
    label.style.left = clamp(r.x + r.w / 2, 190, W - 190) + 'px';
    label.style.top = Math.max(fluid ? 240 : 180, top) + 'px';
  }
  function hideLabel() { label.classList.remove('on'); }

  function select(id) {
    if (selId && caseEls[selId]) caseEls[selId].classList.remove('is-sel');
    selId = id;
    if (id && caseEls[id]) { caseEls[id].classList.add('is-sel'); showLabel(id); } else hideLabel();
  }

  shelf.addEventListener('pointerover', function (e) {
    var el = e.target.closest('.case, .shelf-tag');
    if (el && !popupOpen()) showLabel(el.dataset.id);
  });
  shelf.addEventListener('pointerout', function (e) {
    var el = e.target.closest('.case, .shelf-tag');
    if (el && !el.contains(e.relatedTarget)) { if (selId && !popupOpen()) showLabel(selId); else if (!popupOpen()) hideLabel(); }
  });
  shelf.addEventListener('focusin', function (e) {
    var el = e.target.closest('.case, .shelf-tag');
    if (el && !popupOpen()) select(el.dataset.id);
  });
  shelf.addEventListener('click', function (e) {
    var el = e.target.closest('.case, .shelf-tag');
    if (!el || busy) return;
    openPopup(el.dataset.id);
  });

  /* ---------- pop-up ---------- */
  var popup = $('#popup');
  var popId = null;
  function popupOpen() { return !popup.hidden; }
  function openPopup(id) {
    var it = byId[id], el = caseEls[id];
    if (!it || !el) return;
    if (popupOpen()) closePopup(true);
    popId = id;
    select(id);
    hideLabel();
    el.classList.add('is-pulled');
    $('#pop-num').textContent = it.num ? 'No. ' + it.num : (it.part ? 'Part ' + it.part : '');
    $('#pop-title').textContent = it.title;
    $('#pop-blurb').textContent = it.blurb;
    var sp = WG.spines[id];
    $('#pop-spine').textContent = sp && sp.game ? 'On the spine: ' + sp.game + ' (' + sp.platform + ')' : '';
    $('#pop-spine').hidden = !(sp && sp.game);
    var ol = $('#pop-pages');
    ol.innerHTML = '';
    if (it.pages.length > 1) {
      it.pages.forEach(function (p, j) {
        var li = document.createElement('li');
        li.innerHTML = '<button type="button" data-pi="' + j + '"><span class="pp-n">' + (j + 1) + '</span><span></span></button>';
        li.lastChild.lastChild.textContent = p.label;
        ol.appendChild(li);
      });
      ol.hidden = false;
    } else ol.hidden = true;
    $('#pop-open').innerHTML = (it.kind === 'title' ? 'Title screen' : 'Open') + ' <svg class="ic"><use href="#i-arrow"/></svg>';

    popup.hidden = false;
    if (fluid) { ($('#pop-pages button') || $('#pop-open')).focus({ preventScroll: true }); return; }
    popup.style.visibility = 'hidden';
    var r = oRect(el), pw = popup.offsetWidth, ph = popup.offsetHeight;
    var left = (r.x + r.w / 2 < W / 2 + 40) ? r.x + r.w + 34 : r.x - 34 - pw;
    if (el.classList.contains('lying') || el.classList.contains('shelf-tag')) left = r.x + Math.min(r.w, 260) + 30;
    left = clamp(left, 40, W - pw - 40);
    var top = clamp(r.y - 10, 180, FLOOR - ph - 20);
    if (el.classList.contains('shelf-tag')) top = clamp(FLOOR - ph - 60, 180, 600);
    popup.style.left = left + 'px'; popup.style.top = top + 'px';
    zoomRects(sRect(el), { x: left, y: top, w: pw, h: ph }, { n: 6, dur: 200 }).then(function () {
      if (popId !== id) return;
      popup.style.visibility = '';
      ($('#pop-pages button') || $('#pop-open')).focus({ preventScroll: true });
    });
  }
  function closePopup(quiet) {
    if (popId && caseEls[popId]) caseEls[popId].classList.remove('is-pulled');
    popup.hidden = true;
    var id = popId; popId = null;
    if (!quiet && id && caseEls[id]) caseEls[id].focus({ preventScroll: true });
  }
  $('#pop-open').addEventListener('click', function () { if (popId) openItem(popId, 0); });
  $('#pop-pages').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-pi]');
    if (b && popId) openItem(popId, +b.dataset.pi);
  });
  $('#scr-library').addEventListener('click', function (e) {
    if (e.target.closest('[data-act="pop-close"]')) { closePopup(); return; }
    if (popupOpen() && !e.target.closest('#popup') && !e.target.closest('.case, .shelf-tag')) closePopup(true);
  });

  function openItem(id, pi) {
    var it = byId[id];
    if (it.kind === 'title') { closePopup(true); toTitle(); return; }
    var idx = seqIndex(id, pi);
    if (idx < 0) return;
    enterDeck(idx, caseEls[id]);
  }

  function refreshLibrary() {
    Object.keys(caseEls).forEach(function (id) { caseEls[id].classList.toggle('seen', !!visited[id]); });
    $('#btn-continue .lbl').textContent = pos > 0 ? 'Continue' : 'Start';
  }
  function resumeIndex() {
    if (pos < 1) return 1;
    return Math.min(pos + 1, seq.length - 1);
  }
  // on small screens, scroll the shelf strip so a case is in view
  function revealCase(id) {
    if (!fluid || !caseEls[id]) return;
    var sc = $('.lib-scroll'), r = oRect(caseEls[id]);
    sc.scrollLeft = Math.max(0, (r.x + r.w / 2) * lk - sc.clientWidth / 2);
  }

  $('#btn-continue').addEventListener('click', continueFromLibrary);
  function continueFromLibrary() {
    if (busy) return;
    var idx = resumeIndex(), it = seq[idx].item;
    closePopup(true);
    select(it.id);
    var el = caseEls[it.id];
    if (el) el.classList.add('is-pulled');
    busy = true;
    wait(fxOff() ? 0 : 320).then(function () { busy = false; enterDeck(idx, el); });
  }

  /* ================================================================== SCREENS */
  function show(name) {
    $$('.screen').forEach(function (s) { s.classList.toggle('is-active', s.id === 'scr-' + name); });
    screen = name;
    if (fluid) window.scrollTo(0, 0);
  }

  function enterDeck(idx, fromEl) {
    if (busy) return;
    busy = true;
    var from = fromEl ? sRect(fromEl) : null;
    closePopup(true);
    hideLabel();
    var go = function () {
      $$('.case.is-pulled').forEach(function (c) { c.classList.remove('is-pulled'); });
      select(null);
      show('deck');
      showPage(idx, { dir: 1 });
      busy = false;
    };
    if (from && !fxOff()) zoomRects(from, { x: 24, y: 24, w: W - 48, h: H - 48 }, { n: 8, dur: 300 }).then(go);
    else go();
  }

  function toLibrary() {
    if (busy) return;
    busy = true;
    var cur = seq[pos], el = cur && caseEls[cur.item.id];
    leavePage();
    show('library');
    refreshLibrary();
    var done = function () {
      busy = false;
      if (el) { revealCase(cur.item.id); select(cur.item.id); el.focus({ preventScroll: true }); }
    };
    if (el && !fxOff()) {
      el.style.visibility = 'hidden';
      zoomRects({ x: 24, y: 24, w: W - 48, h: H - 48 }, sRect(el), { n: 8, dur: 300 }).then(function () { el.style.visibility = ''; done(); });
    } else done();
    live('Library');
  }

  /* ---------- title screen and the case flight ---------- */
  var wrap = $('.case3d-wrap'), box = $('#title-case');
  var CASE = { x: 565, y: 34, w: 470, h: 665 };
  var TURN = 'translateZ(-235px) rotateY(90deg)', FLAT = 'translateZ(-30px) rotateY(0deg)';
  function flightTransform() {
    var target = sRect(caseEls.title);
    var k = target.h / CASE.h;
    var dx = (target.x + target.w / 2) - (CASE.x + CASE.w / 2), dy = (target.y + target.h / 2) - (CASE.y + CASE.h / 2);
    return 'translate(' + dx + 'px,' + dy + 'px) scale(' + k + ')';
  }
  function titleUi(on) {
    $$('.title-cta, .cover-band, .cover-title, .cover-sub, .cover-author').forEach(function (e) { e.style.opacity = on ? '' : 0; });
  }

  function startGame() {
    if (busy || screen !== 'title') return;
    busy = true;
    var lib = $('#scr-library');
    refreshLibrary();
    if (fxOff()) { show('library'); busy = false; caseEls.study.focus({ preventScroll: true }); return; }
    $('.title-cta').style.opacity = 0;
    box.style.transition = 'transform .6s cubic-bezier(.5,0,.3,1)';
    box.style.transform = TURN;
    wait(560).then(function () {
      // the library appears underneath while the case flies to its slot
      lib.classList.add('is-active');
      lib.style.opacity = 0;
      caseEls.title.style.visibility = 'hidden';
      return frame();
    }).then(function () {
      var tf = flightTransform();
      lib.style.transition = 'opacity .45s';
      lib.style.opacity = 1;
      wrap.style.transition = 'transform .65s cubic-bezier(.6,0,.25,1)';
      wrap.style.transform = tf;
      return wait(680);
    }).then(function () {
      caseEls.title.style.visibility = '';
      show('library');
      lib.style.transition = lib.style.opacity = '';
      wrap.style.transition = box.style.transition = '';
      wrap.style.transform = '';
      box.style.transform = FLAT;
      $('.title-cta').style.opacity = '';
      busy = false;
      select('title');
      wait(240).then(function () { if (selId === 'title') select(null); });
      live('Library. Pick a case from the shelf.');
    });
  }

  function toTitle() {
    if (busy) return;
    leavePage();
    if (screen === 'deck' || fxOff()) {
      wipe(function () { show('title'); titleUi(true); box.style.transform = FLAT; });
      return;
    }
    busy = true;
    var lib = $('#scr-library'), tit = $('#scr-title');
    titleUi(false);
    box.style.transition = 'none';
    box.style.transform = TURN;
    wrap.style.transition = 'none';
    wrap.style.transform = flightTransform();
    caseEls.title.style.visibility = 'hidden';
    tit.classList.add('is-active');
    frame().then(frame).then(function () {
      wrap.style.transition = 'transform .6s cubic-bezier(.6,0,.25,1)';
      wrap.style.transform = '';
      lib.style.transition = 'opacity .45s';
      lib.style.opacity = 0;
      return wait(620);
    }).then(function () {
      show('title');
      lib.style.transition = lib.style.opacity = '';
      caseEls.title.style.visibility = '';
      box.style.transition = 'transform .55s cubic-bezier(.5,0,.3,1)';
      box.style.transform = FLAT;
      return wait(560);
    }).then(function () {
      box.style.transition = wrap.style.transition = '';
      titleUi(true);
      busy = false;
      $('#btn-start').focus({ preventScroll: true });
    });
  }

  /* typing for the cover title */
  function typeInto(el, text, speed) {
    el.textContent = '';
    if (rm()) { el.textContent = text; return Promise.resolve(); }
    return new Promise(function (resolve) {
      var i = 0;
      (function step() {
        i++;
        el.textContent = text.slice(0, i);
        if (i < text.length) setTimeout(step, speed); else resolve();
      })();
    });
  }

  function intro() {
    var tts = $$('.cover-title .tt'), texts = tts.map(function (t) { return t.textContent; });
    var art = $('.cover-art'), sub = $('.cover-sub'), author = $('.cover-author'), band = $('.cover-band'), cta = $('.title-cta');
    if (rm()) return;
    tts.forEach(function (t) { t.textContent = ''; });
    [art, sub, author, band, cta].forEach(function (e) { e.style.opacity = 0; });
    wrap.animate([
      { translate: '0 -70px', opacity: 0 },
      { translate: '0 8px', opacity: 1, offset: .72 },
      { translate: '0 0', opacity: 1 }
    ], { duration: 720, easing: 'cubic-bezier(.2,.8,.2,1)' });
    wait(380).then(function () {
      band.style.opacity = '';
      return ditherIn(art, 650, 5);
    }).then(function () {
      return typeInto(tts[0], texts[0], 60);
    }).then(function () {
      return typeInto(tts[1], texts[1], 60);
    }).then(function () {
      sub.style.transition = author.style.transition = 'opacity .35s';
      sub.style.opacity = ''; return wait(200);
    }).then(function () {
      author.style.opacity = ''; return wait(260);
    }).then(function () {
      return ditherIn(cta, 380, 3);
    }).then(function () { cta.style.opacity = ''; });
  }

  /* ================================================================== DECK */
  var pagesEl = $('#pages');
  function pageEl(i) { return document.getElementById(seq[i].id); }

  function leavePage() {
    if (pos < 0) return;
    var p = pageEl(pos);
    if (!p) return;
    closeFloats(p);
    var v = $('video', p); if (v) v.pause();
    if (p.id === 'p-part1') stopOpts();
  }

  // entry animation; uses the separate `translate` property, so hover jitter (transform) is untouched
  function enterAnim(p) {
    $$('.in', p).forEach(function (el, k) {
      if (el._in) el._in.cancel();
      if (rm()) return;
      el._in = el.animate([{ opacity: 0, translate: '0 10px' }, { opacity: 1, translate: '0 0' }],
        { duration: 500, delay: 80 + k * 70, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    });
  }

  function showPage(i, opts) {
    opts = opts || {};
    if (i < 1 || i >= seq.length) return;
    if (pos >= 0 && pos !== i) leavePage();
    pos = i;
    var s = seq[i], p = pageEl(i);
    $$('.page.is-current').forEach(function (o) { if (o !== p) o.classList.remove('is-current'); });
    p.classList.add('is-current');
    if (fluid) window.scrollTo(0, 0);
    // steps: forwards resets them, backwards shows everything
    resetSteps(p, opts.dir < 0);
    enterAnim(p);
    visited[s.item.id] = true;
    enterWidgets(p, opts.dir < 0);
    updateHud();
    live(s.item.title + (s.item.pages.length > 1 ? ', part ' + (s.pi + 1) + ' of ' + s.item.pages.length : ''));
  }

  function go(i, dir) {
    if (busy || i < 0 || i >= seq.length || i === pos) return;
    if (i === 0) { toTitle(); return; }
    var sameItem = pos >= 0 && seq[i].item === seq[pos].item;
    if (sameItem || fxOff()) { showPage(i, { dir: dir }); return; }
    busy = true;
    wipe(function () { showPage(i, { dir: dir }); }).then(function () { busy = false; });
  }

  function next() {
    if (screen !== 'deck') return;
    var st = nextStep(pageEl(pos));
    if (st) { doStep(st); return; }
    if (pos < seq.length - 1) go(pos + 1, 1);
  }
  function prev() {
    if (screen !== 'deck') return;
    if (pos > 1) go(pos - 1, -1);
    else toLibrary();
  }

  /* ---------- steps (figures, comments, questions revealed one at a time) ---------- */
  function steps(p) {
    return $$('[data-step]', p).sort(function (a, b) { return (+a.dataset.step) - (+b.dataset.step); });
  }
  function nextStep(p) {
    var all = steps(p);
    for (var i = 0; i < all.length; i++) if (!all[i].classList.contains('is-done')) return all[i];
    return null;
  }
  function resetSteps(p, revealAll) {
    steps(p).forEach(function (el) {
      el.classList.remove('is-done', 'shown', 'typed');
      if (el.classList.contains('dialog')) $('.dlg-text', el).textContent = '';
    });
    closeFloats(p);
    if (p.id === 'p-backlash-2') $('#wall-hint').classList.remove('gone');
    var rd = $('.rando', p); if (rd) resetRando(rd);
    if (revealAll) {
      steps(p).forEach(function (el) {
        if (el.dataset.open) { el.classList.add('is-done'); return; }
        doStep(el, true);
      });
    }
  }
  function doStep(el, instant) {
    if (el.classList.contains('is-done') && !el.classList.contains('game-tab')) {
      if (el.dataset.open) openWin(el.dataset.open, el);
      return;
    }
    el.classList.add('is-done');
    if (el.dataset.open) { openWin(el.dataset.open, el); return; }
    if (el.classList.contains('cmt')) {
      el.classList.add('shown');
      $('#wall-hint').classList.add('gone');
      if (!instant && !rm()) el.animate([{ opacity: 0, translate: '0 14px', scale: '.96' }, { opacity: 1, translate: '0 0', scale: '1' }], { duration: 320, easing: 'steps(4)' });
      return;
    }
    if (el.classList.contains('dialog')) { typeDialog(el, instant); return; }
    if (el.classList.contains('rd-go')) { randomise(el.closest('.win').querySelector('.rando'), instant); return; }
    if (el.classList.contains('game-tab')) { selectGame(+el.dataset.g); return; }
  }

  // clicks on step elements
  pagesEl.addEventListener('click', function (e) {
    var st = e.target.closest('[data-step]');
    if (st && st.tagName === 'A') e.preventDefault();
    if (st && !st.classList.contains('cmt')) {
      if (st.classList.contains('game-tab')) {
        // mark earlier tabs as done too, so the arrow key continues from here
        var n = +st.dataset.step;
        steps(st.closest('.page')).forEach(function (o) { if (o.classList.contains('game-tab') && +o.dataset.step < n) o.classList.add('is-done'); });
      }
      doStep(st);
      return;
    }
    if (e.target.closest('#cmt-wall') || e.target.closest('#wall-hint')) {
      var nx = nextStep(e.target.closest('.page'));
      if (nx) doStep(nx);
    }
    if (e.target.closest('.game-tab') && !e.target.closest('[data-step]')) selectGame(+e.target.closest('.game-tab').dataset.g);
  });

  /* ---------- dialog boxes ---------- */
  function typeDialog(el, instant) {
    var t = el.dataset.text, out = $('.dlg-text', el);
    el.classList.add('shown');
    if (instant || rm()) { out.textContent = t; el.classList.add('typed'); return; }
    typeInto(out, t, 28).then(function () { el.classList.add('typed'); });
  }

  /* ================================================================== WIDGETS */
  function enterWidgets(p, instant) {
    $$('[data-count]', p).forEach(function (el) {
      var to = +el.dataset.count, sep = !!el.dataset.sep;
      var fmt = function (v) { v = Math.round(v); return sep ? v.toLocaleString('en-GB') : String(v); };
      if (instant || rm()) { el.textContent = fmt(to); return; }
      el.textContent = fmt(0);
      animate(1100, function (t) { el.textContent = fmt(to * (1 - Math.pow(1 - t, 3))); });
    });
    if (p.id === 'p-part1') runOpts(instant);
    if (p.id === 'p-part2') room(p, instant);
    if (p.id === 'p-awards-1') growBars(instant);
    if (p.id === 'p-awards-2' && !instant) selectGame(0);
    if (p.id === 'p-mcgag') growDonut(p, instant);
    var v = $('video', p);
    if (v) {
      var toggle = $('.vid-toggle', p);
      try { v.currentTime = 0; } catch (e) { /* not loaded yet */ }
      toggle.classList.remove('paused');
      // a play() that races a recent pause() can be rejected: retry a few times while the page is open
      var tryPlay = function (n) {
        var pr = v.play();
        if (!pr || !pr.catch) return;
        pr.catch(function () {
          if (n > 0 && screen === 'deck' && pageEl(pos) === p) setTimeout(function () { tryPlay(n - 1); }, 250);
          else toggle.classList.add('paused');
        });
      };
      tryPlay(4);
    }
  }

  /* part 1: an accessibility options menu. A cursor walks down the rows and switches each
     option on; every control can also be used by hand. Text size changes the title,
     subtitles turn the question into a subtitle line. */
  var SIZES = [96, 106, 116, 124, 132];
  var optTimers = [];
  var optsEl = $('#opts');
  function setTog(k, on) {
    var row = $('.opt[data-k="' + k + '"]', optsEl), t = $('.tog', row);
    t.setAttribute('aria-checked', on ? 'true' : 'false');
    if (k === 'subs') $('#p-part1 .div-q').classList.toggle('subs', on);
  }
  function setSize(v) {
    v = clamp(v, 1, 5);
    var seg = $('.seg', optsEl);
    seg.setAttribute('aria-valuenow', v);
    $$('i', seg).forEach(function (i) { i.classList.toggle('on', +i.dataset.v <= v); });
    $('#p-part1 .div-title').style.fontSize = SIZES[v - 1] + 'px';
  }
  function setCur(row) { $$('.opt', optsEl).forEach(function (r) { r.classList.toggle('cur', r === row); }); }
  function stopOpts() { optTimers.forEach(clearTimeout); optTimers = []; }
  function runOpts(instant) {
    stopOpts();
    ['subs', 'remap', 'alt', 'hold'].forEach(function (k) { setTog(k, false); });
    setSize(3); setCur(null);
    var rows = $$('.opt', optsEl);
    var finish = function (row) {
      var k = row.dataset.k;
      if (k === 'size') setSize(5); else setTog(k, true);
    };
    if (instant || rm()) { rows.forEach(finish); return; }
    var t = 800;
    rows.forEach(function (row) {
      optTimers.push(setTimeout(function () { setCur(row); }, t));
      if (row.dataset.k === 'size') {
        optTimers.push(setTimeout(function () { setSize(4); }, t + 260));
        optTimers.push(setTimeout(function () { setSize(5); }, t + 520));
        t += 860;
      } else {
        optTimers.push(setTimeout(function () { finish(row); }, t + 280));
        t += 620;
      }
    });
    optTimers.push(setTimeout(function () { setCur(null); }, t + 200));
  }
  optsEl.addEventListener('click', function (e) {
    var tog = e.target.closest('.tog');
    if (tog) { stopOpts(); setCur(tog.closest('.opt')); setTog(tog.closest('.opt').dataset.k, tog.getAttribute('aria-checked') !== 'true'); return; }
    var seg = e.target.closest('.seg');
    if (seg) {
      stopOpts(); setCur(seg.closest('.opt'));
      var i = e.target.closest('.seg i');
      if (i) setSize(+i.dataset.v);
    }
  });
  optsEl.addEventListener('pointerover', function (e) {
    var row = e.target.closest('.opt');
    if (row && !optTimers.length) setCur(row);
  });
  optsEl.addEventListener('pointerleave', function () { if (!optTimers.length) setCur(null); });

  /* part 2: a shelf that makes room for one more */
  var roomBuilt = false;
  function room(p, instant) {
    var box = $('.lobby', p);
    if (!roomBuilt) {
      roomBuilt = true;
      var cols = ['#afa0ba', '#a0b2ba', '#abaeb0', '#c9c2d1', '#8f86a0', '#c5d1d6', '#abaeb0', '#afa0ba', '#a0b2ba', '#d6d0de'];
      var hs = [150, 132, 160, 140, 150, 128, 156, 144, 136, 150];
      var html = '<div class="rs-board"></div><div class="rs-slot"></div>';
      var n = hs.length, start = (378 - n * 30) / 2;
      for (var i = 0; i < n; i++) {
        html += '<div class="rs-sp" data-side="' + (i < n / 2 ? -1 : 1) + '" style="left:' + (start + i * 30) + 'px;height:' + hs[i] + 'px;background:' + cols[i] + '"></div>';
      }
      box.innerHTML = html;
    }
    box.classList.remove('open');
    $$('.rs-sp', box).forEach(function (s) { s.style.transform = ''; });
    var openIt = function () {
      box.classList.add('open');
      $$('.rs-sp', box).forEach(function (s) { s.style.transform = 'translateX(' + (s.dataset.side * 18) + 'px)'; });
    };
    if (instant || rm()) openIt(); else setTimeout(openIt, 900);
  }

  /* awards: bar chart */
  var barsBuilt = false;
  function growBars(instant) {
    var bars = $('#bars');
    if (!barsBuilt) {
      barsBuilt = true;
      var html = '';
      [25, 50, 75, 100].forEach(function (g) { html += '<div class="grid" style="bottom:' + g + '%"><span>' + g + '</span></div>'; });
      WG.awards.forEach(function (a) {
        html += '<div class="bar-g"><div class="bar bar-impl" data-v="' + a.impl + '"><b>' + a.impl.toFixed(1) + '</b></div><div class="bar bar-doc" data-v="' + a.doc + '"><b>' + a.doc.toFixed(1) + '</b></div></div>';
      });
      bars.innerHTML = html;
      var names = document.createElement('div');
      names.className = 'bar-names';
      names.innerHTML = WG.awards.map(function (a) { return '<p>' + a.name + (a.tag ? '<em>' + a.tag + '</em>' : '') + '</p>'; }).join('');
      bars.parentNode.insertBefore(names, bars.nextSibling);
    }
    var bs = $$('.bar', bars);
    bs.forEach(function (b) { b.style.transition = 'none'; b.style.height = '0'; });
    void bars.offsetWidth;
    bs.forEach(function (b, k) {
      b.style.transition = (instant || rm()) ? 'none' : '';
      b.style.transitionDelay = (instant || rm()) ? '' : (300 + k * 70) + 'ms';
      b.style.height = b.dataset.v + '%';
    });
  }

  /* awards: game by game */
  var gamesBuilt = false, gameToken = 0;
  function buildGames() {
    $('#game-list').innerHTML = WG.awards.map(function (a, i) {
      return '<button class="game-tab" type="button" role="tab" data-g="' + i + '"' + (i > 0 ? ' data-step="' + i + '"' : '') + '>' +
        '<span class="gt-name">' + a.name + (a.tag ? '<span class="gt-tag">' + a.tag + '</span>' : '') + '</span>' +
        '<span class="gt-stats">Implemented ' + a.impl.toFixed(1) + '%, documented ' + a.doc.toFixed(1) + '%</span></button>';
    }).join('');
    gamesBuilt = true;
  }
  function selectGame(i) {
    if (!gamesBuilt) buildGames();
    var a = WG.awards[i], img = $('#gv-img');
    $$('.game-tab').forEach(function (t, k) { t.classList.toggle('on', k === i); t.setAttribute('aria-selected', k === i); });
    $('#gv-title').textContent = a.name;
    var src = 'assets/img/' + a.img, token = ++gameToken;
    img.style.opacity = 0;
    var nu = new Image();
    nu.onload = nu.onerror = function () { if (token !== gameToken) return; img.src = src; img.style.opacity = 1; };
    nu.src = src;
    img.alt = 'Heatmap of GAG implementation for ' + a.name + ', by category (motor, cognitive, vision, hearing, speech, general) and level (basic, intermediate, advanced).';
  }

  /* minecraft: donut */
  function growDonut(p, instant) {
    var C = 2 * Math.PI * 44, acc = 0;
    $$('.d-seg', p).forEach(function (c, k) {
      var v = +c.dataset.v / 100 * C;
      c.style.transition = 'none';
      c.style.strokeDasharray = '0 ' + C;
      c.style.strokeDashoffset = -acc;
      void c.getBoundingClientRect();
      c.style.transition = (instant || rm()) ? 'none' : '';
      c.style.transitionDelay = (instant || rm()) ? '' : (250 + k * 180) + 'ms';
      c.style.strokeDasharray = Math.max(0, v - 1.2) + ' ' + C;
      acc += v;
    });
  }

  /* game changer: cluster randomisation */
  function resetRando(rd) {
    var pool = $('.rd-pool', rd);
    if (!pool.children.length) {
      for (var i = 1; i <= 8; i++) pool.insertAdjacentHTML('beforeend', '<div class="rd-cls"><span>' + i + '</span></div>');
      $$('.rd-slots', rd).forEach(function (s) { s.innerHTML = '<i class="rd-slot"></i><i class="rd-slot"></i><i class="rd-slot"></i><i class="rd-slot"></i>'; });
    }
    $$('.rd-cls', rd).forEach(function (c) { c.className = 'rd-cls'; c.style.transform = ''; c.style.transition = ''; pool.appendChild(c); });
    $$('.rd-slots', rd).forEach(function (s) { while (s.children.length < 4) s.insertAdjacentHTML('beforeend', '<i class="rd-slot"></i>'); });
    rd.classList.remove('done');
  }
  function randomise(rd, instant) {
    var cls = $$('.rd-cls', rd);
    var order = cls.map(function (c, i) { return i; });
    for (var i = order.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; }
    var slotsA = $$('.rd-group[data-g="a"] .rd-slot', rd), slotsB = $$('.rd-group[data-g="b"] .rd-slot', rd);
    var moves = order.map(function (ci, k) { return { c: cls[ci], g: k < 4 ? 'a' : 'b', k: k }; });
    // within each group, sort the classes by number so the result reads cleanly
    ['a', 'b'].forEach(function (g) {
      var m = moves.filter(function (x) { return x.g === g; });
      var nums = m.map(function (x) { return x.c; }).sort(function (p, q) { return +p.textContent - +q.textContent; });
      var slots = g === 'a' ? slotsA : slotsB;
      m.forEach(function (x, k) { x.c = nums[k]; x.slot = slots[k]; });
    });
    rd.classList.add('done');
    moves.forEach(function (m) {
      var a = sRect(m.c), b = sRect(m.slot);
      m.c.classList.add(m.g);
      if (instant || rm()) { m.slot.parentNode.replaceChild(m.c, m.slot); return; }
      var dx = b.x - a.x, dy = b.y - a.y;
      setTimeout(function () {
        m.c.style.transition = 'transform .45s cubic-bezier(.5,0,.2,1)';
        m.c.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      }, 120 + m.k * 110);
    });
    if (instant || rm()) return;
    setTimeout(function () {
      moves.forEach(function (m) {
        m.c.style.transition = 'none'; m.c.style.transform = '';
        if (m.slot.parentNode) m.slot.parentNode.replaceChild(m.c, m.slot);
      });
    }, 120 + 8 * 110 + 480);
  }

  /* video toggle */
  $$('.vid-toggle').forEach(function (b) {
    b.addEventListener('click', function () {
      var v = b.parentNode.querySelector('video');
      if (v.paused) { v.play(); b.classList.remove('paused'); } else { v.pause(); b.classList.add('paused'); }
    });
  });

  /* ================================================================== HUD */
  var ms = $('#minishelf'), tip = document.createElement('p');
  tip.className = 'ms-tip'; tip.setAttribute('aria-hidden', 'true');
  function buildMinishelf() {
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ms' + (it.kind === 'label' ? ' lab' : '');
      b.dataset.id = it.id;
      var L = LAYOUT[it.id];
      if (L && !L.tag) b.style.setProperty('--h', Math.round(L.lying ? 24 : L.h / 470 * 32) + 'px');
      b.setAttribute('aria-label', (it.num ? it.num + '. ' : '') + it.title);
      ms.appendChild(b);
    });
    $('#scr-deck').appendChild(tip);
    ms.addEventListener('click', function (e) {
      var b = e.target.closest('.ms'); if (!b) return;
      var idx = seqIndex(b.dataset.id, 0);
      if (idx === 0) toTitle(); else go(idx, idx > pos ? 1 : -1);
    });
    ms.addEventListener('pointerover', function (e) {
      var b = e.target.closest('.ms'); if (!b) return;
      tip.textContent = byId[b.dataset.id].title;
      tip.classList.add('on');
      tip.style.left = Math.max(20, sRect(b).x - 10) + 'px';
    });
    ms.addEventListener('pointerout', function () { tip.classList.remove('on'); });
  }
  function updateHud() {
    var s = seq[pos];
    $$('.ms', ms).forEach(function (b) {
      b.classList.toggle('cur', b.dataset.id === s.item.id);
      b.classList.toggle('seen', !!visited[b.dataset.id]);
    });
    var nb = $('#btn-next'), lbl = $('#next-lbl');
    if (pos >= seq.length - 1) { nb.disabled = true; lbl.textContent = 'Next'; }
    else {
      nb.disabled = false;
      var n = seq[pos + 1];
      lbl.textContent = n.item === s.item ? 'Next' : 'Next: ' + n.item.title;
    }
  }
  $('#btn-next').addEventListener('click', next);
  $('#btn-prev').addEventListener('click', prev);

  /* ================================================================== SETTINGS, FULLSCREEN, BLACKOUT */
  var settings = $('#settings');
  function openSettings() { settings.hidden = false; $('#opt-motion').focus(); }
  function closeSettings() { settings.hidden = true; }
  $('#opt-motion').addEventListener('change', function (e) { prefs.reduceMotion = e.target.checked; savePrefs(); applyPrefs(); });
  function toggleFullscreen() {
    var d = document;
    if (!d.fullscreenElement && !d.webkitFullscreenElement) {
      var el = d.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
    } else (d.exitFullscreen || d.webkitExitFullscreen || function () {}).call(d);
  }
  var blackout = $('#blackout');
  blackout.addEventListener('click', function () { blackout.hidden = true; });

  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act]');
    if (!a) return;
    var act = a.dataset.act;
    if (act === 'library') toLibrary();
    if (act === 'settings') openSettings();
    if (act === 'settings-close') closeSettings();
  });
  $('#btn-start').addEventListener('click', startGame);

  /* ================================================================== KEYBOARD */
  var order = items.map(function (it) { return it.id; });
  function moveSel(d) {
    var i = selId ? order.indexOf(selId) : (d > 0 ? -1 : order.length);
    i = clamp(i + d, 0, order.length - 1);
    if (popupOpen()) closePopup(true);
    select(order[i]);
    revealCase(order[i]);
    caseEls[order[i]].focus({ preventScroll: true });
  }

  // navigation keys pressed during a transition are retried shortly, rather than lost
  var NAV_KEYS = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'PageDown', 'PageUp', ' ', 'Enter', 'Escape', 'm', 'M', 'Home', 'End', 'Backspace'];
  document.addEventListener('keydown', function (e) { onKey(e.key, e, 0); });
  function onKey(k, e, tries) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var act = document.activeElement;
    if (busy && NAV_KEYS.indexOf(k) >= 0) {
      e.preventDefault();
      if (tries < 24) setTimeout(function () { onKey(k, { preventDefault: function () {} }, tries + 1); }, 150);
      return;
    }
    if (!blackout.hidden) { blackout.hidden = true; e.preventDefault(); return; }
    if (!lb.hidden) { if (k === 'Escape' || k === 'Enter' || k === ' ') { closeLightbox(); e.preventDefault(); } return; }
    if (!settings.hidden) { if (k === 'Escape' || k === 's' || k === 'S') { closeSettings(); e.preventDefault(); } return; }
    // the options menu on the Part 1 page: its controls keep their own keys
    if (act && act.closest && act.closest('#opts')) {
      if (k === ' ' || k === 'Enter') { if (act.classList.contains('seg')) e.preventDefault(); return; }
      if (act.classList.contains('seg') && (k === 'ArrowLeft' || k === 'ArrowRight')) {
        e.preventDefault(); stopOpts();
        setSize(+act.getAttribute('aria-valuenow') + (k === 'ArrowRight' ? 1 : -1));
        return;
      }
    }
    if (k === 'f' || k === 'F') { toggleFullscreen(); return; }
    if (k === 'b' || k === 'B') { blackout.hidden = false; return; }
    if (k === 's' || k === 'S') { openSettings(); e.preventDefault(); return; }

    if (screen === 'title') {
      if (k === 'Enter' || k === ' ' || k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); startGame(); }
      return;
    }

    if (screen === 'library') {
      var onButton = act && act.closest && act.closest('#popup button');
      if (k === 'Escape') { if (popupOpen()) closePopup(); else select(null); e.preventDefault(); return; }
      if (k === 'ArrowDown') { e.preventDefault(); moveSel(1); return; }
      if (k === 'ArrowUp') { e.preventDefault(); moveSel(-1); return; }
      if (k === 'Enter') {
        if (onButton) return; // let the focused button handle it
        e.preventDefault();
        if (popupOpen() && popId) openItem(popId, 0);
        else if (selId) openPopup(selId);
        else continueFromLibrary();
        return;
      }
      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') {
        e.preventDefault();
        if (popupOpen() && popId) openItem(popId, 0);
        else if (selId && selId !== 'title') openItem(selId, 0);
        else continueFromLibrary();
        return;
      }
      if (k === 'ArrowLeft' || k === 'PageUp') {
        e.preventDefault();
        if (pos > 0) enterDeck(pos, caseEls[seq[pos].item.id]);
        return;
      }
      if (k === 'Home') toTitle();
      return;
    }

    if (screen === 'deck') {
      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); next(); return; }
      if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); prev(); return; }
      if (k === 'Escape') {
        var open = $$('.page.is-current .win-float').filter(function (w) { return !w.hidden; });
        if (open.length) { open.forEach(function (w) { w.hidden = true; }); return; }
        toLibrary(); return;
      }
      if (k === 'm' || k === 'M') { toLibrary(); return; }
      if (k === 'Home') { toTitle(); return; }
      if (k === 'End') go(seq.length - 1, 1);
    }
  }

  /* ================================================================== BOOT */
  window.addEventListener('resize', fit);
  fit();
  applyPrefs();
  buildShelf();
  buildMinishelf();
  buildGames();
  var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.race([fontsReady, wait(1500)]).then(intro);

})();
