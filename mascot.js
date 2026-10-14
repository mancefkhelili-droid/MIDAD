/* ضياء — Medad's own interactive mascot (a sun by day that turns into a sleepy moon at night (follows the site theme)).
   - floating button that opens the AI assistant (no account menu needed)
   - eyes follow the pointer, blinks, waves on hover, hops on click
   - reacts to the assistant: thinking / happy / sad  (document event "medad-ai-state")
   - speaks AR / FR / EN, rotating short tips; can be silenced for the session */
(function () {
  'use strict';
  var COPY = {
    ar: { name: 'ضياء', aria: 'اسأل ضياء — مساعد مِداد الذكي', close: 'إخفاء',
      tips: ['أهلًا! أنا ضياء 👋 اسألني عن أي وثيقة.', 'جرّب: «اكتب لي طلب إجازة رسمي».', 'أحوّل ملفك إلى مسودة قابلة للتعديل ✨', 'مفتاح API واحد يكفي، وأتولّى الباقي.', 'أكتب بالعربية والفرنسية والإنجليزية.'] },
    fr: { name: 'Diaa', aria: 'Demander à Diaa — assistant IA de Medad', close: 'Masquer',
      tips: ['Salut ! Je suis Diaa 👋 Demandez-moi un document.', 'Essayez : « Rédige une demande de congé ».', 'Je transforme votre fichier en brouillon modifiable ✨', 'Une seule clé API suffit, je m’occupe du reste.', 'J’écris en arabe, français et anglais.'] },
    en: { name: 'Diaa', aria: 'Ask Diaa — Medad AI assistant', close: 'Hide',
      tips: ['Hi! I’m Diaa 👋 Ask me for any document.', 'Try: “Write me a formal leave request”.', 'I turn your file into an editable draft ✨', 'One API key is enough — I handle the rest.', 'I write in Arabic, French and English.'] }
  };
  function lang() { try { var l = localStorage.getItem('medad-lang'); return l === 'fr' || l === 'en' ? l : 'ar'; } catch (e) { return 'ar'; } }

  /* ---------- the character ---------- */
  function rays() {
    var out = '';
    for (var i = 0; i < 12; i++) {
      var a = i * Math.PI / 6, w = 0.2, p = function (r, aa) { return (60 + r * Math.cos(aa)).toFixed(1) + ',' + (68 + r * Math.sin(aa)).toFixed(1); };
      out += '<polygon points="' + p(38, a - w) + ' ' + p(57, a) + ' ' + p(38, a + w) + '"/>';
    }
    return out;
  }
  var RAYS = rays();
  function svg(state) {
    return '<svg class="mascot" data-state="' + (state || 'idle') + '" viewBox="0 0 120 140" aria-hidden="true" focusable="false">' +
      '<ellipse class="m-shadow" cx="60" cy="135" rx="30" ry="4"/>' +
      '<g class="m-body-g"><g class="m-celestial">' +
        '<g class="m-sun"><g class="m-rays">' + RAYS + '</g><circle class="m-sun-disc" cx="60" cy="68" r="37"/><path class="m-shine" d="M36 54C40 44 47 38 55 35"/></g>' +
        '<g class="m-moon"><circle class="m-moon-disc" cx="60" cy="68" r="39"/>' +
          '<circle class="m-crater" cx="38" cy="82" r="6"/><circle class="m-crater" cx="84" cy="88" r="4.5"/><circle class="m-crater" cx="80" cy="52" r="3.2"/>' +
          '<path class="m-shine" d="M34 60C37 50 44 43 52 40"/>' +
          '<path class="m-cap" d="M27 46Q36 6 86 14Q104 24 98 44Q70 34 27 46Z"/><path class="m-cap-band" d="M25 47Q62 33 99 45"/>' +
          '<circle class="m-pom" cx="92" cy="12" r="6.5"/><path class="m-cap-star" d="M56 25l2.2 5.2 5.4.4-4.2 3.5 1.3 5.3-4.7-2.9-4.7 2.9 1.3-5.3-4.2-3.5 5.4-.4Z"/></g>' +
      '</g>' +
      '<g class="m-face">' +
        '<circle class="m-cheek" cx="37" cy="80" r="6"/><circle class="m-cheek" cx="83" cy="80" r="6"/>' +
        '<g class="m-eyes">' +
          '<circle class="m-eye" cx="47" cy="66" r="9"/><circle class="m-eye" cx="73" cy="66" r="9"/>' +
          '<circle class="m-pupil" data-pupil data-cx="47" data-cy="67" cx="47" cy="67" r="4.8"/><circle class="m-pupil" data-pupil data-cx="73" data-cy="67" cx="73" cy="67" r="4.8"/>' +
          '<circle class="m-glint" cx="45" cy="64.5" r="1.5"/><circle class="m-glint" cx="71" cy="64.5" r="1.5"/>' +
          '<rect class="m-lid" x="36" y="55" width="22" height="22" rx="11"/><rect class="m-lid" x="62" y="55" width="22" height="22" rx="11"/>' +
        '</g>' +
        '<g class="m-happy-eyes"><path d="M38 68Q47 58 56 68"/><path d="M64 68Q73 58 82 68"/></g>' +
        '<path class="m-mouth m-mouth-idle" d="M52 85Q60 93 68 85"/>' +
        '<path class="m-mouth m-mouth-happy" d="M48 83Q60 101 72 83Z"/>' +
        '<path class="m-mouth m-mouth-sad" d="M52 91Q60 83 68 91"/>' +
        '<circle class="m-mouth m-mouth-think" cx="60" cy="88" r="3.2"/>' +
        '<path class="m-tear" d="M79 76q-3.5 6-0.5 8.6q3.5-0.5 0.5-8.6Z"/>' +
      '</g></g>' +
      '<g class="m-stars"><path d="M12 36l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z"/><path d="M108 58l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6Z"/><path d="M104 112l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6Z"/><path d="M14 108l1.4 3.4 3.4 1.4-3.4 1.4-1.4 3.4-1.4-3.4-3.4-1.4 3.4-1.4Z"/></g>' +
      '<g class="m-dots"><circle cx="92" cy="26" r="3.4"/><circle cx="102" cy="18" r="3.4"/><circle cx="112" cy="10" r="3.4"/></g>' +
    '</svg>';
  }

  /* ---------- pupils follow the pointer ---------- */
  var px = null, py = null, lookTimer = null, raf = 0;
  function updatePupils() {
    raf = 0;
    var all = document.querySelectorAll('.mascot');
    for (var i = 0; i < all.length; i++) {
      var s = all[i], r = s.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
      var cx = r.left + r.width / 2, cy = r.top + r.height * 0.5;
      var dx = (px == null ? 0 : px - cx), dy = (py == null ? 0 : py - cy);
      var d = Math.sqrt(dx * dx + dy * dy) || 1, k = Math.min(1, d / 160) * 3.6;
      var ox = dx / d * k, oy = dy / d * k;
      var p = s.querySelectorAll('[data-pupil]');
      for (var j = 0; j < p.length; j++) {
        var g = p[j];
        g.setAttribute('cx', (+g.dataset.cx + ox).toFixed(2)); g.setAttribute('cy', (+g.dataset.cy + oy).toFixed(2));
      }
    }
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(updatePupils); }
  function pointer(e) { px = e.clientX; py = e.clientY; clearTimeout(lookTimer); lookTimer = setTimeout(wander, 4500); schedule(); }
  function wander() { // phones have no hover: glance around now and then
    px = Math.random() * innerWidth; py = Math.random() * innerHeight; schedule();
    lookTimer = setTimeout(wander, 2500 + Math.random() * 3500);
  }
  function blinkLoop() {
    var all = document.querySelectorAll('.mascot[data-state="idle"],.mascot[data-state="thinking"]');
    all.forEach(function (s) { s.classList.add('is-blink'); setTimeout(function () { s.classList.remove('is-blink'); }, 150); });
    setTimeout(blinkLoop, 2200 + Math.random() * 3800);
  }

  /* ---------- floating button ---------- */
  var fab, bubble, bubbleText, tipIdx = 0, tipTimer = null, quiet = false, stateTimer = null;
  try { quiet = sessionStorage.getItem('medad-mascot-quiet') === '1'; } catch (e) {}

  function setState(st, ms) {
    clearTimeout(stateTimer);
    document.querySelectorAll('.mascot-fab .mascot').forEach(function (s) { s.dataset.state = st; });
    if (ms) stateTimer = setTimeout(function () { setState('idle'); }, ms);
  }
  function showTip(text, ms) {
    if (!bubble || quiet) return;
    bubbleText.textContent = text; bubble.classList.add('is-on');
    clearTimeout(showTip.t); showTip.t = setTimeout(function () { bubble.classList.remove('is-on'); }, ms || 7000);
  }
  function nextTip() {
    var t = COPY[lang()].tips; showTip(t[tipIdx % t.length]); tipIdx++;
    tipTimer = setTimeout(nextTip, 32000);
  }
  function openChat() {
    bubble.classList.remove('is-on'); fab.classList.add('is-hop'); setTimeout(function () { fab.classList.remove('is-hop'); }, 600);
    if (typeof window.medadOpenAi === 'function') window.medadOpenAi();
    else { var b = document.getElementById('ai-open'); if (b) b.click(); }
  }
  function applyLang() {
    var c = COPY[lang()];
    if (fab) { fab.setAttribute('aria-label', c.aria); fab.setAttribute('title', c.name); }
    var x = bubble && bubble.querySelector('.mascot-bubble-x'); if (x) x.setAttribute('aria-label', c.close);
  }
  function build() {
    if (document.getElementById('mascot-fab')) return;
    fab = document.createElement('div'); fab.className = 'mascot-fab'; fab.id = 'mascot-fab';
    fab.innerHTML = '<div class="mascot-bubble" role="status"><span class="mascot-bubble-text"></span><button type="button" class="mascot-bubble-x" aria-label="×">×</button></div>' +
      '<button type="button" class="mascot-btn">' + svg('idle') + '</button>';
    document.body.appendChild(fab);
    bubble = fab.querySelector('.mascot-bubble'); bubbleText = fab.querySelector('.mascot-bubble-text');
    var btn = fab.querySelector(".mascot-btn");
    btn.addEventListener('click', openChat);
    btn.addEventListener('pointerenter', function () { fab.classList.add('is-wave'); });
    btn.addEventListener('pointerleave', function () { fab.classList.remove('is-wave'); });
    btn.addEventListener('focus', function () { fab.classList.add('is-wave'); });
    btn.addEventListener('blur', function () { fab.classList.remove('is-wave'); });
    bubble.querySelector('.mascot-bubble-x').addEventListener('click', function (e) {
      e.stopPropagation(); quiet = true; bubble.classList.remove('is-on'); clearTimeout(tipTimer);
      try { sessionStorage.setItem('medad-mascot-quiet', '1'); } catch (err) {}
    });
    bubbleText.addEventListener('click', openChat);
    var ai = document.getElementById('ai-dialog');
    if (ai) new MutationObserver(function () { fab.classList.toggle('is-away', ai.open); }).observe(ai, { attributes: true, attributeFilter: ['open'] });
    applyLang();
    if (!quiet) tipTimer = setTimeout(nextTip, 3800);
  }

  document.addEventListener('pointermove', pointer, { passive: true });
  document.addEventListener('pointerdown', pointer, { passive: true });
  document.addEventListener('medad-ai-state', function (e) {
    var st = e.detail;
    if (st === 'thinking') setState('thinking');
    else if (st === 'happy') setState('happy', 3600);
    else if (st === 'sad') setState('sad', 4200);
    else setState('idle');
  });
  document.addEventListener('medad-lang', applyLang);
  new MutationObserver(function () {
    document.querySelectorAll('.mascot').forEach(function (m) { m.classList.add('is-swap'); setTimeout(function () { m.classList.remove('is-swap'); }, 800); });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('storage', function (e) { if (e.key === 'medad-lang') applyLang(); });

  window.MedadMascot = { svg: svg, mini: function (st) { return '<span class="mascot-mini">' + svg(st || 'idle') + '</span>'; }, say: function (t) { showTip(t, 6000); } };
  function start() { build(); lookTimer = setTimeout(wander, 6000); setTimeout(blinkLoop, 2500); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
