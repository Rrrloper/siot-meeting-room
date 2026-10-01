/* ============================================================
   app.js — 화면 전환 · 상태 관리 · 렌더링
   SIOT 신설 「회의실 예약 솔루션」의 전용 사용자 앱.
   ------------------------------------------------------------
   ES 모듈 아님. file:// 로 열어도 동작한다.
   모든 데이터는 window.MOCK 하나에서만 읽는다.

   확정된 구조
     · 하단 탭 4개 — 홈 · 탐색 · 내 예약 · 마이.
     · 홈은 시안 3a — 날짜 헤더 → 오늘 예약 가로 캐러셀 → 즐겨찾기 →
       최근 사용 → 전체 회의실. 행을 누르면 그 자리에서 펼쳐져 예약한다.
       (초기 기획의 「끌어서 예약하는 하루 일정 타임라인」은 폐기했다. 되살리지 말 것)
     · 기기 C안 — 제어 페이지의 기기는 SIOT 디바이스 카드 규격.
       자주 만지는 조명·냉난방은 가로 전체, 나머지는 2열.

   반드시 지키는 동작 규칙
     1 낙관적 UI 금지 — 기기 응답 전에 값을 바꾸지 않는다 (sendCommand)
     2 정책이 화면을 만든다 — 최대 사용시간·리드타임·수용인원이 선택을 막는다
     3 제어 권한은 예약·체크인 상태에 묶인다
     4 체크인은 문 앞 예약 현황판의 QR을 앱이 읽는다(2026-09-22 · 65차 명칭). 코드 6자리 입력이 대체 경로
     5 닫기는 X 하나. 하단 버튼은 항상 실행용
   ============================================================ */

(function () {
  'use strict';

  var M = window.MOCK, F = M.fn;
  var A = window.ACCOUNTS;              /* 계정 저장소 — 관리자 웹과 공유한다 */

  var $  = function (s, r) { return (r || document).querySelector(s); };
  M.fn.autoEnter();   /* 자유 이용 방 — 시작 시각이 지난 예약은 자동 입실 (2026-09-22 ⓐ) */
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function icon(n, cls) {
    return '<svg class="icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + n + '"/></svg>';
  }

  /* index.html 미리보기(iframe)는 ?still=1 로 연다 — 자동 전환·카운트다운 정지 */
  var STILL = /[?&]still=1/.test(location.search);
  /* ?home=live|soon|none 으로 홈 상태를 지정해 열 수 있다 (미리보기용) */
  var PRESET_HOME = (location.search.match(/[?&]home=(live|soon|none)/) || [])[1] || null;
  /* 스마트폰 시연판(mobile/ · _mobile.cjs)은 window.SIOT_DEMO = true — 처음 여는 폰은 데모 계정으로
     저절로 들어가지 않고 로그인부터, 스플래시 뒤에는 로그인돼 있으면 홈으로 (2026-10-01 · 79차) */
  var DEMO = !!window.SIOT_DEMO;


  /* ============================================================
     라우터 — data-screen 표시/숨김 · 해시 진입 · 뒤로가기
     ============================================================ */

  var ROOT = 'S-05';
  var TABS = ['S-05', 'S-06', 'S-16', 'S-18'];
  var ANIM_MS = 240;
  var stack = [ROOT];
  var AUTH = ['S-01', 'S-02', 'S-26'];   /* 로그인 없이 보는 화면 (72차) */
  var animating = false;

  function screenEl(id) { return document.querySelector('[data-screen="' + id + '"]'); }
  function known(id) { return !!screenEl(id); }

  function transition(from, to, dir) {
    to.classList.add('is-active');
    if (!from || from === to || dir === 'none') {
      if (from && from !== to) from.classList.remove('is-active');
      return;
    }
    animating = true;
    var inA = dir === 'push' ? 'anim-push-in' : 'anim-pop-in';
    var outA = dir === 'push' ? 'anim-push-out' : 'anim-pop-out';
    from.classList.remove('is-active');
    from.classList.add('is-leaving', outA);
    to.classList.add(inA);
    setTimeout(function () {
      to.classList.remove(inA);
      from.classList.remove('is-leaving', outA);
      animating = false;
    }, ANIM_MS);
  }

  var RENDER = {
    'S-05': renderHome,
    'S-06': renderFind,
    'S-16': renderMine,
    'S-14': renderControl,
    'S-12': renderScan,
    'S-14b': renderLog,
    'S-15': renderRsv,
    'S-24': renderSearch,
    'S-18': renderMy,
    'S-20': renderNotifySet,
    'S-21': renderNotify,
    'S-02': renderLogin,
    'S-04': renderPerm,
    'S-25': renderJoinCode,
    'S-26': renderJoinForm,
    'S-28': renderPwChange
  };

  function paint(id) {
    if (RENDER[id]) RENDER[id]();
    applyTools();

    /* 스플래시 — 1.2초 뒤 자동으로 로그인. 시연판은 로그인돼 있으면 홈으로 · 스플래시는 기록에 남기지 않는다 */
    if (id === 'S-01' && !STILL) {
      setTimeout(function () {
        if (stack[stack.length - 1] !== 'S-01') return;
        if (DEMO) {
          var nx = user ? ROOT : 'S-02';
          apply([nx], 'none');
          history.replaceState({ stack: [nx] }, '', '#' + nx);
          return;
        }
        apply(['S-02'], 'push');
        history.pushState({ stack: stack.slice() }, '', '#S-02');
      }, 1200);
    }
    /* QR 유효시간은 제어 페이지를 떠나면 멈춘다 */
    if (id !== 'S-14') clearInterval(qrTimer);

    /* 탭바는 탭 화면에서만. 밀려 올라온 화면은 고정 CTA가 하단을 쓴다 */
    $('#tabbar').hidden = TABS.indexOf(id) === -1;
    var sc = $('#tabbar .tabbar__scan'); if (sc) sc.hidden = !hasCo() || !F.anyQrSpace();   /* 업장에 QR 방이 없으면 버튼도 없다 · 회사가 없어도 (72차) */
    $$('.tabbar__item').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-tab') === id);
    });
  }

  /** 탭 전환 — 형제 화면이라 슬라이드하지 않는다 */
  function goTab(id) {
    if (animating) return;
    if (stack[stack.length - 1] === id) {
      var b = screenEl(id).querySelector('.screen__body');
      if (b) b.scrollTop = 0;
      return;
    }
    closeSheet();
    apply([id], 'none');
    history.pushState({ stack: [id] }, '', '#' + id);
  }

  function apply(next, dir) {
    var from = document.querySelector('.screen.is-active');
    var id = next[next.length - 1];
    stack = next;
    paint(id);
    transition(from, screenEl(id), dir);
  }

  function push(id) {
    if (animating || !known(id)) return false;
    closeSheet();
    apply(stack.concat([id]), 'push');
    history.pushState({ stack: stack.slice() }, '', '#' + id);
    return true;
  }

  function back() {
    if (animating) return;
    if (isSheetOpen()) { closeSheet(); return; }
    if (!user && stack.length < 2) return;   /* 로그아웃 상태의 로그인 화면 — 뒤로 갈 곳이 없다 (72차) */
    if (stack[stack.length - 1] === 'S-04') { leavePerm(); return; }
    if (stack.length > 1) history.back();
    else { apply([ROOT], 'pop'); history.replaceState({ stack: [ROOT] }, '', '#' + ROOT); }
  }

  function goRoot() {
    if (animating) return;
    closeSheet();
    apply([ROOT], 'none');
    history.pushState({ stack: [ROOT] }, '', '#' + ROOT);
  }

  /** 해시로 직접 들어온 경우의 스택 — 탭이면 그것 하나, 아니면 홈 위에 얹는다 */
  function stackFromHash() {
    var h = (location.hash || '').replace('#', '');
    if (!known(h)) return [ROOT];
    return TABS.indexOf(h) !== -1 ? [h] : [ROOT, h];
  }

  document.addEventListener('input', function (e) {
    var inp = e.target.closest && e.target.closest('#scanInput');
    if (!inp) return;
    scanCode = inp.value.replace(/\D/g, '').slice(0, 6);
    inp.value = scanCode;
    $$('.codebox i').forEach(function (b, i) { b.textContent = scanCode[i] || ''; b.classList.toggle('is-on', i === scanCode.length); });
    if (scanCode.length === 6) scanSubmit('code');
  });

  window.addEventListener('popstate', function (e) {
    /* 주소창이나 스크립트가 해시만 바꾸면 state가 비어 있다 — 그때는 해시를 읽는다 */
    var next = (e.state && e.state.stack) || stackFromHash();
    if (!user && AUTH.indexOf(next[next.length - 1]) === -1) { next = ['S-02']; history.replaceState({ stack: next }, '', '#S-02'); }   /* 로그아웃 뒤 ‹ 로 홈에 돌아가지 않게 (72차) */
    /* 로그인한 뒤 ‹ 로 로그인 · 가입 화면에 돌아가지 않게 — 권한 안내를 나간 것으로 본다 (72차) */
    if (user && !STILL && (next[next.length - 1] === 'S-02' || next[next.length - 1] === 'S-26' || next[next.length - 1] === 'S-04')) {
      closeSheet(); history.replaceState({ stack: [ROOT] }, '', '#' + ROOT); stack = [ROOT]; leavePerm(); return;
    }
    var dir = next.length < stack.length ? 'pop' : 'push';
    closeSheet();
    apply(next, dir);
  });

  function notReady(name) { toast(name + ' 화면은 이 시안에 없어요'); }


  /* ============================================================
     바텀시트 — 우상단 X · 스크림 · ESC · 드래그 다운
     ============================================================ */

  var sheetOnClose = null;

  function isSheetOpen() { return $('#sheetLayer').classList.contains('is-open'); }

  function openSheet(o) {
    var layer = $('#sheetLayer'), sheet = $('#sheet');
    $('#sheetTitle').innerHTML = o.title || '';
    sheet.classList.toggle('sheet--tall', !!o.tall);

    /* 본문 노드를 매번 갈아 끼운다 — 안 그러면 리스너가 쌓인다 */
    var old = $('#sheetBody');
    var body = old.cloneNode(false);
    body.innerHTML = o.body || '';
    old.parentNode.replaceChild(body, old);

    var cta = $('#sheetCta');
    if (o.cta) {
      cta.hidden = false;
      cta.innerHTML = '<button class="btn btn--' + (o.cta.kind || 'primary') +
        '" id="sheetCtaBtn">' + esc(o.cta.label) + '</button>';
      $('#sheetCtaBtn').onclick = function () {
        if (this.classList.contains('is-disabled')) return;
        closeSheet();
        if (o.cta.onClick) o.cta.onClick();
      };
    } else { cta.hidden = true; cta.innerHTML = ''; }

    sheetOnClose = o.onClose || null;
    layer.classList.add('is-open');
    sheet.style.transform = '';
    requestAnimationFrame(function () { layer.classList.add('is-in'); });
    if (o.onMount) o.onMount(body);
  }

  function closeSheet() {
    var layer = $('#sheetLayer');
    if (!layer.classList.contains('is-open')) return;
    layer.classList.remove('is-in');
    var fn = sheetOnClose; sheetOnClose = null;
    setTimeout(function () { layer.classList.remove('is-open'); }, 280);
    if (fn) fn();
  }

  function wireSheetDrag() {
    var sheet = $('#sheet'), handle = $('#sheetHandle');
    var y0 = null;
    handle.style.touchAction = 'none';
    handle.addEventListener('pointerdown', function (e) {
      y0 = e.clientY;
      handle.setPointerCapture && handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', function (e) {
      if (y0 === null) return;
      var d = Math.max(0, e.clientY - y0);
      sheet.style.transition = 'none';
      sheet.style.transform = 'translateY(' + d + 'px)';
    });
    function end(e) {
      if (y0 === null) return;
      var d = Math.max(0, (e.clientY || 0) - y0);
      y0 = null;
      sheet.style.transition = '';
      sheet.style.transform = '';
      if (d > 90) closeSheet();
    }
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (isSheetOpen()) closeSheet(); else back(); }
    });
  }


  /* ── 토스트 ─────────────────────────────────────────────── */

  var toastTimer = null;
  function toast(msg, opt) {
    opt = opt || {};
    var el = $('#toast'), act = $('#toastAction');
    $('#toastText').textContent = msg;
    if (opt.action) {
      act.hidden = false;
      act.textContent = opt.action;
      act.onclick = function () { el.classList.remove('is-on'); if (opt.onAction) opt.onAction(); };
    } else { act.hidden = true; act.onclick = null; }
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-on'); }, 3000);
  }


  /* ============================================================
     공통 조각
     ============================================================ */

  /* 「N분 뒤 시작해요」를 보여 주는 범위 — 안내만 한다. 입실 · 제어는 시작 시각부터 (2026-09-28 54차) */
  var SOON_MIN = 10;

  function statusLine(r) {
    var st = M.statusText[r.status];
    if (!st) return '';
    var text = st.text;
    if (r.status === 'CHECKED_IN') text += ' · ' + F.remainingMin(r.id) + '분 남음';
    else if (r.status === 'APPROVED') {
      var d = F.diffMin(M.NOW, r.start);
      /* 상태는 명사형 한 벌 — 사용 중 · 예약 확정 · 입실 대기 · 예약 종료 · 취소됨 (2026-09-29 65차) */
      if (d > 0 && d <= SOON_MIN) text = d + '분 뒤 시작';
      else if (d <= 0 && M.NOW < r.end) text = '입실 대기';
      /* 카드에 이미 날짜·시간이 있다 — 상태 줄은 상태만 (2026-09-23) */
    }
    var tone = { brand: 'brand', warn: 'warn', danger: 'danger', muted: 'muted', dim: 'dim' }[st.tone] || 'muted';
    if (r.status === 'APPROVED' && F.canIssueCheckinCode(r)) tone = 'warn';
    return '<span class="status status--' + tone + '">' + esc(text) + '</span>';
  }

  function availLine(spaceId) {
    var st = F.getSpaceStatus(spaceId);
    if (!st) return '';
    var t = M.availabilityText[st.key];
    if (!t) return '';
    var text = st.key === 'IN_USE' ? (st.until ? F.hm(st.until) + t.text : '사용 중') : t.text;
    var tone = { ok: 'ok', muted: 'muted', warn: 'warn', dim: 'dim' }[t.tone] || 'muted';
    return '<span class="status status--' + tone + '">' + esc(text) + '</span>';
  }

  /* 예약 카드 — 홈 캐러셀과 목록이 함께 쓴다 */
  function rsvCardHtml(r, opt) {
    opt = opt || {};
    var live = r.status === 'CHECKED_IN';
    var soon = r.status === 'APPROVED' && F.canIssueCheckinCode(r);
    var cls = 'rsvcard';
    if (live || soon) cls += ' rsvcard--live';
    if (opt.fresh) cls += ' rsvcard--new';
    if (['USED', 'CANCELED'].indexOf(r.status) !== -1) cls += ' rsvcard--past';

    var pct = 0;
    if (live) {
      var total = F.diffMin(r.start, r.end);
      pct = Math.min(100, Math.max(0, Math.round(F.diffMin(r.start, M.NOW) / total * 100)));
    }

    /* 버튼 이름은 홈 오늘 카드와 같게 — 「기기 제어」 · 「체크인」 (65차) */
    var go = '';
    if (live) go = '기기 제어';
    else if (soon) go = '체크인';

    /* 시각은 오른쪽 위에 한 번만 — 진행 바 아래 시작 · 종료 시각은 두지 않는다 (65차) */
    return '<button class="' + cls + '" data-rsv="' + esc(r.id) + '">' +
      '<span class="rsvcard__top">' +
        (opt.fresh ? '<span class="status status--ok">방금 예약했어요</span>' : statusLine(r)) +
        '<span class="rsvcard__when tnum">' + esc(F.rangeLabel(r.start, r.end)) + '</span>' +
      '</span>' +
      '<span class="rsvcard__name">' + esc(F.spaceName(r.spaceId)) + '</span>' +
      '<span class="rsvcard__meta">' + esc(F.spaceMeta(r.spaceId)) + '</span>' +
      (live ? '<span class="elapsed"><i style="width:' + pct + '%"></i></span>' : '') +
      (go ? '<span class="rsvcard__go">' + esc(go) + icon('next') + '</span>' : '') +
    '</button>';
  }




  /* ============================================================
     시간 헬퍼 — 09:00~19:00. 예약 단위는 기본 설정(1시간) + 회의실별(1시간 · 30분) (2026-09-28 57차)
     ============================================================ */

  var OPEN_MIN = 9 * 60, CLOSE_MIN = 19 * 60, SPAN = CLOSE_MIN - OPEN_MIN;
  var STEP = M.SLOT_MIN;                    /* 기본 예약 단위(관리자 web 설정) — 탐색의 처음 시간 · 퀵버튼 */
  /* 탐색 시각 시트는 가장 잘게 쪼개는 방의 단위로 — 30분 방이 있으면 :30도 고를 수 있고,
     1시간 방은 정시가 아닌 시간에 결과에서 빠진다(isFree가 칸을 맞추지 못한다) */
  var FIND_STEP = M.spaces.reduce(function (m, s) { return Math.min(m, F.slotMinOf(s.id)); }, STEP);

  function minOf(d) { return d.getHours() * 60 + d.getMinutes(); }
  function pctOf(d) { return (minOf(d) - OPEN_MIN) / SPAN * 100; }
  function atMin(day, m) {
    var d = F.startOfDay(day); d.setHours(Math.floor(m / 60), m % 60, 0, 0); return d;
  }
  /** NOW 다음 단위 경계 — 1시간이면 다음 정시, 30분이면 다음 :00/:30 */
  function nextSlot(step) {
    step = step || STEP;
    var m = Math.ceil((minOf(M.NOW) + 1) / step) * step;
    return atMin(M.NOW, Math.min(Math.max(m, OPEN_MIN), CLOSE_MIN - step));
  }
  function hm(d) { return F.hm(d); }

  /** 단위 간격 시각 목록 */
  function slotTimes(from, to, step) {
    var out = [];
    for (var m = from; m <= to; m += (step || STEP)) out.push(m);
    return out;
  }

  /** 그 공간이 [s,e) 구간을 통째로 비워 두고 있는가 */
  function isFree(spaceId, s, e) {
    var slots = F.getAvailableSlots(spaceId, s);
    if (!slots.length) return false;
    var need = [], ok = true;
    slots.forEach(function (sl) {
      if (sl.start >= s && sl.end <= e) need.push(sl);
    });
    if (!need.length) return false;
    /* 구간이 운영시간 안에 온전히 들어오는지 */
    if (F.diffMin(need[0].start, need[need.length - 1].end) !== F.diffMin(s, e)) return false;
    need.forEach(function (sl) { if (sl.state !== 'AVAILABLE') ok = false; });
    return ok;
  }


  /* ============================================================
     S-05 홈 — 1b. 인디고 헤더에 오늘 일정, 아래 빈 공간 리스트
     행을 누르면 그 자리에서 펼쳐져 예약한다 (사유 입력 없음)
     ============================================================ */

  /* 펼친 행의 상태 — 공간 하나만 열린다 */
  var open = { spaceId: null, a: null, b: null, slots: [], people: 1 };

  function closeRow() { open = { spaceId: null, a: null, b: null, slots: [], people: 1 }; }

  /* ── 홈 조각들 — 2026-09-09 「APP 홈화면 주황 시안」 ──────────── */

  /** 오늘 내 예약. 시작 순 */
  function todayMine() {
    return M.reservations.filter(function (r) {
      return r.userId === M.me.id && F.sameDay(r.start, M.NOW) &&
        ['APPROVED', 'CHECKED_IN', 'USED'].indexOf(r.status) !== -1;
    }).sort(function (a, b) { return a.start - b.start; });
  }

  /** 남은 시간을 사람이 읽는 말로 — 「42분 뒤 시작」 「3시간 12분 뒤」 (65차 · 「후」 → 「뒤」 통일) */
  function untilLabel(min) {
    if (min < 60) return min + '분 뒤';
    return Math.floor(min / 60) + '시간 ' + (min % 60) + '분 뒤';
  }

  /** 오늘 예약 카드 한 장 */
  function todayCardHtml(r, i, total, focus) {
    var sp = F.getSpace(r.spaceId);
    var span = F.diffMin(r.start, r.end);
    var live = r.status === 'CHECKED_IN';
    var done = r.status === 'USED';
    var pct = done ? 100 : live
      ? Math.min(100, Math.max(0, Math.round(F.diffMin(r.start, M.NOW) / span * 100))) : 0;

    /* 시작했는데 아직 인증 전(QR · 리더기 방) — 「-18분 후 시작」이 아니라 입실 대기 (2026-09-28 54차) */
    var started = !live && !done && r.start <= M.NOW;
    /* 상태 이름은 내 예약 · 상세 · 제어와 같은 한 벌 — 사용 중 · 예약 확정 · 입실 대기 · 예약 종료 (65차) */
    var kick = done ? '예약 종료' : live ? '사용 중' : started ? '입실 대기' : '예약 확정';
    var right = done ? '종료'
      : live ? F.remainingMin(r.id) + '분 남음'
      : started ? F.diffMin(M.NOW, r.end) + '분 남음'
      : untilLabel(F.diffMin(M.NOW, r.start)) + (i === focus ? ' 시작' : '');

    /* 메타 줄 = 시간 + 「인원 · 층 · 유형」(spaceMeta) — 모든 화면 같은 순서 (65차) */
    var meta = F.rangeLabel(r.start, r.end) + ' · ' + F.spaceMeta(r.spaceId);

    var btns = '';
    /* 사용 중이면 어느 카드든 「기기 제어 · 30분 연장」 — 인증 없는 방 자동 입실로 사용 중이 둘 이상일 수 있다 (2026-09-23).
       뒤 30분에 예약이 있으면 연장은 흐리게 두고, 누르면 이유를 말한다 (57차).
       체크인도 같은 방식 — 입실 시각 전에는 흐리게, 누르면 「17:00부터 입실할 수 있어요」 (65차) */
    if ((live || i === focus) && !done) {
      btns = '<span class="tcard__btns">' +
        (live
          ? '<span class="tcard__b tcard__b--fill" data-hgo="ctl">기기 제어</span>' +
            '<span class="tcard__b tcard__b--ghost' + (F.extendCheck(r.id).ok ? '' : ' is-blocked') + '" data-hgo="extend">30분 연장</span>'
          : (F.isFreeSpace(r.spaceId) || F.isReaderSpace(r.spaceId))
            ? '<span class="tcard__b tcard__b--ghost" data-hgo="edit">예약 상세</span>'
            : '<span class="tcard__b tcard__b--fill' + (F.canIssueCheckinCode(r) ? '' : ' is-blocked') + '" data-hgo="ctl">체크인</span>' +
              '<span class="tcard__b tcard__b--ghost" data-hgo="edit">예약 상세</span>') +
      '</span>';
    }

    return '<button class="tcard' + (i === focus ? ' tcard--now' : '') +
      (done ? ' is-done' : '') + '" data-hcard="' + esc(r.id) + '">' +
      '<span class="tcard__k">' +
        (i === focus
          ? '<span class="tcard__pill">오늘 ' + (i + 1) + ' / ' + total + ' · ' + kick + '</span>'
          : '<span>오늘 ' + (i + 1) + ' / ' + total + ' · ' + kick + '</span>') +
        '<span class="tcard__kr">' + esc(right) + '</span></span>' +
      '<span class="tcard__n">' + esc(sp.name) + '</span>' +
      '<span class="tcard__m">' + esc(meta) + '</span>' +
      '<span class="tcard__bar"><i style="width:' + pct + '%"></i></span>' +
      btns +
    '</button>';
  }

  /** 오늘 예약 캐러셀 — 「지금 주목할 것」 하나만 주황 */
  function todayCarHtml() {
    var all = todayMine();
    /* 끝난 예약은 캐러셀에서 뺀다 — 문 앞에서 여는 화면의 첫 장은 지금·다음 할 일 (2026-09-23) */
    var list = all.filter(function (r) { return r.status !== 'USED' && r.status !== 'CANCELED'; });
    if (!list.length) list = all.slice(-1);
    if (!list.length) return '';

    var focus = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].status === 'CHECKED_IN') { focus = i; break; }
    }
    if (focus < 0) {
      for (var j = 0; j < list.length; j++) {
        if (list[j].status === 'APPROVED') { focus = j; break; }
      }
    }
    if (focus < 0) focus = list.length - 1;

    var cards = list.map(function (r, k) {
      return todayCardHtml(r, k, list.length, focus);
    }).join('');

    var dots = list.length > 1
      ? '<div class="tdots">' + list.map(function (_, k) {
          return '<span class="' + (k === focus ? 'is-on' : '') + '"></span>';
        }).join('') + '</div>'
      : '';

    return '<div class="tcar"><div class="tcar__t' + (list.length === 1 ? ' is-one' : '') +
      '" data-hfocus="' + focus + '">' + cards + '</div>' + dots + '</div>';
  }

  /** 포커스 카드를 가운데로 — 좌우 이웃이 살짝 보여야 「넘겨 볼 수 있다」가 읽힌다.
      scroll-snap 컨테이너는 새로 그린 직후 스스로 한 번 스냅한다. 그 뒤에 자리를
      잡아야 되돌려지지 않으므로 프레임을 두 번 넘기고, 그래도 0이면 한 번 더 민다.
      이미 사용자가 넘긴 뒤라면(scrollLeft > 0) 건드리지 않는다 */
  function centerTodayCard() {
    var tr = $('#homeBody .tcar__t');
    if (!tr || tr.classList.contains('is-one')) return;
    var f = tr.children[+tr.getAttribute('data-hfocus') || 0];
    if (!f) return;

    function put() {
      if (tr.scrollLeft > 4) return;                  /* 사용자가 이미 넘겼다 */
      var a = tr.getBoundingClientRect(), b = f.getBoundingClientRect();
      var d = (b.left - a.left) - (a.width - b.width) / 2;
      if (d > 1) tr.scrollLeft += d;
    }
    requestAnimationFrame(function () { requestAnimationFrame(put); });
    setTimeout(put, 140);
  }

  /** 즐겨찾기 별 — 카드 우측 상단. 담겨 있으면 채운 ★, 아니면 빈 ☆.
      카드 자체가 <button>이라 별은 span으로 얹는다 (버튼 안에 버튼을 넣지 않는다) */
  function favStarHtml(sp) {
    return '<span class="favbtn' + (sp.favorite ? ' is-on' : '') + '"' +
      ' role="button" tabindex="0" aria-pressed="' + (sp.favorite ? 'true' : 'false') + '"' +
      ' aria-label="' + esc(sp.name) + ' 즐겨찾기"' +
      ' data-fav="' + esc(sp.id) + '">' + icon('star') + '</span>';
  }

  /** 즐겨찾기 담기·빼기. 홈과 탐색이 같은 데이터를 보므로 양쪽을 함께 다시 그린다 */
  function toggleFav(id) {
    var sp = F.getSpace(id);
    if (!sp) return;
    sp.favorite = !sp.favorite;
    /* 조사 대신 가운뎃점 — 「폰부스 1」처럼 이름 끝이 숫자·영문이어도 어색하지 않다.
       빼기는 되돌릴 수 있는 동작이라 확인 없이 하고 「되돌리기」를 준다 (SPEC P-10 · 65차) */
    if (sp.favorite) toast(sp.name + ' · 즐겨찾기에 담았어요');
    else toast(sp.name + ' · 즐겨찾기에서 뺐어요', { action: '되돌리기', onAction: function () { toggleFav(id); } });
    /* 다시 그리면 별이 새 노드로 바뀐다. 키보드로 눌렀다면 같은 자리에 초점을 돌려놓는다 */
    var a = document.activeElement;
    var keep = a && a.getAttribute && a.getAttribute('data-fav') === id
      ? a.closest('[data-screen]') : null;
    renderHome();
    if (q) renderFind();
    if (keep) {
      var again = keep.querySelector('[data-fav="' + id + '"]');
      if (again) again.focus({ preventScroll: true });
    }
  }

  /** 미니 카드 — 즐겨찾기·최근 사용 공용. showFav면 우측 상단에 별 */
  function miniCardHtml(sp, sub, showFav) {
    var a = availNow(sp);
    return '<button class="mcard" data-hrow="' + esc(sp.id) + '">' +
      (showFav ? favStarHtml(sp) : '') +
      '<span class="mcard__th"></span>' +
      '<span class="mcard__n">' + esc(sp.name) + '</span>' +
      '<span class="mcard__m">' + esc(
        (sp.policy.capacity ? sp.policy.capacity + '명 · ' : '') + F.floorLabel(sp.floor) +
        (sub ? ' · ' + sub : '')) + '</span>' +
      /* 아래 「전체 회의실」 줄과 같은 말 — 「바로 사용 가능 · 17:00까지」 (65차) */
      '<span class="mcard__a' + (a.busy ? ' is-busy' : '') + '">' +
        esc(a.busy ? a.text : a.text + (a.sub ? ' · ' + a.sub : '')) + '</span>' +
    '</button>';
  }

  /** 최근 사용 — 내 지난 예약에서 공간을 뽑는다. 같은 방은 한 번만 */
  function recentSpaces() {
    var seen = {}, out = [];
    M.reservations.filter(function (r) {
      return r.userId === M.me.id && r.start <= M.NOW &&
        ['CHECKED_IN', 'USED'].indexOf(r.status) !== -1;
    }).sort(function (a, b) { return b.start - a.start; }).forEach(function (r) {
      if (seen[r.spaceId]) return;
      var sp = F.getSpace(r.spaceId);
      if (!sp) return;
      seen[r.spaceId] = 1;
      var d = F.diffDays(r.start, M.NOW);
      out.push({ sp: sp, when: d === 0 ? '오늘' : d === 1 ? '어제' : dayShort(r.start) });   /* 좁은 자리 날짜 「8/26(수)」 (65차) */
    });
    return out.slice(0, 10);
  }

  /** 지금 쓸 수 있는지 — 홈 리스트의 오른쪽 문구 */
  function availNow(sp) {
    var st = F.getSpaceStatus(sp.id);
    if (!st) return { text: '', busy: true, sub: '' };
    if (st.key === 'AVAILABLE') {
      var slots = F.getAvailableSlots(sp.id, M.NOW);
      var until = null;
      for (var i = 0; i < slots.length; i++) {
        if (slots[i].start < M.NOW) continue;
        if (slots[i].state !== 'AVAILABLE') break;
        until = slots[i].end;
      }
      return { text: '바로 사용 가능', busy: false, sub: until ? hm(until) + '까지' : '' };
    }
    if (st.key === 'IN_USE') {
      return { text: (st.until ? hm(st.until) + '까지 ' : '') + '사용 중', busy: true, sub: '' };
    }
    /* 운영일 · 운영시간 밖 — mock은 문구를 화면에 맡긴다. 줄 오른쪽이라 짧게 (72차 · 한빛산업의 평일 회의실에서 드러남) */
    if (st.key === 'CLOSED') {
      var hmOpen = sp.openAt.split(':'), openMin = +hmOpen[0] * 60 + +hmOpen[1];
      var text = sp.operatingDays.indexOf(M.NOW.getDay()) === -1 ? sp.days + '만'
        : minOf(M.NOW) < openMin ? sp.openAt + '부터' : '오늘 마감';
      return { text: text, busy: true, sub: '' };
    }
    return { text: (M.availabilityText[st.key] || { text: '' }).text, busy: true, sub: '' };
  }

  /* 공간 그룹은 무한 단계 트리 (2026-09-29 69차) — 고른 경로(뿌리 → 그룹 id). 비면 전체. 상위를 고르면 하위 회의실까지 */
  var homePath = [];
  function inPath(s, path) { return !path.length || F.groupPath(s.floor).indexOf(path[path.length - 1]) !== -1; }

  /** 그룹 칩 줄 — 첫 줄은 「전체」 + 맨 위 그룹(+ 덧붙일 칩), 고른 그룹에 하위가 있으면 다음 줄에 그 하위가 이어진다 */
  function groupChipRows(path, attr, extra) {
    function chip(g, on) { return '<button class="chip' + (on ? ' is-selected' : '') + '" data-' + attr + '="' + esc(g.id) + '">' + esc(g.name) + '</button>'; }
    var rows = ['<button class="chip' + (path.length ? '' : ' is-selected') + '" data-' + attr + '="">전체</button>' +
      F.groupChildren(null).map(function (g) { return chip(g, path[0] === g.id); }).join('') + (extra || '')];
    for (var d = 0; d < path.length; d++) {
      var kids = F.groupChildren(path[d]);
      if (!kids.length) break;
      rows.push(kids.map(function (g) { return chip(g, path[d + 1] === g.id); }).join(''));
    }
    return '<div class="chipstack">' + rows.map(function (r, i) { return '<div class="chiprow' + (i ? ' chiprow--sub' : '') + '">' + r + '</div>'; }).join('') + '</div>';
  }
  /** 칩을 눌렀을 때의 새 경로 — 이미 고른 마지막 칩을 다시 누르면 한 단계 위로 */
  function nextPath(path, id) {
    if (!id) return [];
    var np = F.groupPath(id);
    return path.length === np.length && path[path.length - 1] === id ? np.slice(0, -1) : np;
  }
  var homeCap = false;          /* 「4명 이상」 칩 */

  function homeSpaces() {
    return M.spaces.filter(function (s) {
      if (s.maintenance) return false;
      if (homeCap && !(s.policy.capacity >= 4)) return false;
      return inPath(s, homePath);
    }).sort(function (a, b) {
      /* 사용 중은 뒤로, 그 다음 층 → 수용 인원 순 (2026-09-23) */
      var av = function (s) { return availNow(s).busy ? 1 : 0; };
      var ord = F.groupOrder();
      var fl = function (s) { var i = ord.indexOf(s.floor); return i < 0 ? 99 : i; };   /* 트리 순서 (69차) */
      return av(a) - av(b) || fl(a) - fl(b) || (a.policy.capacity || 0) - (b.policy.capacity || 0) ||
        a.name.localeCompare(b.name, 'ko');
    });
  }

  /** 펼친 행 안의 예약 조각 — 시간 칩 + 인원. 사유는 없다 */
  function openPanelHtml(sp) {
    var list = open.slots;
    var chips = list.map(function (sl, i) {
      var cls = 'chip';
      if (sl.state !== 'AVAILABLE') cls += ' is-disabled';
      if (open.a !== null && i >= Math.min(open.a, open.b) && i <= Math.max(open.a, open.b)) {
        cls += ' is-selected';
      }
      return '<button class="' + cls + ' tnum" data-hslot="' + i + '">' + hm(sl.start) + '</button>';
    }).join('');

    var summary = '시간을 골라 주세요';
    var canBook = false, why = '';
    if (open.a !== null) {
      var lo = Math.min(open.a, open.b), hi = Math.max(open.a, open.b);
      summary = F.rangeLabel(list[lo].start, list[hi].end) + ' · ' +
        F.durationLabel(list[lo].start, list[hi].end);
      canBook = true;
      /* web 예약 규칙(하루 예약 횟수 · 연속 예약 등)에 막히면 흐린 버튼 — 누르면 이유 (66차) */
      var ck = F.bookCheck(sp.id, list[lo].start, list[hi].end);
      if (!ck.ok) why = ck.reason;
    }

    return '<span class="srow__x">' +
      '<span class="chiprow">' + chips + '</span>' +
      '<span class="sheetrow">참석 인원' +   /* web 예약 상세 · 등록과 같은 이름 (66차) */
        '<span class="stepper">' +
          '<button class="stepper__btn' + (open.people <= 1 ? ' is-disabled' : '') +
            '" data-hppl="-1" aria-label="줄이기">' + icon('minus', 'icon--sm') + '</button>' +
          '<span class="stepper__value">' + open.people + '명</span>' +
          '<button class="stepper__btn' + (sp.policy.capacity && open.people >= sp.policy.capacity ? ' is-disabled' : '') +
            '" data-hppl="1" aria-label="늘리기">' + icon('plus', 'icon--sm') + '</button>' +
        '</span>' +
      '</span>' +
      '<button class="btn btn--primary btn--sm' + (canBook ? (why ? ' is-blocked' : '') : ' is-disabled') +
        '" data-hbook="' + esc(sp.id) + '"' + (why ? ' data-why="' + esc(why) + '"' : '') + '>' + esc(canBook ? summary + ' 예약하기' : summary) + '</button>' +
    '</span>';
  }

  /* 날짜 헤더 — 면을 깔지 않는다. 요일만 읽는 주황. 표기는 앱 공통 「9월 6일(일)」 (65차)
     맨 위에 회사 이름 ▾ — 누르면 회사 시트 (72차 · 개발자 피드백 5) */
  function homeHeadHtml() {
    var d = M.NOW, DOW = ['일', '월', '화', '수', '목', '금', '토'];
    return '<div class="hhead">' + coSwHtml() +
        '<p class="hhead__r"><span class="hhead__d">' +
          (d.getMonth() + 1) + '월 ' + d.getDate() + '일</span>' +
          '<span class="hhead__w">(' + DOW[d.getDay()] + ')</span></p>' +
        (hasCo() ? '<p class="hhead__s">' + esc(M.branding.siteName) + '</p>' : '') +   /* 부서는 마이에 있다 (2026-09-23) */
      '</div>';
  }

  function renderHome() {
    if (!hasCo()) { renderHomeNoCo(); return; }   /* 가입만 하고 회사가 없거나 승인 전 (72차) */
    $('#homeHead').innerHTML = homeHeadHtml();

    var list = homeSpaces();

    var rows = list.map(function (s) {
      var a = availNow(s);
      if (open.spaceId === s.id) {
        return '<div class="srow is-open">' +
          '<span class="srow__th"></span>' +
          '<span class="srow__m"><span class="srow__n">' + esc(s.name) + '</span>' +
            '<span class="srow__s">' + esc(F.spaceMeta(s.id)) + '</span></span>' +
          '<span class="srow__r"><b class="' + (a.busy ? 'is-busy' : '') + '">' + esc(a.text) + '</b>' +
            (a.sub ? '<span>' + esc(a.sub) + '</span>' : '') + '</span>' +
          openPanelHtml(s) +
        '</div>';
      }
      /* 예약 권한이 없는 회의실(web 「예약할 수 있는 사람」)은 숨기지 않고 흐리게 — 누르면 이유 (66차) */
      var who = F.whoCheck(s.id);
      return '<button class="srow' + (who.ok ? '' : ' is-blocked') + '" data-hrow="' + esc(s.id) + '">' +
        '<span class="srow__th"></span>' +
        '<span class="srow__m"><span class="srow__n">' + esc(s.name) + '</span>' +
          '<span class="srow__s">' + esc(F.spaceMeta(s.id)) + '</span></span>' +
        '<span class="srow__r"><b class="' + (a.busy || !who.ok ? 'is-busy' : '') + '">' + esc(who.ok ? a.text : who.short) + '</b>' +
          (who.ok && a.sub ? '<span>' + esc(a.sub) + '</span>' : '') + '</span>' +
      '</button>';
    }).join('');

    /* 즐겨찾기 */
    var favs = M.spaces.filter(function (s) { return s.favorite && !s.maintenance; });
    var favSec = favs.length
      ? '<section class="hsec"><div class="hsec__h">' +
          '<span class="hsec__t">★ 즐겨찾기</span>' +
          '</div>' +
          '<div class="hcards">' + favs.map(function (s) {
            return miniCardHtml(s, "", true);
          }).join('') + '</div></section>'
      : '';

    /* 최근 사용 */
    var recent = recentSpaces();
    var recSec = recent.length
      ? '<section class="hsec"><div class="hsec__h">' +
          '<span class="hsec__t">최근 사용</span>' +
          '<span class="hsec__c">' + recent.length + '곳</span></div>' +
          '<div class="hcards">' + recent.map(function (x) {
            return miniCardHtml(x.sp, x.when);
          }).join('') + '</div></section>'
      : '';

    /* 전체 회의실 — 층 칩 + 인원 칩 + 리스트. 사용 중인 곳도 맨 뒤에 있으므로 「비어있는」이라 부르지 않는다 (65차) */
    var chips = groupChipRows(homePath, 'hfloor', '<button class="chip' + (homeCap ? ' is-selected' : '') + '" data-hcap="1">4명 이상</button>');

    $('#homeBody').innerHTML =
      '<div class="hbody">' +
        todayCarHtml() + favSec + recSec +
        '<section class="hsec hsec--list">' +
          '<div class="hsec__h" style="padding:0">' +
            '<span class="hsec__t">전체 회의실</span>' +
            '<span class="hsec__c">' + list.length + '곳</span></div>' +
          chips +
          '<div class="slist">' + rows + '</div>' +
        '</section>' +
      '</div>';

    /* 시안에는 하단 고정 CTA가 없다 — 주 동작은 카드의 「체크인」이다 */
    $('#homeCta').innerHTML = '';

    centerTodayCard();
  }

  /** 행을 펼친다 — 지금부터 쓸 수 있는 칸(그 방의 예약 단위)을 최대 8개까지 */
  function openRow(spaceId) {
    var sp = F.getSpace(spaceId);
    if (!sp) return;
    var who = F.whoCheck(spaceId);
    if (!who.ok) { toast(who.reason); return; }   /* web 「예약할 수 있는 사람」 (66차) */
    /* 이미 시작한 칸은 빼고 다음 단위 경계부터 보여 준다 — 1시간 방은 정시, 30분 방은 :00/:30 */
    var begin = nextSlot(F.slotMinOf(spaceId));
    var all = F.getAvailableSlots(spaceId, M.NOW);
    var mb = sp.policy.minBefore || 0;
    var from = all.filter(function (s) { return s.start >= begin; }).slice(0, 8).map(function (s) {
      /* web 「최소 몇 분 전」 — 그보다 가까운 칸은 흐리게, 누르면 이유 (66차) */
      return s.state === 'AVAILABLE' && F.diffMin(M.NOW, s.start) < mb
        ? Object.assign({}, s, { state: 'TOO_SOON', reason: '시작 ' + mb + '분 전까지 예약할 수 있어요' }) : s;
    });
    if (!from.length) { toast('오늘은 남은 시간이 없어요'); return; }

    open.spaceId = spaceId;
    open.slots = from;
    open.people = Math.min(sp.policy.capacity || 4, 4);
    /* 첫 번째로 비어 있는 칸을 미리 잡아 둔다 */
    var i = -1;
    from.forEach(function (s, k) { if (i < 0 && s.state === 'AVAILABLE') i = k; });
    open.a = open.b = i >= 0 ? i : null;
    renderHome();
  }


  /* ============================================================
     S-06 탐색 — 공간 그룹 · 시간 두 섹션 + 회의룸 카드
     시간은 퀵버튼과 시작·종료 필드를 나란히 둔다 (A안)
     ============================================================ */

  var q = null;

  /* 조건 = 날짜 · 시작 · 종료 (나안 · 2026-09-23). 날짜를 바꾸면 그 날의 같은 시각으로 옮긴다 */
  /* web 「며칠 뒤까지 예약」은 회의실마다 다르다 — 달력은 가장 먼 회의실까지 열고,
     그 날짜를 받지 않는 회의실은 결과에서 흐리게 둔다(bookCheck) (66차 · 예전 30일 고정) */
  var LEAD_DAYS = M.spaces.reduce(function (m, s) { return s.maintenance ? m : Math.max(m, s.policy.maxLeadDays || 0); }, 0);
  function initQuery() {
    var s = nextSlot();
    q = { path: [], cap: false, date: F.startOfDay(M.NOW), start: s, end: F.addMin(s, 60), quick: '60' };
  }

  /** 그 날의 첫 예약 가능 시각 — 오늘이면 다음 정시, 다른 날이면 운영 시작 */
  function firstSlotOf(day) {
    return F.sameDay(day, M.NOW) ? nextSlot() : atMin(day, OPEN_MIN);
  }

  /** 날짜를 옮긴다 — 시각은 그대로, 지난 시각이면 그 날의 첫 시각으로 */
  function setQueryDate(day) {
    var len = Math.max(FIND_STEP, F.diffMin(q.start, q.end));
    var m = minOf(q.start);
    var s = atMin(day, m);
    if (F.sameDay(day, M.NOW) && s <= M.NOW) s = nextSlot();
    if (minOf(s) < OPEN_MIN) s = atMin(day, OPEN_MIN);
    var e = F.addMin(s, len);
    if (minOf(e) > CLOSE_MIN || e.getDate() !== s.getDate()) e = atMin(day, CLOSE_MIN);
    q.date = F.startOfDay(day); q.start = s; q.end = e;
  }

  function qLen() { return F.durationLabel(q.start, q.end); }

  function applyQuick(kind) {
    var s = q.start;
    if (kind === 'now') s = firstSlotOf(q.date);
    var mins = { now: 60, '60': 60, '120': 120, '180': 180 }[kind] || 60;
    var e = F.addMin(s, mins);
    var close = atMin(q.start, CLOSE_MIN);
    if (e > close) { toast('운영 시간을 넘겨요'); return; }
    q.start = s; q.end = e; q.quick = kind;
    renderFind();
  }

  /* 그 시간이 비어 있는 회의실 — web 예약 규칙(최대 사용 시간 · 며칠 뒤까지 · 최소 몇 분 전 · 하루 횟수 · 연속 · 예약할 수 있는 사람)에
     막히는 곳은 숨기지 않고 따로 모은다(흐리게 + 이유). 「N곳 쓸 수 있어요」는 막히지 않은 곳만 센다 (66차) */
  function findMatches() {
    var ok = [], blocked = [];
    M.spaces.forEach(function (s) {
      if (s.maintenance) return;
      if (!inPath(s, q.path)) return;   /* 공간 그룹 트리 — 상위를 고르면 하위까지 (69차) */
      if (q.cap && !(s.policy.capacity >= 4)) return;   /* 홈과 같은 「4명 이상」 칩 (65차) */
      if (!isFree(s.id, q.start, q.end)) return;
      var ck = F.bookCheck(s.id, q.start, q.end);
      if (ck.ok) ok.push(s); else blocked.push({ s: s, why: ck.reason, short: ck.short || ck.reason });
    });
    return { ok: ok, blocked: blocked };
  }

  /* 막힌 회의실 줄 — 흐리게, 누르면 이유 */
  function blockedRowHtml(x) {
    return '<button class="srow is-blocked" data-fblock="' + esc(x.why) + '">' +
      '<span class="srow__th"></span>' +
      '<span class="srow__m"><span class="srow__n">' + esc(x.s.name) + '</span>' +
        '<span class="srow__s">' + esc(F.spaceMeta(x.s.id)) + '</span></span>' +
      '<span class="srow__r"><b class="is-busy">' + esc(x.short) + '</b></span>' +   /* 줄에는 짧게, 누르면 전체 이유 */
    '</button>';
  }

  /* 탐색 결과 한 줄 — 홈과 같은 행 + 인라인 펼침(2026-09-23). 시간은 위 조건에서 이미 정해졌다.
     메타 줄은 홈과 같은 「인원 · 층 · 유형」(spaceMeta) (65차) */
  function roomRowHtml(s) {
    var meta = F.spaceMeta(s.id);
    if (findOpen.id === s.id) {
      return '<div class="srow is-open">' +
        '<span class="srow__th"></span>' +
        '<span class="srow__m"><span class="srow__n">' + esc(s.name) + '</span>' +
          '<span class="srow__s">' + esc(meta) + '</span></span>' +
        '<span class="srow__r">' + favStarHtml(s) + '</span>' +
        findPanelHtml(s) +
      '</div>';
    }
    return '<button class="srow" data-froom="' + esc(s.id) + '">' +
      '<span class="srow__th"></span>' +
      '<span class="srow__m"><span class="srow__n">' + esc(s.name) + '</span>' +
        '<span class="srow__s">' + esc(meta) + '</span></span>' +
      '<span class="srow__r">' + favStarHtml(s) + '</span>' +
    '</button>';
  }

  /* 펼친 행 — 인원과 예약 버튼만(시간은 조건 섹션이 갖는다) */
  function findPanelHtml(s) {
    var cap = s.policy.capacity || 0;
    return '<span class="srow__x">' +
      '<span class="sheetrow">참석 인원' +
        '<span class="stepper">' +
          '<button class="stepper__btn' + (findOpen.people <= 1 ? ' is-disabled' : '') +
            '" data-fppl="-1" aria-label="줄이기">' + icon('minus', 'icon--sm') + '</button>' +
          '<span class="stepper__value">' + findOpen.people + '명</span>' +
          '<button class="stepper__btn' + (cap && findOpen.people >= cap ? ' is-disabled' : '') +
            '" data-fppl="1" aria-label="늘리기">' + icon('plus', 'icon--sm') + '</button>' +
        '</span>' +
      '</span>' +
      '<button class="btn btn--primary btn--sm" data-fbook="' + esc(s.id) + '">' +
        esc(F.rangeLabel(q.start, q.end) + ' · ' + qLen() + ' 예약하기') + '</button>' +
    '</span>';
  }

  var findOpen = { id: '', people: 4 };

  function renderFind() {
    if (!hasCo()) { $('#findDate').textContent = ''; $('#findBody').innerHTML = noCoHtml(); return; }   /* 72차 */
    if (!q) initQuery();
    /* 날짜는 조건 버튼에만 — 제목 옆에 한 번 더 적지 않는다 (65차) */
    $('#findDate').textContent = '';

    var found = findMatches();

    $('#findBody').innerHTML =
      '<div class="block block--tight"><div class="cond">' +

        /* 날짜 · 시작 · 종료 — 각각 시트에서 고른다 (2026-09-23) */
        '<div class="fpill">' +
          '<button data-fdate="1"><span>날짜</span><b>' + esc(dayShort(q.date)) + '</b></button>' +
          '<button data-ftime="start"><span>시작</span><b class="tnum">' + hm(q.start) + '</b></button>' +
          '<button data-ftime="end"><span>종료</span><b class="tnum">' + hm(q.end) + '</b></button>' +
        '</div>' +

        /* 공간 그룹 — 홈과 같은 칩(그룹 + 「4명 이상」). 「전체」 칩이 초기화를 대신한다 (65차).
           이름은 관리자 web 설정의 「공간 그룹」(층 · 구역)과 같게 둔다 — 「층」이라 부르면 구역 그룹에서 틀린다 */
        '<div class="cs">' +
          '<div class="cs__k"><b>공간 그룹</b></div>' +
          groupChipRows(q.path, 'fgroup', '<button class="chip' + (q.cap ? ' is-selected' : '') + '" data-fcap="1">4명 이상</button>') +
        '</div>' +

      '</div></div>' +

      '<div class="block"><div class="sect">' +
        '<h2 class="sect__t">' + (found.ok.length ? found.ok.length + '곳 쓸 수 있어요' : '쓸 수 있는 곳이 없어요') + '</h2>' +
        '<span class="note" style="font-size:13px">' + esc(dayShort(q.date) + ' ' + F.rangeLabel(q.start, q.end)) + '</span>' +
      '</div></div>' +

      (found.ok.length || found.blocked.length
        ? '<div class="block">' + found.ok.map(roomRowHtml).join('') + found.blocked.map(blockedRowHtml).join('') + '</div>'
        : '<div class="empty">' + icon('search', 'icon--lg') +
            '<p class="empty__text">시간을 조금 옮겨 보세요</p>' +   /* 「없어요」는 위 제목이 이미 말한다 (65차) */
            '<button class="btn btn--sm btn--secondary empty__action" data-fquick="now">지금부터 1시간으로</button>' +
          '</div>');
  }

  /** 9월 6일 (일) → 9/6 (일) — web 「9/9 (수)」와 같게 요일 앞을 띄운다 (66차) */
  function dayShort(d) { return (d.getMonth() + 1) + '/' + d.getDate() + ' (' + M.DOW[d.getDay()] + ')'; }

  /** 날짜 시트 — 월 달력. 오늘부터 「며칠 뒤까지 예약」까지 (2026-09-23) */
  var calMonth = null;

  function openDateSheet() {
    calMonth = new Date(q.date.getFullYear(), q.date.getMonth(), 1);
    var picked = q.date;

    function body() {
      var first = new Date(calMonth), last = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0);
      var min = F.startOfDay(M.NOW), max = F.startOfDay(F.addMin(M.NOW, LEAD_DAYS * 24 * 60));
      var cells = '';
      for (var i = 0; i < first.getDay(); i++) cells += '<span class="cal__d is-blank"></span>';
      for (var day = 1; day <= last.getDate(); day++) {
        var d = new Date(calMonth.getFullYear(), calMonth.getMonth(), day);
        var out = d < min || d > max;
        var cls = 'cal__d' + (out ? ' is-out' : '') + (d.getDay() === 0 ? ' is-sun' : '') +
          (F.sameDay(d, picked) ? ' is-on' : '') + (F.sameDay(d, M.NOW) && !F.sameDay(d, picked) ? ' is-today' : '');
        cells += out
          ? '<span class="' + cls + '">' + day + '</span>'
          : '<button class="' + cls + '" data-calday="' + d.getTime() + '">' + day + '</button>';
      }
      var prevOk = new Date(calMonth.getFullYear(), calMonth.getMonth(), 0) >= F.startOfDay(M.NOW);
      var nextOk = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1) <= F.startOfDay(F.addMin(M.NOW, LEAD_DAYS * 24 * 60));
      return '<div class="cal__h">' +
          '<button class="cal__nav' + (prevOk ? '' : ' is-disabled') + '" data-calmove="-1" aria-label="이전 달">' + icon('back', 'icon--sm') + '</button>' +
          '<span>' + calMonth.getFullYear() + '년 ' + (calMonth.getMonth() + 1) + '월</span>' +
          '<button class="cal__nav' + (nextOk ? '' : ' is-disabled') + '" data-calmove="1" aria-label="다음 달">' + icon('next', 'icon--sm') + '</button>' +
        '</div>' +
        '<div class="cal">' + ['일', '월', '화', '수', '목', '금', '토'].map(function (w, i) {
          return '<span class="cal__w' + (i === 0 ? ' is-sun' : '') + '">' + w + '</span>';
        }).join('') + cells + '</div>';
    }

    function paintSheet() {
      var b = $('#sheetBody'); if (!b) return;
      b.innerHTML = body();
      var cta = $('#sheetCtaBtn'); if (cta) cta.textContent = F.dateLabel(picked) + '로 보기';
    }

    openSheet({
      title: '날짜',
      body: body(),
      cta: { label: F.dateLabel(picked) + '로 보기', onClick: function () { setQueryDate(picked); closeSheet(); renderFind(); } },
      onMount: function (root) {
        root.addEventListener('click', function (e) {
          var mv = e.target.closest('[data-calmove]');
          if (mv) {
            if (mv.classList.contains('is-disabled')) return;
            calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + (+mv.getAttribute('data-calmove')), 1);
            paintSheet(); return;
          }
          var cd = e.target.closest('[data-calday]');
          if (cd) { picked = new Date(+cd.getAttribute('data-calday')); paintSheet(); }
        });
      }
    });
  }

  /** 시작·종료 시각 시트 — 가장 잘게 쪼개는 방의 단위(FIND_STEP) */
  function openTimeSheet(which) {
    var isStart = which === 'start';
    var cur = isStart ? q.start : q.end;
    /* 오늘이면 지난 시각은 고를 수 없다 (2026-09-23) */
    var lo = isStart ? (F.sameDay(q.date, M.NOW) ? Math.max(OPEN_MIN, minOf(nextSlot(FIND_STEP))) : OPEN_MIN) : minOf(q.start) + FIND_STEP;
    var hi = isStart ? CLOSE_MIN - FIND_STEP : CLOSE_MIN;
    var half = 'pm';

    function body() {
      var times = slotTimes(OPEN_MIN, CLOSE_MIN, FIND_STEP).filter(function (m) {
        return half === 'am' ? m < 12 * 60 : m >= 12 * 60;
      });
      return '<div class="segment">' +
          '<button class="chip' + (half === 'am' ? ' is-selected' : '') + '" data-half="am">오전</button>' +
          '<button class="chip' + (half === 'pm' ? ' is-selected' : '') + '" data-half="pm">오후</button>' +
        '</div>' +
        '<div class="timegrid">' + times.map(function (m) {
          var cls = '';
          if (m < lo || m > hi) cls = ' is-disabled';
          else if (m === minOf(cur)) cls = ' is-selected';
          return '<button class="' + cls.trim() + '" data-pick="' + m + '">' +
            hm(atMin(M.NOW, m)) + '</button>';
        }).join('') + '</div>';
    }

    openSheet({
      title: (isStart ? '시작' : '종료') + ' 시각<span>' + (FIND_STEP % 60 ? FIND_STEP + '분' : '1시간') + ' 단위로 고를 수 있어요</span>',
      body: body(),
      onMount: function (root) {
        root.addEventListener('click', function (e) {
          var h = e.target.closest('[data-half]');
          if (h) { half = h.getAttribute('data-half'); root.innerHTML = body(); return; }
          var p = e.target.closest('[data-pick]');
          if (!p) return;
          var m = +p.getAttribute('data-pick');
          /* 고른 날짜(q.date)의 그 시각 — 오늘(M.NOW)로 만들면 다른 날을 골라도 오늘로 예약됐다 (65차 버그 수정) */
          if (isStart) {
            var keep = F.diffMin(q.start, q.end);
            q.start = atMin(q.date, m);
            q.end = atMin(q.date, Math.min(m + keep, CLOSE_MIN));
          } else {
            q.end = atMin(q.date, m);
          }
          q.quick = null;
          closeSheet();
          renderFind();
        });
      }
    });
  }


  /* ============================================================
     예약 — 사유 입력은 없다. 시간과 인원만 정한다
     ============================================================ */

  var lastBooked = null, rsvSeq = 0;

  function book(sp, start, end, people) {
    /* 마지막 문지기 — 어느 길로 오든 web 예약 규칙을 한 번 더 태운다 (66차) */
    var ck = F.bookCheck(sp.id, start, end);
    if (!ck.ok) { toast(ck.reason); return; }
    var r = {
      id: (F.companyKey() === 'HB' ? 'HR-' : 'RSV-') + (3400 + (++rsvSeq)),   /* 회사마다 머리 · 세션 번호 (72차) */
      spaceId: sp.id, userId: M.me.id,
      start: start, end: end,
      specLabel: F.dateLabel(start) + ' ' + F.rangeLabel(start, end),
      reason: null,                  // 예약 사유는 받지 않는다
      headcount: people,
      status: 'APPROVED',            // 승인 단계 없이 신청 즉시 확정
      checkedInAt: null, checkedOutAt: null
    };
    M.reservations.push(r);
    lastBooked = r.id;
    closeRow();
    renderHome(); renderFind(); renderMine();
    toast(F.spaceName(sp.id) + ' · 예약했어요', {   /* 조사 대신 가운뎃점 — 「포커스룸 A을」 방지 (65차) */
      action: '보기',
      onAction: function () { goTab('S-16'); }
    });
    setTimeout(function () { lastBooked = null; }, 6000);
  }

  /** 탐색의 회의룸 카드를 누르면 — 그 시간이 채워진 예약 시트 */
  function openRoomSheet(spaceId) {
    var sp = F.getSpace(spaceId);
    if (!sp) return;
    var people = Math.min(sp.policy.capacity || 4, 4);

    function body() {
      return '<span class="roomcard__img" style="width:100%;aspect-ratio:16/9;border-radius:var(--r-thumb);' +
          'display:flex;align-items:flex-end;padding:10px"><span>' + esc(sp.name) + '</span></span>' +
        '<div class="pick">' +
          '<p class="pick__t tnum">' + hm(q.start) + ' – ' + hm(q.end) + '</p>' +
          '<p class="pick__d">' + esc(F.dateLabel(q.start) + ' · ' + qLen()) + '</p>' +
        '</div>' +
        '<div class="sheetrow">인원' +
          '<span class="stepper">' +
            '<button class="stepper__btn' + (people <= 1 ? ' is-disabled' : '') + '" data-rppl="-1" aria-label="줄이기">' + icon('minus', 'icon--sm') + '</button>' +
            '<span class="stepper__value">' + people + '명</span>' +
            '<button class="stepper__btn' + (sp.policy.capacity && people >= sp.policy.capacity ? ' is-disabled' : '') + '" data-rppl="1" aria-label="늘리기">' + icon('plus', 'icon--sm') + '</button>' +
          '</span>' +
        '</div>';
    }

    openSheet({
      /* spaceMeta에 이미 층이 들어 있다 — 위치를 두 번 적지 않는다 */
      title: esc(sp.name) + '<span>' + esc(F.spaceMeta(sp.id)) + '</span>',   /* 설비는 2026-09-28 삭제(관리자 web에 설비 칸이 없다) */
      body: body(),
      cta: { label: '예약하기', onClick: function () { book(sp, q.start, q.end, people); } },
      onMount: function (root) {
        root.addEventListener('click', function (e) {
          var p = e.target.closest('[data-rppl]');
          if (!p) return;
          var n = people + (+p.getAttribute('data-rppl'));
          if (n < 1) return;
          if (sp.policy.capacity && n > sp.policy.capacity) { toast(F.capacityMessage(sp.id)); return; }
          people = n; root.innerHTML = body();
        });
      }
    });
  }


  /* ============================================================
     S-16 내 예약 — 카드 목록. 카드를 누르면 제어 페이지
     ============================================================ */

  var mineTab = 'upcoming';

  function renderMine() {
    if (!hasCo()) { $('#mineCount').textContent = ''; $('#mineSeg').innerHTML = ''; $('#mineBody').innerHTML = noCoHtml(); return; }   /* 72차 */
    var list = F.myReservations(mineTab);
    /* 제목의 건수는 지금 보고 있는 세그먼트 기준 (2026-09-23) */
    $('#mineCount').textContent = mineTab === 'upcoming'
      ? '예정 ' + list.length + '건' : '지난 ' + list.length + '건';

    $('#mineSeg').innerHTML =
      '<button class="chip' + (mineTab === 'upcoming' ? ' is-selected' : '') + '" data-mtab="upcoming">예정</button>' +
      '<button class="chip' + (mineTab === 'past' ? ' is-selected' : '') + '" data-mtab="past">지난</button>';

    if (!list.length) {
      $('#mineBody').innerHTML = '<div class="empty">' + icon('cal', 'icon--lg') +
        '<p class="empty__text">' + (mineTab === 'upcoming' ? '예정된 예약이 없어요' : '지난 예약이 없어요') + '</p>' +
        (mineTab === 'upcoming'
          ? '<button class="btn btn--sm btn--secondary empty__action" data-tab="S-06">빈 곳 찾아보기</button>' : '') +
      '</div>';
      return;
    }

    /* 날짜별로 묶는다 */
    var groups = [];
    list.forEach(function (r) {
      var key = F.ymd(r.start), g = null;
      groups.forEach(function (x) { if (x.key === key) g = x; });
      if (!g) { g = { key: key, label: F.dateLabel(r.start), items: [] }; groups.push(g); }
      g.items.push(r);
    });

    $('#mineBody').innerHTML = groups.map(function (g) {
      return '<div class="block">' +
        '<p class="groupt" style="padding:0 0 var(--sp-3)">' + esc(g.label) + '</p>' +
        '<div class="stackv">' + g.items.map(function (r) {
          return rsvCardHtml(r, { fresh: r.id === lastBooked });
        }).join('') + '</div>' +
      '</div>';
    }).join('');
  }


  /* ============================================================
     S-14 제어 페이지 — 카드에서 열린다
     이용 중이면 기기, 입실 전이면 입실 안내(기기는 잠김 · 예열 없음 54차). 한 화면이 두 상태를 갖는다
     ============================================================ */

  var ctlTarget = null;
  var CONFIRM_MS = 1200, FAIL_MS = 3000;
  var pending = {}, failed = {};
  var readerMode = 'success', readerTimer = null, readerMsg = '';

  function ctlSpaceId() { return ctlTarget ? ctlTarget.spaceId : 'SP-03'; }
  function isCheckedIn() { return !!(ctlTarget && ctlTarget.status === 'CHECKED_IN'); }

  function deviceOf(kind) {
    var dv = F.getDevices(ctlSpaceId());
    if (!dv) return null;
    var hit = null;
    dv.items.forEach(function (d) { if (d.kind === kind) hit = d; });
    return hit;
  }

  function ensureCtl() {
    /* 내 예약만 — 알림 · 다른 경로로 남의 예약이 들어와도 제어하지 않는다 (72차) */
    if (ctlTarget && ctlTarget.userId === M.me.id && (ctlTarget.status === 'CHECKED_IN' || ctlTarget.status === 'APPROVED')) return;
    ctlTarget = F.currentReservation() || F.checkinTarget() || F.myReservations('upcoming')[0] || null;
  }

  /** 낙관적 UI 금지 — 응답이 온 뒤에만 값을 바꾼다 */
  function sendCommand(dev, label, applyFn, doneFn) {
    if (!dev || pending[dev.id]) return;
    delete failed[dev.id];
    pending[dev.id] = label;
    renderControl();

    var offline = dev.status === 'OFFLINE';
    setTimeout(function () {
      delete pending[dev.id];
      if (offline) {
        failed[dev.id] = '응답이 없어요';
        F.addLog(ctlSpaceId(), dev.name, label, 'FAIL', { reason: '기기가 응답하지 않았어요' });
      } else {
        if (applyFn) applyFn();
        F.addLog(ctlSpaceId(), dev.name, label, 'OK');
      }
      renderControl();
      if (doneFn) doneFn();
    }, offline ? FAIL_MS : CONFIRM_MS);
  }

  /* ── SIOT 디바이스 카드 ───────────────────────────────── */

  /* 슬라이더 채움 — SIOT 카드는 지나온 구간을 브랜드 색으로 칠한다 */
  function trackFill(pct) {
    return 'background:linear-gradient(to right,var(--dev) 0 ' + pct + '%,var(--gray-200) ' + pct + '% 100%)';
  }

  function devHead(name, state, off) {
    return '<div class="dcard__h"><span class="dcard__nm">' + esc(name) + '</span>' +
      (state === 'ro'
        ? '<span class="dcard__ro">읽기 전용</span>'
        : '<span class="dcard__dot' + (off ? ' is-off' : '') + '"></span>') +
    '</div>';
  }

  function devBody(d, inner) {
    if (pending[d.id]) {
      return '<div class="dsend"><span class="spinner"></span>' + esc(pending[d.id]) + ' 보내는 중</div>';
    }
    if (failed[d.id]) {
      return '<div class="dfail"><p>' + esc(failed[d.id]) + '<br>현장 스위치를 써 주세요</p>' +
        '<button data-retry="' + esc(d.id) + '">다시 시도</button></div>';
    }
    return inner;
  }

  /* 카드는 전부 2열 — SIOT 앱 카드 구조(제목 · 본문 · 조작), 라이트 테마 · 별 없음 (2026-09-29 69차 · 기기 C안의 「조명 · 냉난방 가로 전체」 폐기)
     조명 = SIOT 멀티 스위치 카드(스위치 묶음 세로) + 밝기 한 줄 */
  function cardLight(d, locked) {
    var inner =
      '<div class="swstack swstack--v">' + d.zones.map(function (z) {
        return '<button class="swstack__b' + (z.on ? ' is-on' : '') + '" data-light="' + esc(z.id) + '">' +
          icon('light') + esc(z.name) + '</button>';
      }).join('') + '</div>' +
      '<div class="drow"><span class="drow__l">밝기 <b class="tnum">' + d.brightness + '%</b></span>' +
        '<input class="slider" type="range" min="0" max="100" step="10" value="' + d.brightness +
        '" data-bright="1" aria-label="밝기" style="' + trackFill(d.brightness) + '"></div>';
    return '<div class="dcard' + (locked ? ' is-locked' : '') + '">' + lockBadge(locked) +
      devHead(d.name, null, d.status === 'OFFLINE') + devBody(d, inner) + '</div>';
  }

  /* 냉난방 = SIOT 리모컨(IR) 카드 — 카드에는 지금 상태만, 전원 · 온도 · 풍량은 「리모컨 제어」 창에서 (69차) */
  function cardHvac(d, locked) {
    var inner =
      '<div class="dcard__big tnum">' + (d.on ? d.target + '℃' : '꺼짐') + '</div>' +
      '<p class="dcard__sub">' + (d.on ? '풍량 ' + d.fan + '단' : '전원 꺼짐') + '</p>' +
      '<button class="dpill" data-remote="hvac">리모컨 제어</button>';
    return '<div class="dcard' + (locked ? ' is-locked' : '') + '">' + lockBadge(locked) +
      devHead(d.name, null, d.status === 'OFFLINE') + devBody(d, inner) + '</div>';
  }

  /* 리모컨 창 — 예전 카드의 조작 4개 그대로. 전송 중 · 실패도 카드와 같은 규칙(낙관적 UI 금지) */
  var remoteOpen = false;
  function hvacRemoteHtml(d) {
    var body =
      '<div class="dcard__big tnum">' + (d.on ? d.target + '℃' : '꺼짐') + '</div>' +
      '<div class="rmt">' +
        '<button class="rmt__b' + (d.on ? ' is-power' : '') + '" data-hvac="1">' + icon('power') + '전원</button>' +
        '<button class="rmt__b" data-fanstep="1">' + icon('temp') + '풍량 ' + d.fan + '단</button>' +
        '<button class="rmt__b' + (d.target <= d.min ? ' is-disabled' : '') + '" data-temp="-1">' + icon('minus') + '온도</button>' +
        '<button class="rmt__b' + (d.target >= d.max ? ' is-disabled' : '') + '" data-temp="1">' + icon('plus') + '온도</button>' +
      '</div>';
    return '<div class="remote">' + devBody(d, body) + '</div>';
  }
  function openRemote() {
    var d = deviceOf('hvac');
    if (!d) return;
    remoteOpen = true;
    openSheet({ title: d.name + ' 리모컨', body: hvacRemoteHtml(d), onClose: function () { remoteOpen = false; } });
  }

  function cardPlug(d, locked) {
    var on = d.channels.some(function (c) { return c.on; });
    var inner = '<div class="plug">' +
      '<button class="plug__c' + (on ? ' is-on' : '') + '" data-plug="' + esc(d.channels[0].id) + '">' +
        icon('power') + '</button>' +
      '<span class="plug__s' + (on ? ' is-on' : '') + '">' + (on ? 'ON' : 'OFF') + '</span>' +
    '</div>';
    return '<div class="dcard' + (locked ? ' is-locked' : '') + '">' + lockBadge(locked) +
      devHead(d.name, null, d.status === 'OFFLINE') + devBody(d, inner) + '</div>';
  }

  /* 도어는 web 제어 패널과 같은 모델 — 「문 열기」 한 번이면 잠깐 열리고 3초 뒤 저절로 잠긴다(열림 · 잠금 전환 없음 · 66차) */
  function cardDoor(d, locked) {
    var inner = '<div class="duo duo--one">' +
      '<button class="duo__b' + (!d.locked ? ' is-act' : '') + '" data-door="open">' +
        icon(d.locked ? 'unlock' : 'lock') + (d.locked ? '문 열기' : '열림 · 곧 잠김') + '</button>' +
    '</div>';
    return '<div class="dcard' + (locked ? ' is-locked' : '') + '">' + lockBadge(locked) +
      devHead(d.name, null, d.status === 'OFFLINE') + devBody(d, inner) + '</div>';
  }

  function cardBlind(d, locked) {
    var off = d.status === 'OFFLINE';
    var inner = '<div class="dcard__big tnum">' + (off ? '—' : '65%') + '</div>' +
      '<div class="dbar"><i style="width:' + (off ? 0 : 65) + '%"></i>' +
        (off ? '' : '<span style="left:65%"></span>') + '</div>' +
      '<div class="tri">' +
        '<button class="tri__b" data-blind="down">' + icon('down') + '</button>' +
        '<button class="tri__b" data-blind="stop">' + icon('stop') + '</button>' +
        '<button class="tri__b" data-blind="up">' + icon('up') + '</button>' +
      '</div>';
    return '<div class="dcard' + (off ? ' dcard--off' : '') + (locked ? ' is-locked' : '') + '">' +
      devHead(d.name, null, off) + devBody(d, inner) + '</div>';
  }

  function deviceCards(locked) {
    var dv = F.getDevices(ctlSpaceId());
    if (!dv) {
      return '<div class="empty">' + icon('plug', 'icon--lg') +
        '<p class="empty__text">이 회의실에는 연동된 기기가 없어요</p></div>';
    }
    var cards = [];
    dv.items.forEach(function (d) {
      if (d.kind === 'light') cards.push(cardLight(d, locked));
      else if (d.kind === 'hvac') cards.push(cardHvac(d, locked));
      else if (d.kind === 'plug') cards.push(cardPlug(d, locked));
      else if (d.kind === 'door') cards.push(cardDoor(d, locked));
      else if (d.kind === 'blind' && d.status !== 'OFFLINE') cards.push(cardBlind(d, locked));   /* 값 없는 타일은 숨긴다 (2026-09-23) */
    });
    return '<div class="dgrid">' + cards.join('') + '</div>';
  }

  /* 자동화 버튼 — 상단이 아니라 기기 섹션 안, 카드 위 한 줄(알약 버튼). 이름은 web 회의실 상세 › 연동 장비에서 지은 그대로 (69차) */
  function autoRow(locked) {
    var dv = F.getDevices(ctlSpaceId());
    if (!dv || !dv.scenes.length) return '';
    return '<div class="autorow">' + dv.scenes.map(function (s) {
      return '<button class="autobtn' + (sceneRunning === s.id ? ' is-running' : '') +
        (sceneDone === s.id ? ' is-done' : '') + (locked ? ' is-locked' : '') +
        '" data-scene="' + esc(s.id) + '">' + icon('bolt') + esc(s.name) +
        '<span class="autobtn__bar"></span></button>';
    }).join('') + '</div>';
  }

  /* 잠긴 타일임을 눈으로 알 수 있게 — 입실 전에는 모든 기기가 잠긴다. 예열 없음 · 점유한 시간 안에서 인증한 뒤에만 (2026-09-28 54차) */
  function lockBadge(locked) { return locked ? '<span class="dcard__lock">' + icon('lock', 'icon--sm') + '</span>' : ''; }


  function renderControl() {
    ensureCtl();
    var r = ctlTarget;

    if (!r) {
      $('#ctlTop').textContent = '';
      $('#ctlBody').innerHTML = '<div class="empty">' + icon('cal', 'icon--lg') +
        '<p class="empty__text">지금 조작할 수 있는 회의실이 없어요</p>' +
        '<button class="btn btn--sm btn--secondary empty__action" data-home>홈으로</button></div>';
      return;
    }

    var sp = F.getSpace(r.spaceId);
    $('#ctlTop').textContent = '';

    var live = r.status === 'CHECKED_IN';
    var total = F.diffMin(r.start, r.end);
    var pct = live ? Math.min(100, Math.max(0, Math.round(F.diffMin(r.start, M.NOW) / total * 100))) : 0;

    /* 히어로 — 상태 · 이름 · 진행 바 · 연장/퇴실 · 추가 버튼
       30분 연장 복원(57차)으로 퇴실은 53차 이전 자리로 — 종료 시각을 다루는 두 버튼을 진행 바 바로 아래 한 줄(2열)에.
       뒤 30분에 예약이 있으면 연장은 흐리게, 누르면 이유를 말한다 */
    var ext = live ? F.extendCheck(r.id) : null;
    /* 상단은 낮게 — 이름 + 상태 한 줄, 정보 + 시간 한 줄, 진행 바, 연장 · 퇴실. 자동화 버튼은 기기 섹션으로 옮겼다 (2026-09-29 69차) */
    var hero = '<div class="hero">' +
      '<div class="hero__top"><h1 class="hero__name">' + esc(sp.name) + '</h1>' + statusLine(r) + '</div>' +
      '<p class="hero__meta tnum">' + esc(F.spaceMeta(sp.id) + ' · ' + F.rangeLabel(r.start, r.end)) + '</p>' +
      '<div class="elapsed"><i style="width:' + pct + '%"></i></div>' +
      (live
        ? '<div class="btnrow">' +
            '<button class="btn btn--sm btn--secondary' + (ext.ok ? '' : ' is-blocked') + '" data-extend="' + esc(r.id) + '">30분 연장</button>' +
            '<button class="btn btn--sm btn--danger" data-exit="' + esc(r.id) + '">퇴실하기</button>' +
          '</div>'
        : '') +
    '</div>';

    var body;
    if (live) {
      /* 온습도 요약 줄은 뺐다 — 조작할 것만 (2026-09-30 70차) */
      body = '<div class="devwrap">' + '<p class="groupt" style="padding:0">기기</p>' +
        autoRow(false) + deviceCards(false) + '</div>' +
        '<button class="lognav" data-go="S-14b">제어 이력 보기' + icon('next') + '</button>';
    } else {
      /* 입실 전에는 전부 잠긴다(54차) — 「나머지도」가 아니다. 기기가 없는 방이면 안내도 없다 (65차) */
      body = '<div class="devwrap">' + qrBlock(r) +
        '<p class="groupt" style="padding:0">기기</p>' + autoRow(true) + deviceCards(true) +
        (F.getDevices(ctlSpaceId()) ? '<p class="hint">입실하면 조작할 수 있어요</p>' : '') + '</div>';
    }

    $('#ctlBody').innerHTML = hero + body;
    /* 리모컨 창이 열려 있으면 같은 값으로 다시 그린다 — 전송 중 · 확정이 창에도 보인다 */
    if (remoteOpen && isSheetOpen()) { var hd0 = deviceOf('hvac'); if (hd0) $('#sheetBody').innerHTML = hvacRemoteHtml(hd0); }

    /* QR 카운트다운은 화면이 살아 있는 동안만 */
    if (!live && F.canIssueCheckinCode(r) && qrLeft > 0 && !STILL) qrTick('#qrLeft');
  }

  var sceneRunning = null, sceneDone = null;

  function runScene(id) {
    if (!isCheckedIn() || sceneRunning) return;
    var plan = {
      'SC-1': [{ k: 'light', l: '모두 켜기', a: function (d) { d.zones.forEach(function (z) { z.on = true; }); d.brightness = 80; } },
               { k: 'hvac', l: '켜기', a: function (d) { d.on = true; d.target = 24; } }],
      'SC-2': [{ k: 'light', l: '스크린측 끄기', a: function (d) { d.zones[0].on = true; d.zones[1].on = false; d.brightness = 30; } },
               { k: 'plug', l: '빔프로젝터 켜기', a: function (d) { d.channels[0].on = true; } }],
      'SC-3': [{ k: 'light', l: '모두 끄기', a: function (d) { d.zones.forEach(function (z) { z.on = false; }); } },
               { k: 'hvac', l: '끄기', a: function (d) { d.on = false; } },
               { k: 'plug', l: '모두 끄기', a: function (d) { d.channels.forEach(function (c) { c.on = false; }); } }]
    }[id] || [];

    sceneRunning = id; sceneDone = null;
    renderControl();
    var i = 0;
    (function next() {
      if (i >= plan.length) {
        sceneRunning = null; sceneDone = id;
        renderControl();
        setTimeout(function () { sceneDone = null; renderControl(); }, 700);
        return;
      }
      var step = plan[i++], dev = deviceOf(step.k);
      if (!dev) { next(); return; }
      sendCommand(dev, step.l, function () { step.a(dev); }, function () { sceneRunning = id; next(); });
    })();
  }

  /** 도어 해제는 생체인증을 한 번 거친다 */
  function confirmDoor() {
    var d = deviceOf('door');
    if (!d || !d.locked) return;   /* 이미 열려 있으면 곧 저절로 잠긴다 */
    openSheet({
      title: '문을 열까요',
      body: '<p class="note">' + esc('본인 확인 후 ' + F.spaceName(ctlSpaceId()) + ' 문이 열리고 3초 뒤 잠겨요') + '</p>' +
        '<div class="empty" style="padding:var(--sp-5) 0 0">' + icon('finger', 'icon--lg') + '</div>',
      cta: {
        label: '지문으로 확인하기',
        onClick: function () {
          sendCommand(d, '문 열기', function () {
            d.locked = false;
            setTimeout(function () { d.locked = true; if (stack[stack.length - 1] === 'S-14') renderControl(); }, F.DOOR_RELOCK_MS);
          });
        }
      }
    });
  }

  /** 30분 연장 (RSV-08 · 57차 복원) — 뒤 30분이 비어 있으면 바로 늘리고, 막히면 이유만 말한다(확인 시트 없음) */
  function doExtend(id) {
    var res = F.extendReservation(id);
    if (!res.ok) { toast(res.reason); return; }
    renderControl(); renderHome(); renderMine();
    toast(hm(res.until) + '까지 연장했어요');
  }

  /* 퇴실 = web 회의실 버튼 「퇴실」에 매핑한 자동화 실행. 매핑이 없는 방이면 기기 이야기를 하지 않는다 (66차 · 예전 「기기가 모두 꺼져요」 고정) */
  function confirmExit(id) {
    var r = F.getReservation(id);
    var dv = F.getDevices(r.spaceId), auto = dv && dv.exitAuto;
    openSheet({
      title: '퇴실할까요',
      body: '<p class="note">' + esc(F.spaceName(r.spaceId) + ' 사용을 마쳐요' + (auto ? ' · 「' + auto + '」 자동화가 실행돼요' : '')) + '</p>',
      cta: {
        label: '퇴실하기', kind: 'danger',
        onClick: function () {
          F.runAutomation(r.spaceId, 'exit');
          r.status = 'USED';
          r.checkedOutAt = M.NOW;
          ctlTarget = null;
          goRoot();
          toast('퇴실했어요');
        }
      }
    });
  }


  /* ── 입실 QR — 예약이 발급하는 1회용 코드 ───────────────── */

  var qrLeft = M.QR_TTL_SEC, qrTimer = null;

  function qrPattern(code) {
    var N = 21, s = 7;
    for (var i = 0; i < code.length; i++) s = (s * 31 + code.charCodeAt(i)) & 0x7fffffff;
    function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
    function box(r, c) {
      return [[0, 0], [0, N - 7], [N - 7, 0]].some(function (p) {
        return r >= p[0] && r <= p[0] + 7 && c >= p[1] && c <= p[1] + 7;
      });
    }
    function finder(r, c) {
      return [[0, 0], [0, N - 7], [N - 7, 0]].some(function (p) {
        var dr = r - p[0], dc = c - p[1];
        if (dr < 0 || dr > 6 || dc < 0 || dc > 6) return false;
        return dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
      });
    }
    var cells = '';
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      cells += (box(r, c) ? finder(r, c) : rnd() > 0.5) ? '<i class="is-m"></i>' : '<i></i>';
    }
    return cells;
  }

  function qrLabel() {
    return Math.floor(qrLeft / 60) + ':' + (qrLeft % 60 < 10 ? '0' : '') + (qrLeft % 60);
  }

  function qrTick(sel) {
    clearInterval(qrTimer);
    qrTimer = setInterval(function () {
      qrLeft -= 1;
      var el = $(sel);
      if (!el) { clearInterval(qrTimer); return; }
      if (qrLeft <= 0) { clearInterval(qrTimer); qrLeft = 0; renderControl(); return; }
      el.textContent = qrLabel();
    }, 1000);
  }

  /* 입실 전 — 체크인은 스캐너(S-12)에서. 아직 시각이 아니면 몇 분 뒤인지 */
  function qrBlock(r) {
    var early = !F.canIssueCheckinCode(r);
    var mins = F.diffMin(M.NOW, r.start) - M.QR_OPEN_MIN;
    if (F.isFreeSpace(r.spaceId) || F.isReaderSpace(r.spaceId)) {
      return '<div class="qrcard">' +
        '<div class="qrcard__h"><span class="dcard__nm">입실</span>' +
          '<span class="dcard__ro">' + esc(F.isReaderSpace(r.spaceId) ? '문 앞 리더기에 인식하면 시작' : F.hm(r.start) + '에 자동으로 시작') + '</span></div>' +
      '</div>';
    }
    /* 입실 시각 전에는 흐린 버튼 — 누르면 이유만 말하고 스캐너로 가지 않는다 (65차 · 30분 연장과 같은 방식) */
    return '<div class="qrcard">' +
      '<div class="qrcard__h"><span class="dcard__nm">입실</span>' +
        (early && mins > 0 ? '<span class="dcard__ro tnum">' + esc(mins + '분 뒤부터') + '</span>' : '') + '</div>' +
      '<button class="btn btn--primary' + (early ? ' is-blocked' : '') + '" style="width:100%" data-scan="' + esc(r.id) + '">' + icon('qr', 'icon--sm') + '체크인</button>' +
    '</div>';
  }

  /* ── S-12 QR 체크인 — 앱이 회의실 앞 태블릿의 QR을 읽는다 (2026-09-22) ──
     성공: 예약 CHECKED_IN → 도어 해제 → 제어 페이지로 바뀐다. 코드 6자리는 대체 경로.
     프로토타입: 카메라 영역을 누르면 읽힌 것으로 본다. 결과는 툴바의 리더기 모드(success/fail/early)를 따른다 */
  var scanCode = '', scanBusy = false, scanTimer = null;

  /** now = 지금 입실할 수 있는 예약만(다가오는 예약으로 떨어지지 않는다) */
  function scanTarget(now) {
    return ctlTarget && ctlTarget.status !== 'CHECKED_IN' && F.canIssueCheckinCode(ctlTarget) ? ctlTarget
      : (F.checkinTarget() || (now ? null : F.myReservations('upcoming')[0]) || null);
  }

  function renderScan() {
    var boxes = '';
    for (var i = 0; i < 6; i++) boxes += '<i class="' + (i === scanCode.length ? 'is-on' : '') + '">' + esc(scanCode[i] || '') + '</i>';
    $('#scanSheet').innerHTML =
      /* 기기 이름은 관리자 web 63차와 같게 — 문 앞 「예약 현황판」 (65차 · 옛 「태블릿」) */
      '<span class="scan__t">코드로 입력</span>' +
      '<p class="scan__s">현황판에 보이는 6자리</p>' +
      '<div class="codebox">' + boxes +
        '<input id="scanInput" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" value="' + esc(scanCode) + '" aria-label="체크인 코드">' +
      '</div>';
    var h = $('#scanHint');
    h.className = 'scan__hint';
    h.textContent = '문 앞 예약 현황판의 QR을 비추세요';
    $('.scan__frame').classList.remove('is-busy');
  }

  function scanFail(msg) {
    var h = $('#scanHint');
    h.className = 'scan__hint is-bad';
    h.textContent = msg;
    $('.scan__frame').classList.remove('is-busy');
    scanBusy = false; scanCode = '';
    var inp = $('#scanInput'); if (inp) inp.value = '';
    $$('.codebox i').forEach(function (b, i) { b.textContent = ''; b.classList.toggle('is-on', i === 0); });
  }

  /** QR을 읽었거나 코드 6자리가 찼다 */
  /** 고른 회사에 입실할 예약이 없으면 다른 소속 회사에서 찾는다 — 실제로는 QR이 회의실(= 회사)을 알려 준다 (72차) */
  function scanOtherCo() {
    var home = coCode, found = null;
    if (!home) return null;
    myMembers().forEach(function (m) {
      var k = upper(m.companyCode), co = A.company(k);
      if (found || m.status !== 'ACTIVE' || k === home || !co) return;
      F.useCompany(co.key);
      var t = F.checkinTarget();
      if (t) found = { code: k, id: t.id };
    });
    F.useCompany(A.company(home).key);
    if (!found) return null;
    /* 예약 객체는 회사 데이터가 바뀌어도 같다 — 회사 전환은 입실이 성공할 때 한다 */
    F.useCompany(A.company(found.code).key);
    var r = F.getReservation(found.id);
    F.useCompany(A.company(home).key);
    return { code: found.code, r: r };
  }

  function scanSubmit(how) {
    if (scanBusy) return;
    var other = null, r = scanTarget(true);
    if (!r) { other = scanOtherCo(); r = other ? other.r : scanTarget(); }
    if (!r) {
      var fr0 = F.myReservations('upcoming')[0];
      scanFail(fr0 && F.isReaderSpace(fr0.spaceId) ? '이 회의실은 리더기로 입실해요' : fr0 && F.isFreeSpace(fr0.spaceId) ? '이 회의실은 QR 없이 이용해요' : '지금 입실할 예약이 없어요');
      return;
    }
    if (F.isReaderSpace(r.spaceId)) { scanFail('이 회의실은 리더기로 입실해요'); return; }
    if (F.isFreeSpace(r.spaceId)) { scanFail('이 회의실은 QR 없이 이용해요'); return; }   /* 인증 없는 방 — 시작 시각에 저절로 열린다 */
    scanBusy = true;
    $('.scan__frame').classList.add('is-busy');
    $('#scanHint').textContent = how === 'code' ? '확인하는 중' : '읽는 중';
    clearTimeout(scanTimer);
    scanTimer = setTimeout(function () {
      if (readerMode === 'fail') { scanFail(how === 'code' ? '코드가 맞지 않아요' : '읽을 수 없는 QR이에요'); return; }
      if (readerMode === 'early' || (!other && !F.canIssueCheckinCode(r))) {
        scanFail(F.hm(r.start) + '부터 입실할 수 있어요'); return;
      }
      if (other) useCo(other.code);   /* QR이 알려 준 회사로 바꾼다 (72차) */
      r.status = 'CHECKED_IN';
      r.checkedInAt = M.NOW;
      /* 입실 = 문이 잠깐 열리고(3초 뒤 잠김) + web 회의실 버튼 「입실」에 매핑한 자동화 실행 (66차) */
      var dv = F.getDevices(r.spaceId), door = null;
      if (dv) dv.items.forEach(function (d) { if (d.kind === 'door') door = d; });
      if (door) {
        door.locked = false;
        F.addLog(r.spaceId, '도어락', '문 열기', 'OK');
        setTimeout(function () { door.locked = true; if (stack[stack.length - 1] === 'S-14') renderControl(); }, F.DOOR_RELOCK_MS);
      }
      F.runAutomation(r.spaceId, 'entry');
      scanBusy = false; scanCode = '';
      ctlTarget = r; readerMsg = '';
      closeRow(); renderHome(); renderMine();
      /* 스캐너 자리를 제어 페이지로 바꾼다 — 뒤로 가면 스캐너가 아니라 원래 화면 */
      var base = stack.slice(0, -1);
      apply(base.concat(['S-14']), 'push');
      history.replaceState({ stack: stack.slice() }, '', '#S-14');
      toast(other ? A.company(other.code).name + ' 회의실이에요 · 입실했어요' : '입실했어요 · 문이 열렸어요');
    }, 900);
  }

  /** 예전 리더기 시뮬레이션 자리 — 스캐너로 넘긴다 */
  function runReader() { push('S-12'); }


  /* ============================================================
     S-14b 제어 이력
     ============================================================ */

  function renderLog() {
    ensureCtl();
    var groups = F.groupedLog(ctlSpaceId());
    if (!groups.length) {
      $('#logBody').innerHTML = '<div class="empty">' + icon('history', 'icon--lg') +
        '<p class="empty__text">아직 조작 기록이 없어요</p></div>';
      return;
    }
    $('#logBody').innerHTML = groups.map(function (g) {
      return '<div class="block">' +
        '<p class="groupt" style="padding:0 0 var(--sp-2)">' + esc(g.label) + '</p>' +
        g.items.map(function (l) {
          var fail = l.result === 'FAIL';
          return '<button class="logrow"' + (fail ? ' data-logfail="' + esc(l.id) + '"' : '') + '>' +
            '<span class="logrow__t tnum">' + F.hm(l.at) + '</span>' +
            '<span class="logrow__m">' +
              '<span class="logrow__w">' + esc(l.device + ' · ' + l.action) + '</span>' +
              '<span class="logrow__who">' + esc(l.auto ? '자동' : F.userName(l.actorId)) + '</span>' +
            '</span>' +
            '<span class="logrow__r' + (fail ? ' is-fail' : '') + '">' + (fail ? '실패' : '완료') + '</span>' +
          '</button>';
        }).join('') +
      '</div>';
    }).join('');
  }


  /* ============================================================
     S-15 예약 상세
     ============================================================ */

  var rsvTarget = null;

  /* 버튼 이름은 홈 오늘 카드와 같게 — 「기기 제어」 · 「체크인」 (65차) */
  function rsvPrimary(r) {
    if (r.status === 'CHECKED_IN') return { label: '기기 제어', act: 'ctl' };
    if (r.status === 'APPROVED' && F.canIssueCheckinCode(r)) return { label: '체크인', act: 'scan' };
    /* 예정 예약의 하단 버튼은 「예약 취소하기」 — 더보기에 숨기지 않는다 (2026-09-23 저녁)
       체크인은 탭바 가운데 버튼과 오늘 예약 카드가 갖는다 */
    if (r.status === 'APPROVED') return { label: '예약 취소하기', act: 'cancel', kind: 'danger' };
    return { label: '같은 회의실 다시 예약', act: 'again' };
  }

  function renderRsv() {
    if (rsvTarget && rsvTarget.userId !== M.me.id) rsvTarget = null;   /* 남의 예약은 열지 않는다 (72차) */
    if (!rsvTarget) rsvTarget = F.myReservations('upcoming')[0] || F.myReservations()[0];
    if (!rsvTarget) { $('#rsvBody').innerHTML = ''; $('#rsvCta').innerHTML = ''; return; }
    var r = rsvTarget, sp = F.getSpace(r.spaceId);

    /* 이름은 위 제목에 있다 — 「회의실」 행은 인원 · 층 · 유형만 (65차) */
    var rows = [
      ['회의실', F.spaceMeta(sp.id)],
      ['일시', F.dateLabel(r.start) + ' ' + F.rangeLabel(r.start, r.end)],
      ['참석 인원', (r.headcount || 1) + '명'],   /* web 예약 상세와 같은 이름 (66차) */
      ['예약번호', r.id]
    ];
    if (r.checkedInAt) rows.push(['입실', F.hm(r.checkedInAt)]);
    if (r.checkedOutAt) rows.push(['퇴실', F.hm(r.checkedOutAt)]);
    if (r.canceledAt) rows.push(['취소', F.dateLabel(r.canceledAt) + ' ' + F.hm(r.canceledAt)]);
    /* web 강제 취소는 사유가 필수다 — 누가 · 왜를 앱에서도 보인다 (66차) */
    if (r.canceledBy === 'admin') rows.push(['취소 사유', '관리자 · ' + (r.cancelReason || '—')]);

    $('#rsvBody').innerHTML =
      '<div class="rsvhead">' + statusLine(r) +
        '<h1 class="rsvhead__name">' + esc(sp.name) + '</h1></div>' +
      '<div class="block"><div class="deflist">' + rows.map(function (kv) {
        return '<div class="defrow"><span class="defrow__k">' + esc(kv[0]) + '</span>' +
          '<span class="defrow__v">' + esc(kv[1]) + '</span></div>';
      }).join('') + '</div></div>' +
      /* 입실 창(시작 10분 전)에는 하단이 「QR 체크인」이라 취소를 본문 끝에 둔다 — 더보기에 숨기지 않는다 (2026-09-23 저녁) */
      (r.status === 'APPROVED' && F.canIssueCheckinCode(r)
        ? '<button class="btn btn--danger btn--sm" style="width:100%" data-rsvact="cancel">예약 취소하기</button>' : '');

    /* ⋯ 메뉴는 사용 중일 때만(제어 이력 보기) — 비어 있는 시트를 열지 않는다. 제목 가운데 정렬을 지키려고 자리는 남긴다 (65차) */
    $('#rsvMore').style.visibility = r.status === 'CHECKED_IN' ? '' : 'hidden';

    var p = rsvPrimary(r);
    $('#rsvCta').innerHTML = p
      ? '<button class="btn btn--' + (p.kind || 'primary') + '" data-rsvact="' + p.act + '">' + esc(p.label) + '</button>'
      : '';
  }

  function openRsvMore() {
    var r = rsvTarget;
    var acts = [];
    if (r.status === 'CHECKED_IN') acts.push({ act: 'log', label: '제어 이력 보기' });
    openSheet({
      title: '예약 관리',
      body: '<div class="rowlist">' + acts.map(function (a) {
        return '<button class="row" data-rsvact="' + a.act + '">' +
          '<span class="row__main"><span class="row__title">' + esc(a.label) + '</span></span>' +
          '<span class="row__trail">' + icon('next') + '</span></button>';
      }).join('') + '</div>'
    });
  }

  /* 취소 확인 — 실행 1개 + 우상단 X. 「그대로 두기」는 없다.
     퇴실 · 로그아웃 · 도어 시트처럼 제목 + 한 줄 설명 (65차) */
  function confirmCancel() {
    var r = rsvTarget;
    openSheet({
      title: '예약을 취소할까요',
      body: '<p class="note">' + esc(F.spaceName(r.spaceId) + ' ' + F.dateLabel(r.start) + ' ' + F.rangeLabel(r.start, r.end) + ' 예약이 취소돼요') + '</p>',
      cta: {
        label: '예약 취소하기', kind: 'danger',
        onClick: function () {
          r.status = 'CANCELED';
          r.canceledAt = M.NOW;
          closeRow(); renderHome(); renderMine();
          /* 취소하면 상세에 머물 이유가 없다 — 내 예약 목록으로 (2026-09-23) */
          goTab('S-16');
          toast('예약을 취소했어요');
        }
      }
    });
  }


  /* ============================================================
     S-24 검색
     ============================================================ */

  var searchQ = '';

  function renderSearch() {
    $('#searchInput').value = searchQ;
    if (!searchQ.trim()) {
      $('#searchBody').innerHTML =
        '<div class="block"><p class="groupt" style="padding:0 0 var(--sp-2)">최근 검색어</p>' +
          '<div class="chiprow">' + M.recentSearches.map(function (k) {
            return '<button class="chip" data-kw="' + esc(k) + '">' + esc(k) + '</button>';
          }).join('') + '</div></div>';
      /* 추천 키워드 제거 (2026-09-28 사용자 결정) — 최근 검색어만 남긴다 */
      return;
    }
    var found = F.searchSpaces(searchQ);
    if (!found.length) {
      $('#searchBody').innerHTML = '<div class="empty">' + icon('search', 'icon--lg') +
        '<p class="empty__text">' + esc('‘' + searchQ + '’ 검색 결과가 없어요') + '</p></div>';   /* 조사를 붙이지 않는다 (65차) */
      return;
    }
    $('#searchBody').innerHTML = '<div class="block"><div class="rowlist">' + found.map(function (s) {
      return '<button class="row" data-jump="' + esc(s.id) + '">' +
        '<span class="row__main"><span class="row__title">' + esc(s.name) + '</span>' +
          '<span class="row__sub">' + esc(F.spaceMeta(s.id)) + '</span></span>' +
        '<span class="row__trail">' + availLine(s.id) + '</span></button>';
    }).join('') + '</div></div>';
  }


  /* ============================================================
     S-18 나
     ============================================================ */

  function renderMy() {
    if (!user) { $('#myBody').innerHTML = ''; return; }
    /* 지난 예약은 「내 예약」 탭의 「지난」 세그먼트가 갖는다 — 여기서 반복하지 않는다 */
    var menu = [];
    /* 알림 설정 — 무엇을 보낼지는 관리자 web, 이 폰에서 울릴지는 여기서 (2026-09-30 70차 · 67차 삭제를 되살림) */
    menu.push({ id: 'S-20', name: '알림 설정' });
    if (user.provider === 'phone') menu.push({ id: 'S-28', name: '비밀번호 변경' });   /* 간편 로그인은 비밀번호가 없다 (72차) */
    menu.push({ id: 'logout', name: '로그아웃' });
    var pv = PROVIDER[user.provider] || '';

    $('#myBody').innerHTML =
      '<div class="profile"><span class="avatar">' + esc(user.name.charAt(0)) + '</span>' +
        '<span class="row__main"><span class="profile__n">' + esc(user.name) + '</span>' +
        '<span class="profile__m tnum">' + esc(user.phone) + ' · ' + esc(pv) + ro(pv) + ' 로그인</span></span></div>' +
      /* 내 회사 — 소속마다 부서 · 직급 · 상태. 누르면 상세(바꾸기 · 다시 신청) (72차) */
      '<div class="block"><p class="groupt" style="padding:0 0 var(--sp-2)">내 회사</p><div class="rowlist">' +
        myMembers().map(function (m) {
          var co = A.company(m.companyCode), cur = m.status === 'ACTIVE' && upper(m.companyCode) === coCode;
          return '<button class="row" data-comember="' + esc(m.id) + '">' +
            '<span class="row__main"><span class="row__title">' + esc(co ? co.name : m.companyCode) + '</span>' +
            '<span class="row__sub">' + esc(memberLine(m) || '—') + '</span></span>' +
            '<span class="row__trail">' + (cur ? '<span class="status status--brand">현재</span>' : m.status === 'ACTIVE' ? '' : mstatHtml(m)) +
            icon('next') + '</span></button>';
        }).join('') +
        '<button class="row" data-coadd><span class="row__main"><span class="row__title">회사 추가</span></span>' +
          '<span class="row__trail">' + icon('plus') + '</span></button>' +
      '</div></div>' +
      '<div class="block"><div class="rowlist">' + menu.map(function (m) {
        return '<button class="row" data-menu="' + esc(m.id) + '">' +
          '<span class="row__main"><span class="row__title">' + esc(m.name) + '</span></span>' +
          '<span class="row__trail">' + icon('next') + '</span></button>';
      }).join('') + '</div></div>' +
      '<button class="login__link acctdel" data-acctdel>계정 삭제</button>';   /* 앱 심사 요건 — 앱 안에서 계정을 지울 수 있어야 한다 (74차) */
  }

  /* ============================================================
     S-20 알림 설정 (이 폰에서 울릴지 · 70차) · S-21 알림함
     ============================================================ */


  /* 알림 설정 — 무엇을 보낼지는 관리자 web이 정한다(정책). 여기서는 이 폰에서 울릴지만 — 전체 스위치 + 관리자가 켠 종류별 (2026-09-30 70차)
     리마인드 시점은 web 값을 보여 주기만 한다 */
  /* 74차 — 회사마다 묶는다(정책이 회사마다 다르다). 「가입 결과」는 회사가 끌 수 없는 계정 알림 — 이 폰에서 울릴지만 */
  function renderNotifySet() {
    var n = M.notifySettings;
    function sw(key, on, label) {
      return '<button class="switch' + (on ? ' is-on' : '') + '" data-noti="' + esc(key) + '" role="switch" aria-checked="' + on + '" aria-label="' + esc(label) + '"></button>';
    }
    $('#notifySetBody').innerHTML =
      '<div class="block"><div class="setrow"><span class="setrow__n">이 폰에서 알림 받기</span>' +
        '<button class="switch' + (n.all ? ' is-on' : '') + '" data-notiall role="switch" aria-checked="' + n.all + '" aria-label="이 폰에서 알림 받기"></button></div></div>' +
      '<div class="block' + (n.all ? '' : ' is-off') + '"><p class="groupt" style="padding:0 0 var(--sp-2)">내 계정</p>' +
        n.account.map(function (it) {
          return '<div class="setrow"><span class="setrow__n">' + esc(it.name) + '<span class="setrow__s">승인 · 반려 · 퇴사</span></span>' +
            sw('_account|' + it.id, it.on, it.name) + '</div>';
        }).join('') + '</div>' +
      n.groups.map(function (g) {
        return '<div class="block' + (n.all ? '' : ' is-off') + '"><p class="groupt" style="padding:0 0 var(--sp-2)">' + esc(g.name) + '</p>' +
          g.items.map(function (it) {
            return '<div class="setrow"><span class="setrow__n">' + esc(it.name) +
                (it.id === 'remind' ? '<span class="setrow__s">시작 ' + g.remindBefore + '분 전</span>' : '') + '</span>' +
              sw(g.code + '|' + it.id, it.on, g.name + ' ' + it.name) + '</div>';
          }).join('') + '</div>';
      }).join('');
  }

  function allNotis() {
    return memberNotis().concat(hasCo() ? F.myNotifications() : []).sort(function (a, b) { return b.at - a.at; });
  }

  function renderNotify() {
    var groups = [];
    allNotis().forEach(function (n) {   /* 가입 결과(계정 · 74차) + 고른 회사 · 내 알림(72차) */
      var key = F.ymd(n.at), g = null;
      groups.forEach(function (x) { if (x.key === key) g = x; });
      if (!g) { g = { key: key, label: F.dateLabel(n.at), items: [] }; groups.push(g); }
      g.items.push(n);
    });
    if (!groups.length) {
      $('#notifyBody').innerHTML = '<div class="empty">' + icon('bell', 'icon--lg') +
        '<p class="empty__text">받은 알림이 없어요</p></div>';
      return;
    }
    $('#notifyBody').innerHTML = groups.map(function (g) {
      return '<div class="block"><p class="groupt" style="padding:0">' + esc(g.label) + '</p>' +
        g.items.map(function (n) {
          return '<button class="noti' + (n.read ? '' : ' is-unread') + '" data-notigo="' + esc(n.id) + '">' +
            '<span class="noti__t">' + esc(n.title) + '</span>' +
            '<span class="noti__b">' + esc(n.body) + '</span>' +
            '<span class="noti__at tnum">' + esc(F.hm(n.at)) + '</span></button>';
        }).join('') + '</div>';
    }).join('');
  }


  /* ============================================================
     플랫폼 계정 — 앱 계정 하나 + 회사마다 소속 (2026-09-30 72차 · 개발자 미팅 피드백)
       · 로그인 = 간편 로그인(카카오 · 네이버 · Apple · Google) 또는 휴대폰 번호 + 비밀번호. 이메일 없음 · 문자 인증 없음(추후)
       · 가입하면 회사 없는 빈 홈 → 회사코드 → 사번 · 부서 · 직급(그 회사 web 설정의 목록) → 승인 대기
       · 소속은 여러 개. 홈 헤더에서 회사를 바꾸고, 내 예약 · 알림은 고른 회사 것만 보인다
       · 저장 규약은 accounts.js 머리 주석이 정본
     ============================================================ */

  var user = null;          /* 로그인한 앱 계정 — null이면 로그아웃 */
  var coCode = null;        /* 지금 고른 회사코드 — 승인된(ACTIVE) 소속만 고를 수 있다 */
  var memberSnap = {};      /* 소속 상태 스냅샷 — web이 승인 · 반려하면 무엇이 바뀌었는지 비교한다 */

  var PROVIDER = { phone: '휴대폰 번호', kakao: '카카오', naver: '네이버', apple: 'Apple', google: 'Google' };
  var MSTAT = { ACTIVE: ['정상', 'ok'], PENDING: ['승인 대기', 'warn'], REJECTED: ['반려', 'danger'], RETIRED: ['퇴사', 'dim'] };

  /** 조사 「로 / 으로」 — 받침이 있으면(ㄹ 제외) 으로 */
  function ro(w) {
    var s = String(w), c = s.charCodeAt(s.length - 1) - 0xAC00;
    if (c < 0 || c > 11171) return '로';
    var j = c % 28;
    return j && j !== 8 ? '으로' : '로';
  }
  function upper(s) { return String(s || '').trim().toUpperCase(); }

  function myMembers() { return user ? A.membersOf(user.id) : []; }
  function activeOf(code) {
    var k = upper(code);
    return myMembers().filter(function (m) { return m.status === 'ACTIVE' && upper(m.companyCode) === k && A.company(m.companyCode); })[0] || null;
  }
  function curMember() { return coCode ? activeOf(coCode) : null; }
  function hasCo() { return !!curMember(); }
  function snapMembers() { var o = {}; myMembers().forEach(function (m) { o[m.id] = m.status; }); return o; }

  /** 「나」를 로그인한 계정 + 고른 회사의 소속으로 채운다 — 부서는 경로, 직급 서열은 그 회사 것 */
  function applyMe() {
    var m = curMember();
    var p = { id: user ? user.id : A.DEMO_ID, name: user ? user.name : '', phone: user ? user.phone : '',
              provider: user ? user.provider : '', empNo: '', dept: '', deptPath: [], title: '' };
    if (m) {
      var o = A.org(m.companyCode), path = A.deptPath(o, m.deptId);
      p.empNo = m.empNo; p.deptPath = path; p.dept = path[path.length - 1] || '';
      p.title = A.rankName(o, m.rankId);
      p.ranks = A.rankList(o).map(function (r) { return r.name; });
    }
    F.setMe(p);
    M.notifySettings = F.readNotify(activeCos());   /* 알림 설정은 내 정상 소속 회사마다 (74차) */
  }
  function activeCos() {
    return myMembers().filter(function (m) { return m.status === 'ACTIVE' && A.company(m.companyCode); }).map(function (m) {
      var co = A.company(m.companyCode);
      return { code: co.code, name: co.name, web: co.code === A.webCode() };
    });
  }

  /** 회사 고르기 — 그 회사 데이터로 갈아 끼우고 화면 상태를 처음으로. 코드가 없거나 승인 전이면 첫 번째 승인된 회사 */
  function useCo(code) {
    var m = code ? activeOf(code) : null;
    if (!m) m = myMembers().filter(function (x) { return x.status === 'ACTIVE' && A.company(x.companyCode); })[0] || null;
    coCode = m ? upper(m.companyCode) : null;
    if (m) F.useCompany(A.company(coCode).key);
    applyMe();
    resetCompanyUi();
    if (user && !noSes()) A.setSession({ userId: user.id, co: coCode });
  }

  /** 회사를 바꾸면 그 회사의 공간 그룹 · 조건 · 열린 행이 남으면 안 된다 */
  function resetCompanyUi() {
    closeRow(); homePath = []; homeCap = false;
    STEP = M.SLOT_MIN;   /* 기본 예약 단위는 회사마다 (74차) */
    FIND_STEP = M.spaces.reduce(function (mn, s) { return Math.min(mn, F.slotMinOf(s.id)); }, STEP);
    LEAD_DAYS = M.spaces.reduce(function (mx, s) { return s.maintenance ? mx : Math.max(mx, s.policy.maxLeadDays || 0); }, 0);
    initQuery(); findOpen = { id: '', people: 4 };
    ctlTarget = null; rsvTarget = null; lastBooked = null; searchQ = ''; mineTab = 'upcoming'; remoteOpen = false;
  }

  /** 세션을 쓰지 않는 열기 — 미리보기(?still=1)와 로그인 화면이 없는 화면별 파일(화면/*.html). 늘 데모 계정 (72차) */
  function noSes() { return STILL || !known('S-02'); }

  function signIn(u) {
    user = u;
    var ses = noSes() ? null : A.session();
    useCo(ses && ses.userId === u.id ? ses.co : null);
    memberSnap = snapMembers();
    /* 연출용 회사에 신청해 둔 채 새로 고쳤으면 그 승인을 다시 건다 */
    myMembers().forEach(function (m) { var co = A.company(m.companyCode); if (m.status === 'PENDING' && co && co.autoApprove) autoApprove(m.id); });
  }

  /* 연출용 회사(회사코드 1111)는 관리자 web이 없다 — 앱이 관리자 대신 이만큼 뒤에 승인한다 (73차) */
  var AUTO_APPROVE_MS = 5000;
  function autoApprove(mid) {
    setTimeout(function () {
      if (A.decideMember(mid, 'ACTIVE')) syncMembers();
    }, AUTO_APPROVE_MS);
  }

  /** 소속이 바뀌었을 때 — web이 다른 탭에서 바꿨거나(storage) 연출용 회사가 저절로 승인됐을 때.
      승인되면 토스트에 「보기」 — 누르면 그 회사 홈으로 (72 · 73차) */
  function syncMembers() {
    if (!user) return;
    var before = memberSnap, msg = '', okCode = '';
    myMembers().forEach(function (m) {
      if (before[m.id] === m.status) return;
      var co = A.company(m.companyCode), n = co ? co.name : m.companyCode;
      if (m.status === 'ACTIVE') { msg = n + ' 가입이 승인됐어요'; okCode = upper(m.companyCode); }
      else if (m.status === 'REJECTED') msg = n + ' 가입이 반려됐어요';
      else if (m.status === 'RETIRED' && m.retiredBy !== 'self') {
        /* 퇴사 처리 = 남은 예약 취소 (74차 확정). 프로토타입은 앱이 대신 취소하고 수를 소속에 적는다 · 제품은 서버 */
        var cn = m.canceledRsv;
        if (cn === undefined && co) { cn = F.cancelMine(co.key, user.id, '퇴사 처리', 'admin'); A.patchMember(m.id, { canceledRsv: cn }); }
        msg = n + ' 소속이 끝났어요' + (cn ? ' · 남은 예약 ' + cn + '건은 취소됐어요' : '');
      }
    });
    memberSnap = snapMembers();
    var was = coCode, top = stack[stack.length - 1];
    if (!curMember()) useCo(null); else applyMe();   /* 보던 회사가 끝났거나, 회사가 없다가 승인됐으면 다시 고른다 */
    if (coCode !== was && ['S-05', 'S-06', 'S-16', 'S-18', 'S-25'].indexOf(top) === -1) {
      if (animating) setTimeout(goRoot, ANIM_MS + 20); else goRoot();
    } else if (top !== 'S-28') paint(top);   /* 비밀번호 칸은 저장해 두지 않으므로 다시 그리지 않는다 */
    if (!msg) return;
    if (okCode && okCode !== coCode) toast(msg, { action: '보기', onAction: function () { goRoot(); switchCo(okCode); } });
    else toast(msg);
  }
  function signOut() {
    user = null; coCode = null; memberSnap = {};
    if (!noSes()) A.setSession({ userId: null });
  }

  /** 회사를 바꾼다 — 홈 헤더 시트 · 마이 */
  function switchCo(code) {
    useCo(code);
    paint(stack[stack.length - 1]);
    var co = A.company(code);
    if (co) toast(co.name + ro(co.name) + ' 바꿨어요');
  }

  /* 소속 한 줄 — 「디지털본부 › 상품개발팀 · 과장」 */
  function memberLine(m) {
    var o = A.org(m.companyCode);
    return [A.deptPath(o, m.deptId).join(' › '), A.rankName(o, m.rankId)].filter(Boolean).join(' · ');
  }
  function mstatHtml(m) {
    var s = m.status === 'RETIRED' && m.retiredBy === 'self' ? ['나감', 'dim'] : (MSTAT[m.status] || ['', 'muted']);
    return '<span class="status status--' + s[1] + '">' + esc(s[0]) + '</span>';
  }
  function memberRowsHtml(m) {
    var o = A.org(m.companyCode);
    var rows = [['사번', m.empNo], ['부서', A.deptPath(o, m.deptId).join(' › ')], ['직급', A.rankName(o, m.rankId)],
                ['신청', applyLabel(m.appliedAt)]];
    return '<div class="waitlist">' + rows.map(function (r) {
        return '<div class="waitrow"><span class="waitrow__k">' + r[0] + '</span><span class="waitrow__v">' + esc(r[1] || '—') + '</span></div>';
      }).join('') +
      (m.status === 'REJECTED' && m.rejectReason
        ? '<div class="waitrow waitrow--why"><span class="waitrow__k">반려 사유</span><span class="waitrow__v">' + esc(m.rejectReason) + '</span></div>'
        : '') +
      '</div>';
  }

  function applyLabel(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return F.dateLabel(d) + ' ' + F.hm(d);   /* 앱 공통 날짜 「9월 6일 (일)」 (65차) */
  }

  /* ── 홈 헤더의 회사 · 회사 없는 홈 ─────────────────────── */

  function coSwHtml() {
    return '<button class="cosw" data-cosheet aria-label="회사 바꾸기">' +
      esc(hasCo() ? M.branding.companyName : '회사 추가') + icon('down') + '</button>';
  }

  /** 회사 고르기 시트 — 승인된 회사는 누르면 바로 바뀌고, 나머지는 상태를 보여 준다 */
  function openCoSheet() {
    var l = myMembers();
    if (!l.length) { openJoin(''); return; }
    openSheet({
      title: '회사',
      body: '<div class="cosheet">' + l.map(function (m) {
          var co = A.company(m.companyCode), on = m.status === 'ACTIVE' && upper(m.companyCode) === coCode;
          return '<button class="corow' + (on ? ' is-on' : '') + '" data-cosw="' + esc(m.id) + '">' +
            '<span class="row__main"><span class="corow__n">' + esc(co ? co.name : m.companyCode) + '</span>' +
            '<span class="corow__s">' + esc(co ? co.site : '') + '</span></span>' +
            (on ? icon('check') : m.status === 'ACTIVE' ? '' : mstatHtml(m)) + '</button>';
        }).join('') +
        '<button class="corow corow--add" data-coadd>' + icon('plus') +
          '<span class="row__main"><span class="corow__n">회사 추가</span></span></button>' +
      '</div>'
    });
  }

  /** 소속 한 건 — 상태 · 사번 · 부서 · 직급. 승인된 다른 회사면 바꾸기, 반려 · 퇴사면 다시 신청 */
  function openMemberSheet(m) {
    var co = A.company(m.companyCode) || { name: m.companyCode, site: '' };
    var cta = null;
    if (m.status === 'ACTIVE' && upper(m.companyCode) !== coCode) {
      cta = { label: '이 회사로 바꾸기', onClick: function () { switchCo(m.companyCode); } };
    } else if (m.status === 'REJECTED' || m.status === 'RETIRED') {
      cta = { label: '다시 신청하기', onClick: function () { openJoin(m.companyCode, m); } };
    }
    openSheet({
      title: esc(co.name) + '<span>' + esc(co.site) + '</span>',
      body: '<div class="waitlist"><div class="waitrow"><span class="waitrow__k">상태</span><span class="waitrow__v">' + mstatHtml(m) +
          (m.status === 'ACTIVE' && upper(m.companyCode) === coCode ? ' <span class="note">· 지금 보고 있어요</span>' : '') + '</span></div></div>' +
        memberRowsHtml(m) +
        (m.status === 'PENDING' ? '<p class="note" style="margin-top:var(--sp-4)">관리자가 승인하면 알림으로 알려 드려요</p>' : '') +
        /* 나가기 · 신청 취소 — 파괴적 동작은 글자로만, 누르면 확인 시트 (74차) */
        (m.status === 'ACTIVE' ? '<button class="sheetlink" data-coleave="' + esc(m.id) + '">이 회사에서 나가기</button>' : '') +
        (m.status === 'PENDING' ? '<button class="sheetlink" data-cocancel="' + esc(m.id) + '">신청 취소하기</button>' : ''),
      cta: cta
    });
  }

  /** 이 회사에서 나가기 — 본인 요청 퇴사 · 남은 예약 취소 (74차) */
  function confirmLeave(m) {
    var co = A.company(m.companyCode) || { name: m.companyCode, key: '' };
    openSheet({
      title: esc(co.name) + '에서 나갈까요',
      body: '<p class="note">이 회사 회의실을 더 예약할 수 없고<br>남은 예약은 취소돼요</p>',
      cta: { label: '나가기', kind: 'danger', onClick: function () {
        var n = co.key ? F.cancelMine(co.key, user.id, '회사에서 나감', 'self') : 0;
        A.patchMember(m.id, { canceledRsv: n });
        A.leaveMember(m.id);
        afterMembership();
        toast(co.name + '에서 나갔어요' + (n ? ' · 남은 예약 ' + n + '건을 취소했어요' : ''));
      } }
    });
  }
  function confirmCancelApply(m) {
    var co = A.company(m.companyCode) || { name: m.companyCode };
    openSheet({
      title: '가입 신청을 취소할까요',
      body: '<p class="note">' + esc(co.name) + ' 관리자에게 간 신청이 없어져요</p>',
      cta: { label: '신청 취소하기', kind: 'danger', onClick: function () {
        A.cancelApply(m.id);
        afterMembership();
        toast('가입 신청을 취소했어요');
      } }
    });
  }
  /** 내가 소속을 바꾼 뒤 — 보던 회사가 끝났으면 다른 회사(없으면 빈 홈)로 */
  function afterMembership() {
    memberSnap = snapMembers();
    if (!curMember()) useCo(null); else applyMe();
    if (stack[stack.length - 1] === 'S-18') paint('S-18'); else goRoot();
  }

  /** 계정 삭제 — 모든 소속이 끝나고 남은 예약 취소 · 이름과 번호는 지운다 (74차 · 앱 심사 요건) */
  function confirmDeleteAccount() {
    openSheet({
      title: '계정을 삭제할까요',
      body: '<p class="note">모든 회사 소속이 끝나고 남은 예약은 취소돼요<br>이름과 휴대폰 번호는 지워지고 되돌릴 수 없어요</p>',
      cta: { label: '계정 삭제하기', kind: 'danger', onClick: function () {
        myMembers().forEach(function (m) {
          var co = A.company(m.companyCode);
          if (m.status === 'ACTIVE' && co) A.patchMember(m.id, { canceledRsv: F.cancelMine(co.key, user.id, '계정 삭제', 'self') });
        });
        A.deleteUser(user.id);
        signOut(); loginMode = 'pick'; loginErr = '';
        apply(['S-02'], 'push'); history.pushState({ stack: stack.slice() }, '', '#S-02');
        toast('계정을 삭제했어요');
      } }
    });
  }

  /** 가입 결과 알림 — 계정 알림이라 고른 회사와 상관없이 알림함에 보인다. 소속의 결정에서 만든다.
      내가 한 일(나가기 · 신청 취소 · 계정 삭제)은 알림이 아니다 (74차) */
  function memberNotis() {
    var read = A.inboxRead();
    return myMembers().filter(function (m) {
      return m.decidedAt && (m.status === 'ACTIVE' || m.status === 'REJECTED' || (m.status === 'RETIRED' && m.retiredBy !== 'self'));
    }).map(function (m) {
      var co = A.company(m.companyCode) || { name: m.companyCode }, id = 'MB-' + m.id + '-' + m.status;
      return {
        id: id, kind: 'member', memberId: m.id, at: new Date(m.decidedAt), read: !!m.demo || !!read[id],
        title: co.name + (m.status === 'ACTIVE' ? ' 가입이 승인됐어요' : m.status === 'REJECTED' ? ' 가입이 반려됐어요' : ' 소속이 끝났어요'),
        body: m.status === 'ACTIVE' ? (memberLine(m) || co.name) + '\n이제 이 회사 회의실을 예약할 수 있어요'
          : m.status === 'REJECTED' ? '사유 · ' + (m.rejectReason || '—')
          : '관리자가 퇴사 처리했어요' + (m.canceledRsv ? '\n남은 예약 ' + m.canceledRsv + '건은 취소됐어요' : '')
      };
    });
  }

  var JOIN_T = { PENDING: '승인을 기다리고 있어요', REJECTED: '가입이 반려됐어요', RETIRED: '이 회사 소속이 끝났어요' };
  var JOIN_S = { PENDING: '관리자가 승인하면 알림으로 알려 드려요', REJECTED: '사유를 확인하고 다시 신청해 주세요', RETIRED: '관리자가 퇴사 처리했어요' };

  function joinCardHtml(m) {
    var co = A.company(m.companyCode) || { name: m.companyCode, site: '' };
    var self = m.status === 'RETIRED' && m.retiredBy === 'self';   /* 내가 나간 회사 (74차) */
    var sub = self ? '다시 다니게 되면 새로 신청해 주세요'
      : m.status === 'RETIRED' && m.canceledRsv ? JOIN_S.RETIRED + ' · 남은 예약 ' + m.canceledRsv + '건은 취소됐어요' : JOIN_S[m.status] || '';
    return '<div class="jcard">' +
      '<p class="jcard__co">' + esc(co.name) + (co.site ? ' · ' + esc(co.site) : '') + '</p>' +
      '<p class="jcard__t">' + esc(self ? '이 회사에서 나갔어요' : JOIN_T[m.status] || '') + '</p>' +
      '<p class="jcard__s">' + esc(sub) + '</p>' +
      memberRowsHtml(m) +
      (m.status !== 'PENDING' ? '<button class="btn btn--secondary btn--sm" data-rejoin="' + esc(m.id) + '">다시 신청하기</button>' : '') +
    '</div>';
  }

  /** 회사가 없을 때 — 탐색 · 내 예약도 같은 빈 화면 */
  function noCoHtml() {
    return '<div class="empty">' + icon('sign', 'icon--lg') +
      '<p class="empty__title">회사코드를 입력해 주세요</p>' +
      '<p class="empty__text">회사에서 받은 코드를 넣으면<br>그 회사 회의실을 예약할 수 있어요</p>' +
      '<button class="btn btn--primary empty__action" data-coadd>회사코드 입력</button></div>';
  }

  function renderHomeNoCo() {
    var l = myMembers().filter(function (m) { return m.status !== 'ACTIVE'; });
    $('#homeHead').innerHTML = homeHeadHtml();
    $('#homeBody').innerHTML = l.length
      ? '<div class="hbody">' + l.map(joinCardHtml).join('') +
          '<button class="linkbtn" data-coadd>다른 회사 추가</button></div>'
      : noCoHtml();
    $('#homeCta').innerHTML = '';
  }


  /* ============================================================
     S-01 · S-02 · S-04 온보딩
     ============================================================ */

  var loginMode = 'pick', loginErr = '', joinAfter = null;   /* joinAfter — 가입 링크로 왔을 때 로그인 뒤 열 회사코드 */

  var SOCIAL = [['kakao', '카카오로 시작하기'], ['naver', '네이버로 시작하기'], ['apple', 'Apple로 계속하기'], ['google', 'Google로 계속하기']];
  /* 로고는 각 사 가이드의 색 · 모양 — 버튼 면 색도 가이드 값이라 토큰을 쓰지 않는다 */
  var SOCIAL_ICON = {
    kakao: '<svg class="social__i" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4C6.9 4 3 7.1 3 11c0 2.5 1.7 4.7 4.2 5.9l-.9 3.4c-.1.3.3.6.6.4l4-2.7c.4 0 .7.1 1.1.1 5 0 9-3.1 9-7.1S17 4 12 4z"/></svg>',
    naver: '<svg class="social__i" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14.3 12.6L9.5 5.5H5.5v13h4.2v-7.1l4.8 7.1h4v-13h-4.2z"/></svg>',
    apple: '<svg class="social__i" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.7c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.9-.9-3.1-.8c-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.5.8 1.1 1.7 2.4 3 2.4 1.2 0 1.6-.8 3.1-.8s1.9.8 3.1.8c1.3 0 2.1-1.1 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7 0 0-2.6-1-2.7-4zM14.1 5.6c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.7-1.3z"/></svg>',
    google: '<svg class="social__i" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4c-.2 1.2-.9 2.3-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6C4.7 19.8 8.1 22 12 22z"/><path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1C2.4 8.8 2 10.4 2 12s.4 3.2 1.1 4.6L6.4 14z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9C17 2.9 14.7 2 12 2 8.1 2 4.7 4.2 3.1 7.4L6.4 10c.8-2.4 3-4.1 5.6-4.1z"/></svg>'
  };

  function renderLogin() {
    var jc = joinAfter ? A.company(joinAfter) : null;
    var lede = jc
      ? esc(jc.name) + '에 가입하려면<br>먼저 로그인하거나 가입해 주세요'
      : '회사 회의실을 예약하고<br>문 앞에서 바로 열어요';

    if (loginMode === 'phone') {
      /* 데모 계정은 번호 · 비밀번호를 채워 둔다 — 다른 번호를 넣으면 실제로 확인한다 */
      var demo = A.userById(A.DEMO_ID);
      $('#loginBody').innerHTML =
        '<div class="appbar"><button class="iconbtn" data-loginmode="pick" aria-label="뒤로">' + icon('back') + '</button></div>' +
        '<div class="login login--sub">' +
          '<h1 class="login__title">휴대폰 번호로 로그인</h1>' +
          '<div class="login__field"><input class="textinput tnum" id="loginPhone" type="tel" inputmode="numeric" ' +
            'autocomplete="tel" placeholder="휴대폰 번호" value="' + esc(demo ? demo.phone : '') + '"></div>' +
          '<div class="login__field"><input class="textinput" id="loginPw" type="password" ' +
            'autocomplete="current-password" placeholder="비밀번호" value="' + esc(demo && demo.password ? demo.password : '') + '">' +
            '<button class="iconbtn login__eye" id="pwEye" aria-label="비밀번호 보기">' + icon('eye') + '</button></div>' +
          (loginErr ? '<p class="login__err">' + esc(loginErr) + '</p>' : '') +
          '<label class="login__check"><button class="switch is-on" id="autoLogin" role="switch" aria-checked="true"></button>자동 로그인</label>' +
          '<div class="login__actions"><button class="btn btn--primary" id="loginGo">로그인</button></div>' +
          '<div class="login__links"><button class="login__link" data-joinstart="phone">휴대폰 번호로 가입</button>' +
            '<span aria-hidden="true">·</span><button class="login__link" id="pwForgot">비밀번호를 잊었어요</button></div>' +
        '</div>';
      return;
    }

    $('#loginBody').innerHTML =
      '<div class="login">' +
        '<div class="login__logo" role="img" aria-label="SIOT"></div>' +   /* SIOT 로고 이미지 — 글자 워드마크 대신 (2026-10-01) */
        '<h1 class="login__title">' + lede + '</h1>' +
        '<div class="social">' + SOCIAL.map(function (s) {
          return '<button class="btn social__b social__b--' + s[0] + '" data-social="' + s[0] + '">' +
            SOCIAL_ICON[s[0]] + '<span>' + esc(s[1]) + '</span></button>';
        }).join('') + '</div>' +
        '<p class="login__or">또는</p>' +
        '<button class="btn btn--secondary" data-loginmode="phone">휴대폰 번호로 로그인</button>' +
        '<button class="login__link login__link--c" data-joinstart="phone">처음이에요 · 휴대폰 번호로 가입</button>' +
      '</div>';
  }

  function doLogin() {
    var ph = $('#loginPhone').value.trim(), pw = $('#loginPw').value;
    if (!A.digits(ph) || !pw) {
      loginErr = !A.digits(ph) ? '휴대폰 번호를 입력해 주세요' : '비밀번호를 입력해 주세요';
      renderLogin(); return;
    }
    var u = A.userByPhone(ph);
    if (!u) loginErr = '가입하지 않은 번호예요';
    else if (u.provider !== 'phone') loginErr = PROVIDER[u.provider] + ro(PROVIDER[u.provider]) + ' 가입한 번호예요 · ' + PROVIDER[u.provider] + ro(PROVIDER[u.provider]) + ' 로그인해 주세요';
    else if (u.password !== pw) loginErr = '비밀번호가 맞지 않아요';
    else loginErr = '';
    if (loginErr) { renderLogin(); return; }
    signIn(u);
    pushTo('S-04');
  }

  /** 권한 안내(S-04)를 떠난다 — X · 시작하기 · Esc · ‹ 모두. 가입 링크로 왔으면 회사 추가로 이어진다 (72차) */
  function leavePerm() {
    goRoot();
    if (joinAfter && user) { var jl = joinAfter; joinAfter = null; linkJoin(jl); push('S-25'); }
  }

  /** 간편 로그인 — 프로토타입은 그 방법으로 가입한 계정이 있으면 그 사람으로 들어오고, 없으면 가입 화면으로 */
  function socialLogin(p) {
    var u = A.lastUserOf(p);
    if (u) { signIn(u); pushTo('S-04'); toast(PROVIDER[p] + ro(PROVIDER[p]) + ' 로그인했어요'); return; }
    joinMode = p; joinForm = null; joinErr = ''; joinAgree = { terms: false, privacy: false };
    pushTo('S-26');
  }

  /* 이름을 go로 두면 클릭 핸들러 안의 지역 변수 go(= data-go 요소)에 가려진다.
     가입(S-26)은 로그인(S-02) 위에 쌓는다 — ‹ 는 로그인으로. 권한 안내(S-04)는 한 장으로 */
  function pushTo(id) {
    var next = id === 'S-26' ? ['S-02', 'S-26'] : [id];
    apply(next, 'push');
    history.pushState({ stack: stack.slice() }, '', '#' + id);
  }


  /* ============================================================
     S-26 회원가입 — 이름 · 휴대폰 번호 (+ 비밀번호) · 약관
     간편 로그인으로 왔으면 비밀번호를 받지 않는다(68차) · 문자 인증은 이번에 없다(68차 · 추후)
     부서 · 직급 · 사번은 여기서 받지 않는다 — 회사마다 다르므로 회사 추가(S-25)에서
     ============================================================ */

  var joinMode = 'phone', joinForm = null, joinErr = '', joinAgree = { terms: false, privacy: false };

  function renderJoinForm() {
    var social = joinMode !== 'phone', v = joinForm || {};
    var fields = [
      { k: 'name', n: '이름', t: 'text', p: '홍길동', ac: 'name' },
      { k: 'phone', n: '휴대폰 번호', t: 'tel', p: '010-0000-0000', ac: 'tel' }
    ];
    if (!social) {
      fields.push({ k: 'password', n: '비밀번호', t: 'password', p: '8자 이상', ac: 'new-password' });
      fields.push({ k: 'password2', n: '비밀번호 확인', t: 'password', p: '한 번 더', ac: 'new-password' });
    }
    var all = joinAgree.terms && joinAgree.privacy;
    function ag(k, label, req) {
      var on = k === 'all' ? all : joinAgree[k];
      return '<button class="agree__row' + (k === 'all' ? ' agree__row--all' : '') + (on ? ' is-on' : '') + '" data-agree="' + k + '" role="checkbox" aria-checked="' + on + '">' +
        '<span class="agree__ck">' + icon('check') + '</span>' +
        '<span>' + (req ? '<span class="agree__req">필수</span>' : '') + esc(label) + '</span></button>';
    }
    $('#joinFormBody').innerHTML =
      '<div class="login login--sub">' +
        '<h1 class="login__title">' + esc(social ? PROVIDER[joinMode] + ro(PROVIDER[joinMode]) + ' 가입해요' : '휴대폰 번호로 가입해요') + '</h1>' +
        '<p class="login__lede">' + (social
          ? '비밀번호 없이 ' + esc(PROVIDER[joinMode]) + ro(PROVIDER[joinMode]) + ' 로그인해요<br>회사에 가입할 때 이 이름과 번호가 전달돼요'
          : '이 번호와 비밀번호로 로그인해요<br>회사에 가입할 때 이 이름과 번호가 전달돼요') + '</p>' +
      '</div>' +
      '<div class="formlist">' + fields.map(function (f) {
        return '<label class="formrow"><span class="formrow__n">' + esc(f.n) + '</span>' +
          '<input class="textinput' + (f.t === 'tel' ? ' tnum' : '') + '" data-jf="' + f.k + '" type="' + f.t + '" autocomplete="' + f.ac + '"' +
            (f.t === 'tel' ? ' inputmode="numeric"' : '') + ' placeholder="' + esc(f.p) + '" value="' + esc(v[f.k] || '') + '"></label>';
      }).join('') +
      '<div class="agree">' + ag('all', '전체 동의') + ag('terms', '서비스 이용약관', true) + ag('privacy', '개인정보 수집 · 이용', true) + '</div>' +
      (joinErr ? '<p class="login__err">' + esc(joinErr) + '</p>' : '') +
      '</div>';
    $('#joinGo').textContent = social ? '시작하기' : '가입하기';
  }

  function readJoinForm() {
    var o = {};
    $$('#joinFormBody [data-jf]').forEach(function (el) { o[el.getAttribute('data-jf')] = el.value.trim(); });
    return o;
  }

  function doJoin() {
    var v = readJoinForm(), social = joinMode !== 'phone';
    joinForm = v;
    var dup = A.userByPhone(v.phone);
    /* 막을 이유는 하나만 말한다 (§16) */
    if (!v.name) joinErr = '이름을 입력해 주세요';
    else if (!/^01\d{8,9}$/.test(A.digits(v.phone))) joinErr = '휴대폰 번호를 확인해 주세요';
    else if (dup) joinErr = dup.provider === 'phone' ? '이미 가입한 번호예요 · 로그인해 주세요'
      : PROVIDER[dup.provider] + ro(PROVIDER[dup.provider]) + ' 가입한 번호예요 · ' + PROVIDER[dup.provider] + ro(PROVIDER[dup.provider]) + ' 로그인해 주세요';
    else if (!social && (v.password || '').length < 8) joinErr = '비밀번호는 8자 이상으로 정해 주세요';
    else if (!social && v.password !== v.password2) joinErr = '비밀번호가 서로 달라요';
    else if (!joinAgree.terms || !joinAgree.privacy) joinErr = '필수 약관에 동의해 주세요';
    else joinErr = '';
    if (joinErr) { renderJoinForm(); return; }

    var u = A.createUser({ name: v.name, phone: v.phone, password: social ? null : v.password, provider: joinMode });
    joinForm = null; joinAgree = { terms: false, privacy: false };
    signIn(u);
    pushTo('S-04');
    toast('가입했어요');
  }


  /* ============================================================
     S-25 회사 추가 — 회사코드 → 회사 확인 → 사번 · 부서 · 직급 · 정보 제공 동의 → 승인 대기
     부서 · 직급은 그 회사 관리자 web 설정(부서 트리 · 직급 서열)에서 고른다 — 승인할 때 관리자가 고칠 수 있다
     ============================================================ */

  var coJoin = null;   /* { code, co, empNo, deptId, rankId, agree, err } — co가 있으면 2단계 */

  function newCoJoin(code, prev) {
    return { code: code || '', co: null, empNo: prev ? prev.empNo : '', deptId: prev ? prev.deptId : '',
             rankId: prev ? prev.rankId : '', agree: false, err: '' };
  }

  /** 회사 추가 열기 — 코드가 오면(가입 링크 · 다시 신청) 확인까지 해서 2단계로 */
  function openJoin(code, prev) {
    coJoin = newCoJoin(code, prev);
    if (code) checkCode();
    push('S-25');
  }

  /** 가입 링크 — 코드를 채우고 확인까지. 관리자가 코드를 바꿔 옛 링크가 됐으면 코드 입력부터 */
  function linkJoin(c) {
    coJoin = newCoJoin(c);
    if (!checkCode() && !A.company(c)) coJoin.err = '가입 링크가 바뀌었어요 · 회사코드를 입력해 주세요';
  }

  function checkCode() {
    var j = coJoin, v = upper(j.code);
    var co = v ? A.company(v) : null;
    var ex = co ? myMembers().filter(function (m) { return upper(m.companyCode) === co.code; })[0] : null;
    if (!v) j.err = '회사코드를 입력해 주세요';
    else if (!co) j.err = '이 코드로 가입할 수 있는 회사가 없어요';
    else if (ex && ex.status === 'ACTIVE') j.err = '이미 소속된 회사예요';
    else if (ex && ex.status === 'PENDING') j.err = '이미 가입 신청한 회사예요 · 승인을 기다리고 있어요';
    else j.err = '';
    if (j.err) return false;
    j.co = co; j.code = co.code;
    /* 다시 신청할 때 지난 값이 그 회사 목록에서 지워졌으면 비운다 */
    var o = A.org(co.code);
    if (j.deptId && !A.deptPath(o, j.deptId).length) j.deptId = '';
    if (j.rankId && !A.rankName(o, j.rankId)) j.rankId = '';
    return true;
  }

  function renderJoinCode() {
    var j = coJoin || (coJoin = newCoJoin(''));
    var err = j.err ? '<p class="login__err">' + esc(j.err) + '</p>' : '';

    if (!j.co) {
      $('#joinCodeBody').innerHTML =
        '<div class="login login--sub">' +
          '<h1 class="login__title">회사코드를 입력해 주세요</h1>' +
          '<p class="login__lede">회사 관리자에게 받은 코드예요</p>' +
          '<div class="login__field"><input class="textinput" id="joinCode" type="text" autocapitalize="characters" ' +
            'placeholder="예: ABCD-1234" value="' + esc(j.code) + '"></div>' + err +
        '</div>';
      $('#joinCodeGo').textContent = '다음';
      return;
    }

    var o = A.org(j.co.code), path = A.deptPath(o, j.deptId), rank = A.rankName(o, j.rankId);
    $('#joinCodeBody').innerHTML =
      '<div class="login login--sub">' +
        '<h1 class="login__title">' + esc(j.co.name) + '에<br>가입 신청해요</h1>' +
        '<p class="login__lede">관리자가 확인하면 이 회사 회의실을 예약할 수 있어요</p>' +
      '</div>' +
      '<div class="formlist">' +
        '<div class="cocard"><span class="row__main"><span class="cocard__n">' + esc(j.co.name) + '</span>' +
          '<span class="cocard__s">' + esc(j.co.site) + ' · ' + esc(j.co.code) + '</span></span>' +
          '<button class="login__link" data-jc="reset">코드 바꾸기</button></div>' +
        '<label class="formrow"><span class="formrow__n">사번</span>' +
          '<input class="textinput tnum" data-jcf="empNo" type="text" placeholder="회사에서 쓰는 사번" value="' + esc(j.empNo) + '"></label>' +
        '<div class="formrow"><span class="formrow__n">부서</span>' +
          '<button class="pickfield' + (path.length ? '' : ' is-empty') + '" data-jc="dept">' +
            '<span>' + esc(path.length ? path.join(' › ') : '부서 선택') + '</span>' + icon('down') + '</button></div>' +
        '<div class="formrow"><span class="formrow__n">직급</span>' +
          '<button class="pickfield' + (rank ? '' : ' is-empty') + '" data-jc="rank">' +
            '<span>' + esc(rank || '직급 선택') + '</span>' + icon('down') + '</button></div>' +
        '<div class="agree"><button class="agree__row' + (j.agree ? ' is-on' : '') + '" data-jc="agree" role="checkbox" aria-checked="' + j.agree + '">' +
          '<span class="agree__ck">' + icon('check') + '</span>' +
          '<span><span class="agree__req">필수</span>' + esc(j.co.name) + '에 이름 · 휴대폰 번호 제공</span></button></div>' +
        err +
      '</div>';
    $('#joinCodeGo').textContent = '가입 신청하기';
  }

  /** 부서 시트 — 그 회사 부서 트리를 단계만큼 들여 쓴다. 어느 단계든 고를 수 있다 */
  function openDeptSheet() {
    var l = A.deptList(A.org(coJoin.co.code));
    openSheet({
      title: '부서', tall: l.length > 8,
      body: '<div class="picklist">' + l.map(function (d) {
        var on = d.id === coJoin.deptId;
        return '<button class="pickrow' + (d.depth ? '' : ' is-top') + (on ? ' is-on' : '') + '" data-pickdept="' + esc(d.id) + '" style="padding-left:' + (d.depth * 16) + 'px">' +
          '<span>' + esc(d.name) + '</span>' + (on ? icon('check') : '') + '</button>';
      }).join('') + '</div>'
    });
  }
  /** 직급 시트 — 서열 순서(낮은 직급부터) */
  function openRankSheet() {
    var l = A.rankList(A.org(coJoin.co.code));
    openSheet({
      title: '직급',
      body: '<div class="picklist">' + l.map(function (r) {
        var on = r.id === coJoin.rankId;
        return '<button class="pickrow' + (on ? ' is-on' : '') + '" data-pickrank="' + esc(r.id) + '"><span>' + esc(r.name) + '</span>' + (on ? icon('check') : '') + '</button>';
      }).join('') + '</div>'
    });
  }

  function doJoinCode() {
    var j = coJoin;
    if (!j) return;   /* 신청 직후 전환 중에 한 번 더 누른 경우 */
    if (!j.co) {
      var inp = $('#joinCode'); if (inp) j.code = inp.value;
      checkCode(); renderJoinCode(); return;
    }
    if (!j.empNo.trim()) j.err = '사번을 입력해 주세요';
    else if (!j.deptId) j.err = '부서를 골라 주세요';
    else if (!j.rankId) j.err = '직급을 골라 주세요';
    else if (!j.agree) j.err = '정보 제공에 동의해 주세요';
    else j.err = '';
    if (j.err) { renderJoinCode(); return; }

    var nm = A.applyMember({ userId: user.id, companyCode: j.co.code, empNo: j.empNo, deptId: j.deptId, rankId: j.rankId });
    memberSnap = snapMembers();
    if (j.co.autoApprove) autoApprove(nm.id);
    var name = j.co.name;
    coJoin = null;
    goRoot();
    toast(name + '에 가입 신청했어요');
  }


  /* ── S-28 비밀번호 변경 — 휴대폰 번호로 가입한 계정만 (간편 로그인은 비밀번호가 없다) ── */

  var pwErr = '';

  function renderPwChange() {
    $('#pwBar').innerHTML =
      '<button class="iconbtn" data-back aria-label="뒤로">' + icon('back') + '</button>' +
      '<span class="appbar__mid">비밀번호 변경</span><span class="appbar__trail" style="width:44px"></span>';
    var rows = [{ k: 'now', n: '지금 비밀번호', p: '' }, { k: 'next', n: '새 비밀번호', p: '8자 이상' }, { k: 'next2', n: '새 비밀번호 확인', p: '한 번 더' }];
    $('#pwBody').innerHTML =
      '<div class="formlist">' + rows.map(function (f) {
        return '<label class="formrow"><span class="formrow__n">' + esc(f.n) + '</span>' +
          '<input class="textinput" data-pf="' + f.k + '" type="password" autocomplete="' + (f.k === 'now' ? 'current-password' : 'new-password') + '" ' +
          'placeholder="' + esc(f.p) + '"></label>';
      }).join('') +
      (pwErr ? '<p class="login__err">' + esc(pwErr) + '</p>' : '') +
      '</div>';
  }

  function doPwChange() {
    var v = {};
    $$('#pwBody [data-pf]').forEach(function (el) { v[el.getAttribute('data-pf')] = el.value; });
    if (!v.now) pwErr = '지금 비밀번호를 입력해 주세요';
    else if (!user || user.password !== v.now) pwErr = '지금 비밀번호가 맞지 않아요';
    else if (v.next.length < 8) pwErr = '새 비밀번호는 8자 이상으로 정해 주세요';
    else if (v.next === v.now) pwErr = '지금 쓰는 비밀번호와 달라야 해요';
    else if (v.next !== v.next2) pwErr = '새 비밀번호가 서로 달라요';
    else pwErr = '';
    if (pwErr) { renderPwChange(); return; }
    user.password = v.next;
    A.saveUser(user);
    back();
    toast('비밀번호를 바꿨어요');
  }

  function renderPerm() {
    /* 카메라 — QR 체크인이 회의실 앞 태블릿의 QR을 읽는다 (2026-09-22) */
    /* 위치 권한은 뺐다 — 「가까운 층 먼저」 기능이 없다. 리마인드 시점은 알림 설정에서 고르므로 분을 적지 않는다 (65차) */
    var perms = [
      { i: 'bell', n: '알림', w: '예약 확정과 시작 전 리마인드를 보내요' }
    ];
    /* QR로 입장하는 회의실이 하나도 없는 업장이면 카메라를 묻지 않는다 (2026-09-23) */
    if (F.anyQrSpace()) perms.push({ i: 'qr', n: '카메라', w: 'QR 체크인에 카메라를 써요' });
    $('#permBody').innerHTML =
      '<div class="login" style="padding-top:var(--sp-6)"><h1 class="login__title">이 권한이 필요해요</h1></div>' +
      '<div class="permlist">' + perms.map(function (p) {
        return '<div class="permrow">' + icon(p.i) +
          '<span class="row__main"><span class="permrow__n">' + esc(p.n) + '</span>' +
          '<span class="permrow__w">' + esc(p.w) + '</span></span></div>';
      }).join('') + '</div>';
  }


  /* ============================================================
     프로토타입 도구 (§18) — 전부 꺼도 화면을 쓸 수 있다
     ============================================================ */

  var TOOL = { id: false, home: 'live', dev: 'ok',
               reader: 'success', empty: 'off', spec: false, gray: false, brand: null };

  var SPEC_NOTES = {
    'S-05': ['헤더 맨 위 회사 이름 ▾ — 회사 시트(승인된 회사는 누르면 바뀜 · 승인 대기 · 반려 · 회사 추가). 회사가 없으면 「회사코드를 입력해 주세요」 빈 홈, 신청 중이면 승인 대기 카드 (72차)',
             '홈 3a — 날짜 헤더 · 오늘 예약 캐러셀 · 즐겨찾기 · 최근 사용 · 전체 회의실(사용 중은 맨 뒤)',
             '행을 누르면 그 자리에서 펼쳐져 시간·인원만 정하고 확정한다',
             '예약 사유는 받지 않는다 · 주 동작은 캐러셀 카드의 「체크인」(입실 시각 전에는 흐림)',
             '카드를 누르면 내 예약과 같은 규칙 — 사용 중·입실 시각이면 제어, 아니면 예약 상세 (65차)'],
    'S-06': ['탐색 — 조건은 날짜 · 시작 · 종료 3버튼 + 공간 그룹 칩 · 「4명 이상」(홈과 같음). 날짜는 월 달력 시트, 「며칠 뒤까지 예약」까지만',
             '시작·종료를 누르면 시각 시트 — 30분 단위 방이 있으면 30분 간격. 1시간 단위 방은 정시가 아닌 시간에 결과에서 빠진다 (57차)',
             '결과는 홈과 같은 줄. 줄을 누르면 그 자리에서 인원을 고르고 예약'],
    'S-16': ['내 예약 — 날짜별 카드 목록. 이용 시간에 카드를 누르면 제어 페이지 · 고른 회사의 예약만 (72차)',
             '예정 / 지난 세그먼트'],
    'S-14': ['카드에서 여는 전용 페이지. 이용 중과 입실 전을 한 화면이 다룬다',
             '체크인 = 문 잠깐 열림 + web 「입실」 자동화 · 퇴실 = web 「퇴실」 자동화. 도어는 「문 열기」 하나(3초 뒤 잠김) (66차)',
             '기기 카드는 전부 2열 — SIOT 카드 구조(라이트 · 별 없음). 냉난방은 카드에 상태만, 조작은 「리모컨 제어」 창 (69차)',
             '자동화 버튼은 기기 섹션 안 알약 버튼 · 상단은 이름+상태 / 정보+시간 / 진행 바 / 연장·퇴실로 낮게 (69차)',
             '낙관적 UI 금지 — 전송 중/확정/실패 3상태. 도어는 지문 확인 1회',
             '입실 전에는 「체크인」 — 문 앞 예약 현황판의 QR을 앱이 읽는다(S-12). 입실 시각 전에는 흐린 버튼',
             '이용 중 — 진행 바 아래 「30분 연장 · 퇴실하기」. 뒤 30분에 예약이 있으면 연장이 흐려지고 누르면 이유를 말한다 (57차)'],
    'S-12': ['QR 체크인 — 탭바 가운데 검정 버튼(A안) · 오늘 카드 「체크인」 · 예약 상세에서 열린다',
             '입장 인증은 회의실 속성 — QR / 리더기(안면인식 등 · 현장 장비가 기록) / 인증 없음(시작 시각에 자동). 업장에 QR 방이 없으면 탭바 버튼도 없다',
             '카메라 + 주황 프레임, 아래 시트에 6자리 코드 입력(대체 경로). 성공하면 제어 페이지로 바뀐다',
             '프로토타입: 카메라를 누르면 읽힌 것으로. 결과는 툴바 리더기 모드(success/fail/early)'],
    'S-14b': ['누가 언제 무엇을 조작했는지. 자동 실행은 조작자 자리에 "자동"'],
    'S-15': ['하단 액션은 상태마다 하나 — 사용 중 기기 제어 · 입실 시각 체크인 · 예정 예약 취소하기 · 지난 같은 회의실 다시 예약(홈에서 그 줄을 펼친다)',
             '⋯ 는 사용 중일 때만(제어 이력 보기)',
             '예정 예약의 하단 버튼은 「예약 취소하기」 — 더보기에 숨기지 않는다. 참석자 초대·공유는 없다 (2026-09-23)'],
    'S-18': ['프로필(이름 · 휴대폰 번호 · 로그인 방법) · 내 회사(소속마다 부서 · 직급 · 상태, 누르면 상세 · 바꾸기 · 다시 신청) · 회사 추가 (72차)',
             '비밀번호 변경은 휴대폰 번호로 가입한 계정만 — 간편 로그인은 비밀번호가 없다',
             '소속 상세 › 「이 회사에서 나가기」(본인 요청 퇴사 · 남은 예약 취소) · 승인 대기면 「신청 취소하기」 · 맨 아래 「계정 삭제」(앱 심사 요건) (74차)',
             '명판 편집 · 공지 · 앱 정보는 앱에 없다 — 명판은 관리자 웹이 만들고 사이니지가 띄운다 (2026-09-23 · 64차)'],
    'S-20': ['이 폰에서 알림 받기(전체) + 관리자 web이 켠 종류별 on/off. 무엇을 · 언제 보낼지는 web 정책. 리마인드 시점은 web 값 표시 (70차)',
             '74차 — 회사마다 묶음(정책이 회사마다 다르다) + 「내 계정 › 가입 결과」(회사가 끌 수 없는 필수 · 이 폰에서 울릴지만)'],
    'S-21': ['안 읽은 항목만 제목 굵게. 점·배지 없음',
             '가입 결과(승인 · 반려 · 퇴사)는 계정 알림이라 고른 회사와 상관없이 보인다 — 누르면 그 소속 상세. 예약 알림은 고른 회사 것만 (74차)',
             '푸시를 누르면 그 알림의 회사로 저절로 바뀐다(제품 규칙 · 프로토타입에는 푸시 없음)'],
    'S-24': ['회의실 이름으로 바로 찾기. 결과를 누르면 홈에서 그 줄이 펼쳐진다'],
    'S-01': ['1.2초 후 자동으로 로그인. 페이드인만'],
    'S-02': ['간편 로그인 4종(카카오 · 네이버 · Apple · Google) + 휴대폰 번호 로그인. 이메일 없음 · 문자 인증 없음(추후) (72차)',
             '데모: 010-1234-5678 · abcd1234(채워져 있음). 간편 로그인은 그 방법으로 가입한 계정이 있으면 그 사람으로, 없으면 가입(S-26)으로',
             '가입 링크(?join=코드)로 왔는데 로그아웃이면 로그인부터 — 마치면 회사 추가로 이어진다'],
    'S-26': ['이름 · 휴대폰 번호 · 비밀번호(휴대폰 가입만) · 필수 약관 2개. 간편 로그인은 비밀번호 없음 (68차 · 72차)',
             '같은 번호는 계정 하나 — 이미 있으면 가입한 방법을 알려 준다',
             '가입하면 권한 안내 → 회사 없는 빈 홈(「회사코드를 입력해 주세요」)'],
    'S-25': ['회사 추가 — 회사코드 → 회사 확인 → 사번 · 부서(web 부서 트리) · 직급(web 직급 서열) · 정보 제공 동의 → 승인 대기 (72차)',
             '승인은 관리자 web 회원(A-05) — 고른 부서 · 직급이 채워진 채로 열리고 관리자가 고칠 수 있다. 승인되면 앱이 그 자리에서 바뀐다',
             '이미 소속 · 신청 중인 회사는 막는다. 반려 · 퇴사된 회사는 다시 신청할 수 있다 · 데모 회사코드 HANBIT-01',
             '연출용 회사코드 1111 — (주)새움테크(앱에만 있음). 신청하면 5초 뒤 저절로 승인되고 토스트 「보기」로 그 회사 홈. 도구 「다시 연출하기」로 처음부터 (73차)'],
    'S-28': ['휴대폰 번호로 가입한 계정만. 임시 비밀번호 강제 변경은 없어졌다 — 계정은 회사 것이 아니라 사람 것 (72차)'],
    'S-04': ['알림 · 카메라(QR 방이 있을 때만) 권한이 왜 필요한지 먼저 설명. 위치 권한 없음']
  };

  function applyTools() {
    var id = stack[stack.length - 1];
    $('#idLabel').hidden = !TOOL.id;
    $('#idLabel').textContent = id;

    var ovl = $('#specOvl');
    ovl.hidden = !TOOL.spec;
    if (TOOL.spec) {
      var notes = SPEC_NOTES[id] || ['이 화면의 스펙 메모가 없습니다'];
      ovl.innerHTML = '<p class="specovl__h">' + esc(id) + '</p>' +
        notes.map(function (n) { return '<p class="specovl__l">' + esc(n) + '</p>'; }).join('');
    }

    document.documentElement.classList.toggle('is-gray', TOOL.gray);

    $$('.tools__b').forEach(function (b) {
      var k = b.getAttribute('data-tool'), v = b.getAttribute('data-val'), cur = TOOL[k];
      var on = (k === 'id' || k === 'spec' || k === 'gray')
        ? (v === 'on') === !!cur
        : (k === 'brand' ? M.branding.headerVariant === v : cur === v);
      b.classList.toggle('is-on', on);
    });
  }

  /** 더미 예약 id가 대양씨아이에스 것이라 그 회사 데이터에서만 바뀐다 — 아니면 false (72차) */
  function applyHomeMode(mode) {
    if (F.companyKey() !== 'DY') return false;
    var live = F.getReservation('RSV-3301');
    var soon = F.getReservation('RSV-3302');
    var later = F.getReservation('RSV-3303');
    /* 오늘 예약 스와이프용 2건 — 「예약 없음」이면 이것도 함께 비운다 */
    var past = F.getReservation('RSV-3299');
    var eve = F.getReservation('RSV-3300');
    if (mode === 'live') { live.status = 'CHECKED_IN'; live.checkedInAt = F.at(2026, 9, 6, 13, 58); soon.status = 'APPROVED'; later.status = 'APPROVED'; past.status = 'USED'; eve.status = 'APPROVED'; }
    else if (mode === 'soon') { live.status = 'APPROVED'; live.checkedInAt = null; soon.status = 'APPROVED'; later.status = 'APPROVED'; past.status = 'USED'; eve.status = 'APPROVED'; }
    else { live.status = 'CANCELED'; soon.status = 'CANCELED'; later.status = 'CANCELED'; past.status = 'CANCELED'; eve.status = 'CANCELED'; }
    ctlTarget = null;
    return true;
  }

  function applyDeviceMode(mode) {
    var dv = F.getDevices('SP-03');
    if (!dv) return;
    dv.items.forEach(function (d) {
      if (d.kind === 'blind') d.status = mode === 'partial' ? 'OFFLINE' : 'ONLINE';
    });
    failed = {};
  }

  /* 플로우 재생 — 홈 → 리본 드래그 → 확정 → 카드 → 제어 */
  var flowOn = false, flowTimer = null;

  function stopFlow() {
    flowOn = false; clearTimeout(flowTimer);
    $('#flowRun').classList.remove('is-on');
    $('#flowRun').textContent = '플로우 재생 · 예약 → 제어';
  }

  function runFlow() {
    if (flowOn) { stopFlow(); return; }
    flowOn = true;
    $('#flowRun').classList.add('is-on');
    $('#flowRun').textContent = '재생 중 — 누르면 멈춤';

    /* 홈 → 행 펼침 → 예약 → 내 예약 → 제어 */
    var steps = [
      function () { goTab('S-05'); },
      function () { var r = document.querySelector('#homeBody [data-hrow]'); if (r) r.click(); },
      function () { var b = document.querySelector('#homeBody [data-hbook]'); if (b) b.click(); },
      function () { goTab('S-16'); },
      function () { var c = document.querySelector('#mineBody [data-rsv]'); if (c) c.click(); }
    ];
    var i = 0;
    (function next() {
      if (!flowOn) return;
      if (i >= steps.length) { stopFlow(); return; }
      if (animating) { flowTimer = setTimeout(next, 80); return; }
      steps[i++]();
      flowTimer = setTimeout(next, 1500);
    })();
  }


  /* ============================================================
     이벤트 — 위임 하나로 모은다
     ============================================================ */

  /* 즐겨찾기 별은 카드(button) 안에 있어 키보드 활성화가 바깥 버튼으로 새어 나간다.
     별에 초점이 있을 때의 Enter·Space를 여기서 가로채 별만 토글한다 */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var fv = e.target.closest && e.target.closest('[data-fav]');
    if (!fv) return;
    e.preventDefault();
    e.stopPropagation();
    toggleFav(fv.getAttribute('data-fav'));
  });

  document.addEventListener('click', function (e) {
    var t = e.target;

    if (t.closest('[data-close]')) { closeSheet(); return; }
    if (t.closest('[data-back]')) { back(); return; }
    if (t.closest('[data-home]')) { goRoot(); return; }
    if (t.closest('[data-skip]')) { leavePerm(); return; }

    var go = t.closest('[data-go]');
    if (go) { var gid = go.getAttribute('data-go'); if (!push(gid)) notReady(gid); return; }

    var tb0 = t.closest('[data-tab]');
    if (tb0) { goTab(tb0.getAttribute('data-tab')); return; }

    /* ── 홈 (S-05) ── */
    var hf = t.closest('[data-hfloor]');
    if (hf) { homePath = nextPath(homePath, hf.getAttribute('data-hfloor')); closeRow(); renderHome(); return; }

    /* 즐겨찾기 별 — 카드 클릭보다 먼저 잡는다. 홈과 탐색 어디서 눌러도 같은 동작 */
    var fv = t.closest('[data-fav]');
    if (fv) { toggleFav(fv.getAttribute('data-fav')); return; }

    var hc = t.closest('[data-hcap]');
    if (hc) { homeCap = !homeCap; closeRow(); renderHome(); return; }

    /* 오늘 예약 카드 안의 버튼 — 카드 클릭보다 먼저 잡는다 */
    var hg = t.closest('[data-hgo]');
    if (hg) {
      var card = hg.closest('[data-hcard]');
      var rid = card && card.getAttribute('data-hcard');
      var act = hg.getAttribute('data-hgo');
      if (act === 'ctl') {
        var rc = F.getReservation(rid);
        /* 입실 시각 전의 「체크인」은 흐린 버튼 — 스캐너로 가지 않고 이유만 (65차) */
        if (hg.classList.contains('is-blocked') && rc) { toast(F.hm(rc.start) + '부터 입실할 수 있어요'); return; }
        ctlTarget = rc; push(ctlTarget && ctlTarget.status === 'CHECKED_IN' ? 'S-14' : 'S-12'); return;
      }
      if (act === 'extend') { doExtend(rid); return; }   /* 30분 연장 — 그 자리에서 (57차) */
      /* 시간 변경 기능은 없다(연계검토 G-10) — 버튼 이름도 「예약 상세」 (2026-09-23) */
      if (act === 'edit')   { rsvTarget = F.getReservation(rid); push('S-15'); return; }
      return;
    }

    var hcd = t.closest('[data-hcard]');
    if (hcd) {
      var r0 = F.getReservation(hcd.getAttribute('data-hcard'));
      if (!r0) return;
      /* 내 예약 카드와 같은 규칙 — 사용 중이거나 입실 시각이면 제어 페이지, 아니면 예약 상세 (65차) */
      if (r0.status === 'CHECKED_IN' || F.canIssueCheckinCode(r0)) { ctlTarget = r0; qrLeft = M.QR_TTL_SEC; readerMsg = ''; push('S-14'); }
      else { rsvTarget = r0; push('S-15'); }
      return;
    }

    var hr = t.closest('[data-hrow]');
    if (hr) { openRow(hr.getAttribute('data-hrow')); return; }

    var hs = t.closest('[data-hslot]');
    if (hs) {
      if (hs.classList.contains('is-disabled')) {
        toast(open.slots[+hs.getAttribute('data-hslot')].reason || '그 시간은 고를 수 없어요');
        return;
      }
      var i = +hs.getAttribute('data-hslot');
      var sp0 = F.getSpace(open.spaceId);
      if (open.a === null) { open.a = open.b = i; renderHome(); return; }
      var lo = Math.min(open.a, i), hi = Math.max(open.a, i), blocked = false;
      for (var k = lo; k <= hi; k++) if (open.slots[k].state !== 'AVAILABLE') blocked = true;
      if (blocked) { open.a = open.b = i; renderHome(); return; }   // 막힌 곳을 넘지 않는다
      if (hi - lo + 1 > F.getMaxSlots(sp0.id)) {
        var nudging = (i === open.b + 1) || (i === open.a - 1);
        if (nudging) { toast(F.maxUsageMessage(sp0.id)); return; }
        open.a = open.b = i; renderHome(); return;
      }
      open.a = lo; open.b = hi; renderHome(); return;
    }

    var hp = t.closest('[data-hppl]');
    if (hp) {
      if (hp.classList.contains('is-disabled')) return;
      var sp1 = F.getSpace(open.spaceId);
      var n1 = open.people + (+hp.getAttribute('data-hppl'));
      if (n1 < 1) return;
      if (sp1.policy.capacity && n1 > sp1.policy.capacity) { toast(F.capacityMessage(sp1.id)); return; }
      open.people = n1; renderHome(); return;
    }

    var hb = t.closest('[data-hbook]');
    if (hb) {
      if (hb.classList.contains('is-disabled')) return;
      if (hb.classList.contains('is-blocked')) { toast(hb.getAttribute('data-why')); return; }   /* web 예약 규칙 (66차) */
      var sp2 = F.getSpace(hb.getAttribute('data-hbook'));
      var l2 = Math.min(open.a, open.b), h2 = Math.max(open.a, open.b);
      book(sp2, open.slots[l2].start, open.slots[h2].end, open.people);
      return;
    }

    /* ── 탐색 (S-06) ── */
    var fg = t.closest('[data-fgroup]');
    if (fg) { q.path = nextPath(q.path, fg.getAttribute('data-fgroup')); findOpen = { id: '', people: 4 }; renderFind(); return; }
    if (t.closest('[data-fcap]')) { q.cap = !q.cap; findOpen = { id: '', people: 4 }; renderFind(); return; }
    var fq = t.closest('[data-fquick]');
    if (fq) { applyQuick(fq.getAttribute('data-fquick')); return; }
    if (t.closest('[data-fdate]')) { openDateSheet(); return; }
    var ft = t.closest('[data-ftime]');
    if (ft) { openTimeSheet(ft.getAttribute('data-ftime')); return; }
    /* 탐색 — web 예약 규칙에 막힌 줄은 이유만 (66차) */
    var fbk = t.closest('[data-fblock]');
    if (fbk) { toast(fbk.getAttribute('data-fblock')); return; }
    /* 탐색 — 행을 눌러 그 자리에서 인원 고르고 예약 (2026-09-23) */
    var fr0 = t.closest('[data-froom]');
    if (fr0) {
      var fid = fr0.getAttribute('data-froom'), fsp = F.getSpace(fid);
      findOpen = { id: fid, people: Math.min(fsp.policy.capacity || 4, 4) };
      renderFind(); return;
    }
    var fp = t.closest('[data-fppl]');
    if (fp) {
      var sp2 = F.getSpace(findOpen.id), cap2 = sp2.policy.capacity || 99;
      findOpen.people = Math.min(cap2, Math.max(1, findOpen.people + (+fp.getAttribute('data-fppl'))));
      renderFind(); return;
    }
    var fb = t.closest('[data-fbook]');
    if (fb) { var bsp = F.getSpace(fb.getAttribute('data-fbook')); var ppl = findOpen.people; findOpen = { id: '', people: 4 }; book(bsp, q.start, q.end, ppl); return; }


    var rm0 = t.closest('[data-room]');
    if (rm0) { openRoomSheet(rm0.getAttribute('data-room')); return; }

    /* ── 내 예약 (S-16) ── */
    var mt = t.closest('[data-mtab]');
    if (mt) { mineTab = mt.getAttribute('data-mtab'); renderMine(); return; }

    var rv = t.closest('[data-rsv]');
    if (rv) {
      var r = F.getReservation(rv.getAttribute('data-rsv'));
      if (!r) return;
      /* 이용 중이거나 입실 시각이면 제어 페이지, 아니면 예약 상세 */
      if (r.status === 'CHECKED_IN' || F.canIssueCheckinCode(r)) {
        ctlTarget = r; qrLeft = M.QR_TTL_SEC; readerMsg = '';
        push('S-14');
      } else { rsvTarget = r; push('S-15'); }
      return;
    }

    /* ── S-12 QR 체크인 ── */
    if (t.closest('[data-scanhit]')) { scanSubmit('qr'); return; }
    /* 제어 페이지 입실 카드의 「체크인」 — 시각 전이면 흐린 버튼, 이유만 말한다 (65차) */
    var sg = t.closest('[data-scan]');
    if (sg) {
      var rs = F.getReservation(sg.getAttribute('data-scan'));
      if (sg.classList.contains('is-blocked') && rs) { toast(F.hm(rs.start) + '부터 입실할 수 있어요'); return; }
      if (rs) ctlTarget = rs;
      push('S-12'); return;
    }

    /* ── 제어 페이지 ── */
    if (t.closest('#readerRun')) { runReader(); return; }
    if (t.closest('[data-qrnew]')) {
      if (ctlTarget) F.issueCheckinCode(ctlTarget.id);
      qrLeft = M.QR_TTL_SEC; readerMsg = '';
      renderControl(); return;
    }
    var lz = t.closest('[data-light]');
    if (lz) {
      var ld = deviceOf('light'), zid = lz.getAttribute('data-light'), zone = null;
      ld.zones.forEach(function (z) { if (z.id === zid) zone = z; });
      sendCommand(ld, zone.name + (zone.on ? ' 끄기' : ' 켜기'), function () { zone.on = !zone.on; });
      return;
    }
    if (t.closest('[data-hvac]')) {
      var hd = deviceOf('hvac');
      sendCommand(hd, hd.on ? '끄기' : '켜기', function () { hd.on = !hd.on; });
      return;
    }
    var tp = t.closest('[data-temp]');
    if (tp) {
      if (tp.classList.contains('is-disabled')) return;
      var hd2 = deviceOf('hvac'), n = hd2.target + (+tp.getAttribute('data-temp'));
      if (n < hd2.min || n > hd2.max) return;
      sendCommand(hd2, n + '℃로 바꾸기', function () { hd2.target = n; });
      return;
    }
    if (t.closest('[data-fanstep]')) {
      var hd3 = deviceOf('hvac'), f = hd3.fan >= hd3.fanMax ? 1 : hd3.fan + 1;
      sendCommand(hd3, '풍량 ' + f + '단', function () { hd3.fan = f; });
      return;
    }
    var pc = t.closest('[data-plug]');
    if (pc) {
      var pd = deviceOf('plug'), on = pd.channels.some(function (c) { return c.on; });
      sendCommand(pd, on ? '모두 끄기' : '모두 켜기', function () {
        pd.channels.forEach(function (c) { c.on = !on; });
      });
      return;
    }
    var dr = t.closest('[data-door]');
    if (dr) { confirmDoor(); return; }
    var bl = t.closest('[data-blind]');
    if (bl) {
      var bd = deviceOf('blind');
      var lbl = { down: '내리기', up: '올리기', stop: '멈추기' }[bl.getAttribute('data-blind')];
      sendCommand(bd, lbl, function () { });
      return;
    }
    var rt = t.closest('[data-retry]');
    if (rt) {
      var dv2 = F.getDevices(ctlSpaceId()), dev2 = null;
      dv2.items.forEach(function (d) { if (d.id === rt.getAttribute('data-retry')) dev2 = d; });
      if (dev2) sendCommand(dev2, '다시 시도', function () { });
      return;
    }
    if (t.closest('[data-remote]')) { openRemote(); return; }   /* 냉난방 「리모컨 제어」 창 (69차) */
    var sc = t.closest('[data-scene]');
    if (sc) { runScene(sc.getAttribute('data-scene')); return; }
    var xt = t.closest('[data-extend]');
    if (xt) { doExtend(xt.getAttribute('data-extend')); return; }
    var ex = t.closest('[data-exit]');
    if (ex) { confirmExit(ex.getAttribute('data-exit')); return; }
    if (t.closest('#ctlRsv')) { rsvTarget = ctlTarget; push('S-15'); return; }   /* 더보기 시트 대신 아이콘 하나 (2026-09-23) */

    /* ── 제어 이력 ── */
    var lf = t.closest('[data-logfail]');
    if (lf) {
      var lg = null;
      M.controlLog.forEach(function (x) { if (x.id === lf.getAttribute('data-logfail')) lg = x; });
      /* 제어 실패는 관리자에게 자동으로 간다(web 알림 「제어 실패」 문안과 같게) — 사용자가 누를 버튼은 없다 (66차) */
      openSheet({
        title: '왜 실패했나요',
        body: '<p class="note">' + esc(lg.reason || '기기가 응답하지 않았어요') + '</p>' +
          '<p class="note" style="margin-top:var(--sp-2)">관리자에게 자동으로 알렸어요 · 급하면 현장 스위치를 써 주세요</p>'
      });
      return;
    }

    /* ── 예약 상세 ── */
    if (t.closest('#rsvMore')) { openRsvMore(); return; }
    var ra = t.closest('[data-rsvact]');
    if (ra) {
      var act = ra.getAttribute('data-rsvact');
      closeSheet();
      if (act === 'ctl') { ctlTarget = rsvTarget; qrLeft = M.QR_TTL_SEC; readerMsg = ''; push('S-14'); }
      if (act === 'scan') { ctlTarget = rsvTarget; push('S-12'); }
      else if (act === 'cancel') { confirmCancel(); }
      else if (act === 'log') { ctlTarget = rsvTarget; push('S-14b'); }
      /* 같은 회의실 다시 예약 — 검색 결과처럼 홈에서 그 회의실 줄을 바로 펼친다 (65차) */
      else if (act === 'again') {
        var asp = F.getSpace(rsvTarget.spaceId);
        homePath = F.groupPath(asp.floor); homeCap = false;
        closeRow(); goRoot(); openRow(asp.id);
      }
      return;
    }

    /* ── 검색 ── */
    var kw = t.closest('[data-kw]');
    if (kw) { searchQ = kw.getAttribute('data-kw'); renderSearch(); return; }
    var jp = t.closest('[data-jump]');
    if (jp) {
      var s = F.getSpace(jp.getAttribute('data-jump'));
      homePath = F.groupPath(s.floor); searchQ = '';
      closeRow();
      goTab('S-05');
      openRow(s.id);
      return;
    }

    /* ── 알림 ── */
    /* 알림 설정 — 이 폰에서 울릴지. 전체를 끄면 종류별 스위치는 흐려진다(값은 그대로 기억) (70차) */
    if (t.closest('[data-notiall]')) { var ns = M.notifySettings; ns.all = !ns.all; F.savePush(ns); renderNotifySet(); return; }
    var nt = t.closest('[data-noti]');
    if (nt) {
      if (!M.notifySettings.all) return;
      var ns2 = M.notifySettings, nk = nt.getAttribute('data-noti').split('|');
      var nl = nk[0] === '_account' ? ns2.account : ((ns2.groups.filter(function (g) { return g.code === nk[0]; })[0] || { items: [] }).items);
      nl.forEach(function (x) { if (x.id === nk[1]) x.on = !x.on; });
      F.savePush(ns2); renderNotifySet(); return;
    }
    var ng = t.closest('[data-notigo]');
    if (ng) {
      var n2 = null;
      allNotis().forEach(function (x) { if (x.id === ng.getAttribute('data-notigo')) n2 = x; });
      if (!n2) return;
      if (n2.kind === 'member') {   /* 가입 결과 — 그 소속의 상세(바꾸기 · 다시 신청) (74차) */
        A.markRead(n2.id); renderNotify();
        var nm2 = myMembers().filter(function (x) { return x.id === n2.memberId; })[0];
        if (nm2) openMemberSheet(nm2);
        return;
      }
      n2.read = true;
      rsvTarget = F.getReservation(n2.reservationId);
      renderNotify();
      if (rsvTarget) push('S-15');
      return;
    }


    /* ── 로그인 (S-02) — 간편 로그인 4종 · 휴대폰 번호 (72차) ── */
    var soc = t.closest('[data-social]');
    if (soc) { socialLogin(soc.getAttribute('data-social')); return; }
    var lm = t.closest('[data-loginmode]');
    if (lm) { loginMode = lm.getAttribute('data-loginmode'); loginErr = ''; renderLogin(); return; }
    if (t.closest('#loginGo')) { doLogin(); return; }
    if (t.closest('#pwEye')) {
      var pw = $('#loginPw'); pw.type = pw.type === 'password' ? 'text' : 'password'; return;
    }
    if (t.closest('#autoLogin')) { t.closest('#autoLogin').classList.toggle('is-on'); return; }
    if (t.closest('#pwForgot')) {
      openSheet({
        title: '비밀번호를 잊었나요',
        /* 임시 비밀번호는 없어졌다 — 계정이 회사 것이 아니라 사람 것이라 관리자가 발급하지 않는다.
           휴대폰 인증으로 다시 정하기는 문자 인증과 함께 추후 (72차) */
        body: '<p class="note">휴대폰 인증으로 다시 정하는 기능을 준비하고 있어요<br>간편 로그인으로 가입했다면 그 방법으로 로그인해 주세요</p>'
      });
      return;
    }

    /* ── 회원가입 (S-26) ── */
    if (t.closest('[data-joinstart]')) {
      joinMode = 'phone'; joinErr = ''; joinForm = null; joinAgree = { terms: false, privacy: false };
      pushTo('S-26'); return;
    }
    var agb = t.closest('[data-agree]');
    if (agb) {
      joinForm = readJoinForm();
      var ak = agb.getAttribute('data-agree');
      if (ak === 'all') { var allOn = !(joinAgree.terms && joinAgree.privacy); joinAgree = { terms: allOn, privacy: allOn }; }
      else joinAgree[ak] = !joinAgree[ak];
      renderJoinForm(); return;
    }
    if (t.closest('#joinGo')) { doJoin(); return; }

    /* ── 회사 — 홈 헤더 시트 · 마이 · 회사 추가 S-25 (72차) ── */
    if (t.closest('[data-cosheet]')) { openCoSheet(); return; }
    if (t.closest('[data-coadd]')) { closeSheet(); openJoin(''); return; }
    var cw = t.closest('[data-cosw]');
    if (cw) {
      var cm = myMembers().filter(function (x) { return x.id === cw.getAttribute('data-cosw'); })[0];
      if (!cm) return;
      if (cm.status === 'ACTIVE') { closeSheet(); if (upper(cm.companyCode) !== coCode) switchCo(cm.companyCode); return; }
      openMemberSheet(cm); return;   /* 승인 대기 · 반려는 시트 안에서 상세로 */
    }
    var clv = t.closest('[data-coleave]'), ccn = t.closest('[data-cocancel]');
    if (clv || ccn) {
      var lm2 = myMembers().filter(function (x) { return x.id === (clv || ccn).getAttribute(clv ? 'data-coleave' : 'data-cocancel'); })[0];
      if (lm2) { if (clv) confirmLeave(lm2); else confirmCancelApply(lm2); }
      return;
    }
    if (t.closest('[data-acctdel]')) { confirmDeleteAccount(); return; }
    var cmb = t.closest('[data-comember]');
    if (cmb) {
      var mm = myMembers().filter(function (x) { return x.id === cmb.getAttribute('data-comember'); })[0];
      if (mm) openMemberSheet(mm);
      return;
    }
    var rj = t.closest('[data-rejoin]');
    if (rj) {
      var rm = myMembers().filter(function (x) { return x.id === rj.getAttribute('data-rejoin'); })[0];
      if (rm) openJoin(rm.companyCode, rm);
      return;
    }
    if (t.closest('#joinCodeGo')) { doJoinCode(); return; }
    var jcb = t.closest('[data-jc]');
    if (jcb && coJoin) {
      var jk = jcb.getAttribute('data-jc');
      if (jk === 'reset') { coJoin.co = null; coJoin.err = ''; renderJoinCode(); var ji = $('#joinCode'); if (ji) ji.focus(); return; }
      if (jk === 'dept') { openDeptSheet(); return; }
      if (jk === 'rank') { openRankSheet(); return; }
      if (jk === 'agree') { coJoin.agree = !coJoin.agree; coJoin.err = ''; renderJoinCode(); return; }
      return;
    }
    var pd = t.closest('[data-pickdept]');
    if (pd && coJoin) { coJoin.deptId = pd.getAttribute('data-pickdept'); coJoin.err = ''; closeSheet(); renderJoinCode(); return; }
    var pr = t.closest('[data-pickrank]');
    if (pr && coJoin) { coJoin.rankId = pr.getAttribute('data-pickrank'); coJoin.err = ''; closeSheet(); renderJoinCode(); return; }

    if (t.closest('#pwGo')) { doPwChange(); return; }
    if (t.closest('#demoReset')) {
      /* 프로토타입 도구 — 회사코드 1111 연출을 처음부터 다시 (73차) */
      A.removeMembersOf('1111');
      memberSnap = snapMembers();
      if (!curMember()) useCo(null); else applyMe();
      goRoot();
      toast('회사코드 1111 가입을 지웠어요 · 다시 연출할 수 있어요');
      return;
    }
    if (t.closest('#joinReset')) {
      /* 프로토타입 도구 — 앱 계정 · 소속 · 세션을 지우고 데모 계정으로 (72차) */
      A.reset(); signIn(A.userById(A.DEMO_ID)); loginMode = 'pick'; joinAfter = null;
      goRoot();
      toast('앱 계정을 처음 상태로 돌렸어요');
      return;
    }

    /* ── 마이 ── */
    var mn = t.closest('[data-menu]');
    if (mn) {
      var m = mn.getAttribute('data-menu');
      if (m === 'logout') {
        openSheet({
          title: '로그아웃할까요',
          body: '<p class="note">다음에 다시 로그인해야 해요</p>',
          cta: { label: '로그아웃하기', kind: 'danger', onClick: function () {
            signOut(); loginMode = 'pick'; loginErr = '';
            apply(['S-02'], 'push'); history.pushState({ stack: stack.slice() }, '', '#S-02');
          } }
        });
        return;
      }
      if (m === 'S-28') pwErr = '';
      if (push(m)) return;
      notReady(mn.textContent.trim());
      return;
    }

    /* ── 프로토타입 도구 ── */
    var tb = t.closest('[data-tool]');
    if (tb) {
      var k = tb.getAttribute('data-tool'), v = tb.getAttribute('data-val');
      if (k === 'id' || k === 'spec' || k === 'gray') TOOL[k] = v === 'on';
      else TOOL[k] = v;

      if (k === 'home') { if (!applyHomeMode(v)) toast('홈 상태는 대양씨아이에스 데이터에서만 바뀌어요'); }
      else if (k === 'dev') applyDeviceMode(v);
      else if (k === 'reader') readerMode = v;
      else if (k === 'brand') M.branding.headerVariant = v;

      paint(stack[stack.length - 1]);
      applyTools();
      return;
    }
    if (t.closest('#flowRun')) {
      if (!user || F.companyKey() !== 'DY' || !hasCo()) { toast('플로우 재생은 대양씨아이에스로 로그인했을 때 돼요'); return; }   /* 72차 */
      runFlow(); return;
    }
  });

  /* 슬라이더 — 놓았을 때 한 번만 보낸다. 전송 전에는 값이 되돌아간다 */
  document.addEventListener('change', function (e) {
    if (e.target.matches('[data-bright]')) {
      var ld = deviceOf('light'), v = +e.target.value;
      e.target.value = ld.brightness;
      sendCommand(ld, '밝기 ' + v + '%', function () { ld.brightness = v; });
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'searchInput') { searchQ = e.target.value; renderSearch(); return; }
    /* 휴대폰 번호는 치는 대로 010-1234-5678 (72차) */
    if (e.target.id === 'loginPhone' || e.target.getAttribute('data-jf') === 'phone') { e.target.value = A.phoneFmt(e.target.value); return; }
    if (e.target.id === 'joinCode' && coJoin) { coJoin.code = e.target.value; return; }
    var jcf = e.target.getAttribute('data-jcf');
    if (jcf && coJoin) { coJoin[jcf] = e.target.value; return; }
  });


  /* ── 부팅 ────────────────────────────────────────────────── */

  function boot() {
    var st = $('#statusTime');
    if (st) st.textContent = F.hm(M.NOW);

    initQuery();
    wireSheetDrag();

    /* 계정 — 이 폰의 세션(accounts.js). 처음 여는 폰(세션 없음)과 미리보기(?still=1)는 데모 계정 김도현으로 (72차) */
    var ses = noSes() ? null : A.session();
    var su = !ses ? (DEMO ? null : A.userById(A.DEMO_ID)) : ses.userId ? A.userById(ses.userId) : null;   /* 시연판의 첫 실행은 로그인부터 (79차) */
    if (su) signIn(su);

    /* 관리자가 web에서 알림 정책을 바꾸면 알림 설정 목록이 그 자리에서 바뀐다 (70차) */
    window.addEventListener('storage', function (e) {
      if (e.key !== 'siot.mr.notify.v1') return;
      M.notifySettings = F.readNotify(activeCos());
      if (stack[stack.length - 1] === 'S-20') renderNotifySet();
    });
    /* 관리자 web 회원(A-05)에서 승인 · 반려 · 퇴사 처리하거나, 설정(A-08)에서 부서 · 직급 · 회사코드를 바꾸면 그 자리에서 바뀐다.
       storage 이벤트는 「다른 탭이 바꿨을 때」만 오므로 자기 변경과 부딪히지 않는다 (72차) */
    var syncTimer = null;
    window.addEventListener('storage', function (e) {
      if (!user || [A.MKEY, A.OKEY, A.CKEY].indexOf(e.key) === -1) return;
      clearTimeout(syncTimer);
      syncTimer = setTimeout(syncMembers, 80);   /* web이 소속 · 회사코드를 잇달아 쓰면 한 번에 (72차) */
    });

    if (PRESET_HOME) {
      if (user && F.companyKey() !== 'DY' && activeOf(A.webCode())) useCo(A.webCode());   /* 홈 상태 더미는 대양씨아이에스 것 (72차) */
      TOOL.home = PRESET_HOME; applyHomeMode(PRESET_HOME);
    }

    var hash = (location.hash || '').replace('#', '');
    var start = known(hash) ? hash : ROOT;
    stack = start === ROOT ? [ROOT] : [ROOT, start];
    /* 로그인 · 가입은 홈 위에 얹지 않는다. 로그아웃 상태면 그 밖의 화면은 로그인으로 (72차) */
    if (AUTH.indexOf(start) !== -1) stack = start === 'S-26' ? ['S-02', 'S-26'] : [start];
    else if (!user) { start = 'S-02'; stack = ['S-02']; }

    /* 가입 링크 — /app?join={회사코드} (2026-09-28 · 72차). 로그인돼 있으면 회사 추가가 코드를 채워 열리고,
       아니면 로그인부터 — 로그인 · 가입을 마치면 회사 추가로 이어진다. 관리자가 코드를 바꿔 옛 링크가 됐으면 코드 입력부터 */
    var jm = location.search.match(/[?&]join=([^&#]+)/);
    /* 한 번 쓴 가입 링크는 주소에서 뺀다 — 새로 고치면 회사 추가가 다시 열리지 않게 (72차) */
    var url0 = jm ? location.pathname + location.search.replace(/([?&])join=[^&#]*&?/, '$1').replace(/[?&]$/, '') : '';
    if (jm) {
      var jc = '';
      try { jc = upper(decodeURIComponent(jm[1])); } catch (err) { jc = upper(jm[1]); }   /* 깨진 링크도 앱은 뜬다 */
      if (user) { linkJoin(jc); start = 'S-25'; stack = [ROOT, 'S-25']; }
      else { joinAfter = jc; start = 'S-02'; stack = ['S-02']; }
    }

    paint(start);
    screenEl(start).classList.add('is-active');
    /* 두 장 이상으로 시작하면(가입 링크 · 해시 진입) 아래 장을 브라우저 기록에도 깔아 둔다 —
       안 그러면 ‹ (history.back)가 앱 밖으로 나간다. 미리보기(?still=1)는 부모 기록을 늘리지 않게 뺀다 (65차) */
    if (stack.length > 1 && !STILL) {
      var below = stack.slice(0, -1);
      history.replaceState({ stack: below }, '', url0 + '#' + below[below.length - 1]);
      history.pushState({ stack: stack.slice() }, '', '#' + start);
    } else {
      history.replaceState({ stack: stack.slice() }, '', url0 + '#' + start);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
