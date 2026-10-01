/* ============================================================
   demo.js — 스마트폰 시연판(mobile/) 전용 · app.js 다음에 로드
   원본 app.html은 이 파일을 쓰지 않는다. _mobile.cjs가 시연판에만 넣는다.

   ① 오프라인 캐시(서비스 워커) — https 또는 localhost에서만 등록된다
   ② 상태 바 색 — 어두운 화면(S-12 QR 체크인)이면 theme-color · 위 띠를 어둡게
   ③ 시연 도구 — 「마이」 탭을 0.8초 길게 누르면 열린다(청중에게는 보이지 않는 자리).
      데스크톱용 프로토타입 도구(#tools)의 숨은 버튼을 대신 눌러 준다 — 동작은 app.js 그대로
   ============================================================ */
(function () {
  'use strict';

  /* ① 서비스 워커 */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  var $ = function (s) { return document.querySelector(s); };
  var device = $('#device');

  /* ② 상태 바 색 */
  var meta = document.querySelector('meta[name="theme-color"]');
  var LIGHT = meta ? meta.getAttribute('content') : '';
  function syncBar() {
    var a = document.querySelector('.screen.is-active');
    var dark = !!(a && a.classList.contains('screen--scan'));
    if (device) device.classList.toggle('is-dark', dark);
    if (meta) meta.setAttribute('content', dark ? '#0B0E13' : LIGHT);
  }
  new MutationObserver(syncBar).observe(document.getElementById('viewport'), { subtree: true, attributes: true, attributeFilter: ['class'] });
  syncBar();

  /* ③ 시연 도구 */
  var GROUPS = [
    { k: '홈 상태', tool: 'home', items: [['live', '이용 중'], ['soon', '입실 대기'], ['none', '예약 없음']] },
    { k: 'QR 인식 결과', tool: 'reader', items: [['success', '인식 성공'], ['fail', '읽을 수 없음'], ['early', '시간 아님']] },
    { k: '기기', tool: 'dev', items: [['ok', '정상'], ['partial', '일부 오프라인']] }
  ];
  var layer = document.createElement('div');
  layer.className = 'demo';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-label', '시연 도구');
  function chips(g) {
    return g.items.map(function (it) {
      var src = document.querySelector('.tools__b[data-tool="' + g.tool + '"][data-val="' + it[0] + '"]');
      var on = src && src.classList.contains('is-on');
      return '<button type="button" class="chip' + (on ? ' is-selected' : '') + '" data-demo-tool="' + g.tool + '" data-demo-val="' + it[0] + '">' + it[1] + '</button>';
    }).join('');
  }
  function render() {
    layer.innerHTML =
      '<div class="demo__scrim" data-demo-close></div>' +
      '<div class="demo__panel">' +
        '<div class="demo__head"><h2 class="demo__title">시연 도구</h2>' +
          '<button type="button" class="iconbtn" data-demo-close aria-label="닫기"><svg class="icon"><use href="#i-close"/></svg></button></div>' +
        GROUPS.map(function (g) { return '<div class="demo__g"><span class="demo__k">' + g.k + '</span><div class="demo__row">' + chips(g) + '</div></div>'; }).join('') +
        '<div class="demo__g"><span class="demo__k">회사 가입 연출</span><div class="demo__row">' +
          '<button type="button" class="chip" data-demo-click="#demoReset">회사코드 1111 다시 연출</button></div></div>' +
        '<div class="demo__g"><span class="demo__k">처음 상태로</span>' +
          '<button type="button" class="demo__danger" data-demo-wipe>로그아웃하고 가입 · 예약 기록 지우기</button></div>' +
      '</div>';
  }
  if (device) device.appendChild(layer);
  function open() { render(); layer.classList.add('is-open'); }
  function close() { layer.classList.remove('is-open'); }

  layer.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest('[data-demo-close]')) { close(); return; }
    var tb = t.closest('[data-demo-tool]');
    if (tb) {
      var src = document.querySelector('.tools__b[data-tool="' + tb.getAttribute('data-demo-tool') + '"][data-val="' + tb.getAttribute('data-demo-val') + '"]');
      close(); if (src) src.click();
      return;
    }
    var cb = t.closest('[data-demo-click]');
    if (cb) { var b = document.querySelector(cb.getAttribute('data-demo-click')); close(); if (b) b.click(); return; }
    if (t.closest('[data-demo-wipe]')) {
      try { Object.keys(localStorage).filter(function (k) { return k.indexOf('spacekey.') === 0; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (err) {}
      history.replaceState(null, '', location.pathname + '#S-01');   /* 다시 열면 스플래시 → 로그인 */
      location.reload();
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && layer.classList.contains('is-open')) close(); });

  /* 「마이」 탭 길게 누르기 → 시연 도구. 손을 떼면 오는 click은 삼켜 탭 이동이 일어나지 않게 */
  var timer = null, fired = false, sx = 0, sy = 0;
  var my = function () { return document.querySelector('.tabbar__item[data-tab="S-18"]'); };
  document.addEventListener('pointerdown', function (e) {
    var b = my(); if (!b || !b.contains(e.target)) return;
    fired = false; sx = e.clientX; sy = e.clientY;
    clearTimeout(timer);
    timer = setTimeout(function () { fired = true; if (navigator.vibrate) navigator.vibrate(15); open(); }, 800);
  }, true);
  ['pointerup', 'pointercancel'].forEach(function (n) { document.addEventListener(n, function () { clearTimeout(timer); }, true); });
  document.addEventListener('pointermove', function (e) { if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 12) clearTimeout(timer); }, true);
  document.addEventListener('click', function (e) {
    var b = my(); if (fired && b && b.contains(e.target)) { e.stopPropagation(); e.preventDefault(); fired = false; }
  }, true);
  document.addEventListener('contextmenu', function (e) { var b = my(); if (b && b.contains(e.target)) e.preventDefault(); }, true);

  /* 주소에 ?demo=1 을 붙이면 바로 열린다(데스크톱 확인용) */
  if (/[?&]demo=1/.test(location.search)) setTimeout(open, 600);
})();
