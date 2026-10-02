/* ============================================================
   site.js — 현장 웹 (SIOT 신설 「회의실 예약 솔루션」 · 앱 없이 QR로 들어와 제어 · 안내)
   정본: ../현장웹_기획.md §1–4 · §7 · §8
   ------------------------------------------------------------
   ES 모듈 아님 · 프레임워크 없음 · app.js / mock.js를 읽지 않는다(필요한 규칙만 옮겼다).

   화면
     G-01 번호 확인 — 인증 전에는 회의실 이름 · 그룹 · 지금 상태만(개인 정보 없음)
     주의사항 시트 — 인증 직후 한 번(그 회의실 주의사항이 있을 때만)
     G-02 이용 — 탭 「제어 | 안내」. 제어는 앱 S-14와 같은 규칙(낙관적 UI 없음 · 문 열기 3초 뒤 잠김 · 30분 연장 · 퇴실)
     G-03 이용 끝 — 퇴실 · 예약 시간 끝 두 가지

   주소
     ?r=MA13-2&c=482915   현황판 QR — 코드는 실제 시계로 5분마다 바뀐다(지금 · 바로 전 코드만 받는다)
     ?r=PB-A              스티커 QR — 현황판이 없는 방(코드 없음)
     ?t=1605              시연 시각(없으면 14:18) — 시연 도구가 붙인다
     ?preview=1&r=ID&tab=info   관리자 web A-12 드로어 미리보기 — 인증 없이 G-02 「안내」, 저장소에 쓰지 않는다
                                 postMessage({type:'site-content', data:<siot.mr.site.v1 모양> | null}) · ({type:'site-room', r})
                                 준비되면 parent에 {type:'site-ready', r}
     ?demo=1              시연 도구 바로 열기(빈 곳 0.8초 길게 누르기와 같다)

   저장소(같은 origin localhost:8105에서 관리자 web과 공유 — 제품에서는 서버가 갖는다)
     siot.mr.site.v1         { v:1, rooms:{ 회의실 이름:{ notices:[N], cautions:[C] } }, common:{ notices:[N] }, ads:[A] }
                             키가 아예 없을 때만 처음 값(SITE_SEED) · 있으면 그대로(rooms에 없는 방 = 비움)
     siot.mr.sitesession.v1  { 회의실 ID:{ name, start, end, at, seen?, out? } } — 이 폰의 인증. 종료 시각(연장하면 함께)까지
                             seen = 본 공지 id(안내 탭 점) · out = 퇴실 시각
     siot.mr.sitelock.v1     { 회의실 ID:{ fails, until } } — 5회 연속 실패 → 5분 잠금(until = 실제 시계 ms)
   ============================================================ */

(function () {
  'use strict';

  /* ── 기준 · 규칙 ─────────────────────────────────────────── */

  var DAY = '2026-09-09';                 /* 관리자 web과 같은 날 · 2026-09-09(수) */
  var BASE_NOW = 14 * 60 + 18;            /* 14:18 고정 — 시연 도구로만 바꾼다 */
  var CLOSE_MIN = 19 * 60;                /* 운영 시간 끝(회의실 기본값 09:00–19:00) */
  var EXTEND_MIN = 30;                    /* 30분 연장 — 뒤 30분이 비어 있고 운영 시간 안일 때만 (57차) */
  var LOCK_FAILS = 5, LOCK_MS = 5 * 60 * 1000;
  var CONFIRM_MS = 1200, FAIL_MS = 3000, DOOR_RELOCK_MS = 3000, AUTO_MS = 1600;
  var K_SITE = 'siot.mr.site.v1', K_SESS = 'siot.mr.sitesession.v1', K_LOCK = 'siot.mr.sitelock.v1';
  var DEFAULT_ROOM = 'MA13-2';
  /* 「앱으로 열기 · SIOT 앱 받기」 — 프로토타입은 앱 시안으로. 배포판(_build.cjs)은 시연 앱 주소로 바꾼다 · 제품은 유니버설 링크 */
  var APP_URL = '../'; /* @build:app-url */

  /* 현황판과 같은 코드 — 5분마다 바뀐다 (현장웹_기획.md §4 · 태블릿_예약현황.html codeNow) */
  function codeNow(t) { var slot = Math.floor((t || Date.now()) / 300000); var x = (slot * 2654435761 + 97) >>> 0; return String(100000 + (x % 900000)); }

  /* ── 데이터 — 관리자 web(A-02 회의실 상세 · A-03 예약 · 현황판)과 같은 방 · 같은 예약 ──
     기기: A-02 DEVICES [종류, 위치, 상태, 지금 값] · 버튼: A-02 ROOMS[이름].btns [[버튼, SIOT 자동화]] (0 입실 · 1 퇴실 · 2~ 추가) */
  var DEV = {
    'LT-0801': ['조명', '8층 화상회의실', 'ok', '꺼짐'], 'AC-0801': ['냉난방', '8층 화상회의실', 'ok', '대기'], 'DL-0801': ['도어락', '8층 화상회의실 문', 'ok', '잠김'], 'TV-0801': ['화상장비', '8층 화상회의실', 'ok', '켜짐'],
    'LT-0901': ['조명', '9층 화상회의실', 'ok', '꺼짐'], 'AC-0901': ['냉난방', '9층 화상회의실', 'ok', '대기'], 'DL-0901': ['도어락', '9층 화상회의실 문', 'ok', '잠김'], 'TV-0901': ['화상장비', '9층 화상회의실', 'ok', '꺼짐'],
    'LT-1001': ['조명', '10층 화상 스튜디오', 'ok', '꺼짐'], 'AC-1001': ['냉난방', '10층 화상 스튜디오', 'bad', '오프라인 · 이틀째'], 'TV-1001': ['화상장비', '10층 화상 스튜디오', 'ok', '꺼짐'],
    'LT-1101': ['조명', '11층 대회의실 천장', 'ok', '켜짐'], 'LT-1102': ['조명', '11층 대회의실 벽면', 'ok', '켜짐'], 'AC-1101': ['냉난방', '11층 대회의실', 'ok', '냉방 23°C'],
    'PW-1101': ['콘센트', '11층 대회의실 빔', 'ok', '켜짐'], 'BL-1101': ['블라인드', '11층 대회의실', 'ok', '열림'], 'DL-1101': ['도어락', '11층 대회의실 문', 'ok', '잠김'], 'TV-1101': ['TV', '11층 대회의실 75인치', 'ok', '꺼짐'],
    'LT-1103': ['조명', '11층 소회의실', 'ok', '꺼짐'], 'AC-1102': ['냉난방', '11층 소회의실', 'ok', '냉방 24°C'], 'PW-1102': ['콘센트', '11층 소회의실', 'ok', '켜짐'], 'DL-1102': ['도어락', '11층 소회의실 문', 'ok', '잠김'],
    'LT-1104': ['조명', '11층 폰부스 A', 'ok', '켜짐'], 'AC-1104': ['냉난방', '11층 폰부스 A', 'ok', '냉방 24°C'], 'LT-1105': ['조명', '11층 폰부스 B', 'ok', '꺼짐'], 'AC-1105': ['냉난방', '11층 폰부스 B', 'ok', '대기'],
    'LT-1301': ['조명', '13층 회의실 1', 'ok', '꺼짐'], 'AC-1301': ['냉난방', '13층 회의실 1', 'bad', '오프라인 · 3시간째'], 'PW-1301': ['콘센트', '13층 회의실 1', 'ok', '꺼짐'], 'DL-1301': ['도어락', '13층 회의실 1 문', 'ok', '잠김'],
    'LT-1302': ['조명', '13층 회의실 2', 'ok', '꺼짐'], 'AC-1302': ['냉난방', '13층 회의실 2', 'ok', '대기'], 'DL-1302': ['도어락', '13층 회의실 2 문', 'ok', '잠김'],
    'LT-1401': ['조명', '14층 세미나실 천장', 'ok', '꺼짐'], 'LT-1402': ['조명', '14층 세미나실 무대', 'ok', '꺼짐'], 'AC-1401': ['냉난방', '14층 세미나실 앞', 'ok', '대기'], 'AC-1402': ['냉난방', '14층 세미나실 뒤', 'ok', '대기'],
    'PW-1401': ['콘센트', '14층 세미나실 연단', 'ok', '꺼짐'], 'BL-1401': ['블라인드', '14층 세미나실', 'ok', '열림'], 'DL-1401': ['도어락', '14층 세미나실 문', 'ok', '잠김'], 'PJ-1401': ['빔프로젝터', '14층 세미나실', 'ok', '꺼짐'],
    'LT-1501': ['조명', '15층 협업실', 'ok', '켜짐'], 'AC-1501': ['냉난방', '15층 협업실', 'ok', '냉방 23°C'], 'PW-1501': ['콘센트', '15층 협업실', 'ok', '켜짐'], 'BL-1501': ['블라인드', '15층 협업실', 'ok', '닫힘'], 'DL-1501': ['도어락', '15층 협업실 문', 'ok', '잠김'],
    'LT-1502': ['조명', '15층 브리핑룸', 'ok', '꺼짐'], 'DL-1502': ['도어락', '15층 브리핑룸 문', 'ok', '잠김'], 'LT-1503': ['조명', '15층 여성휴게실', 'ok', '꺼짐'], 'AC-1503': ['냉난방', '15층 여성휴게실', 'ok', '대기'],
    'LT-1801': ['조명', '18층 대강당', 'ok', '꺼짐'], 'AC-1801': ['냉난방', '18층 대강당', 'ok', '대기'], 'BL-1801': ['블라인드', '18층 대강당', 'bad', '오프라인 · 어제부터'], 'DL-1801': ['도어락', '18층 대강당 문', 'ok', '잠김'], 'PJ-1801': ['빔프로젝터', '18층 대강당', 'ok', '꺼짐']
  };

  /* 회의실 — id(QR 주소의 r) · 이름 · 그룹 · 입장 인증(qr · reader · free) · 현황판(있으면 현황판 QR, 없으면 스티커) · 상태(fix 점검 중 · off 사용 안 함)
     rsv = 오늘 예약 [시작, 끝, 예약자, 휴대폰 뒤 4자리, 아직 입실 전(인증 방만 의미)] — 예약자 이름은 화면에 보이지 않는다(시연 도구만) */
  var ROOMS = [
    { id: 'MA08-1', name: 'MA08-1 화상회의실', group: '본관 › 8층', floor: '8층', entry: 'reader', signage: true,
      devs: ['LT-0801', 'AC-0801', 'DL-0801', 'TV-0801'], btns: [['입실', '화상회의'], ['퇴실', '퇴실']],
      rsv: [['10:00', '11:00', '류지훈', '3307'], ['16:00', '17:00', '황보라', '6612', 1]] },
    { id: 'MA09-1', name: 'MA09-1 화상회의실', group: '본관 › 9층', floor: '9층', entry: 'reader', signage: true,
      devs: ['LT-0901', 'AC-0901', 'DL-0901', 'TV-0901'], btns: [['입실', '화상회의'], ['퇴실', '퇴실']],
      rsv: [['15:00', '16:00', '고은샘', '9041', 1]] },
    { id: 'MA10-1', name: 'MA10-1 화상 스튜디오', group: '본관 › 10층', floor: '10층', entry: 'qr', signage: true, state: 'fix',
      devs: ['LT-1001', 'AC-1001', 'TV-1001'], btns: [['입실', '화상회의'], ['퇴실', '']], rsv: [] },
    { id: 'MA11-1', name: 'MA11-1 대회의실', group: '본관 › 11층', floor: '11층', entry: 'qr', signage: true,
      devs: ['LT-1101', 'LT-1102', 'AC-1101', 'PW-1101', 'BL-1101', 'DL-1101', 'TV-1101'], btns: [['입실', '회의 시작'], ['퇴실', '퇴실'], ['발표 모드', '발표 모드']],
      rsv: [['09:00', '11:00', '박서연', '2486'], ['14:00', '15:00', '김도현', '3753'], ['16:00', '17:00', '박지훈', '1111', 1]] },
    { id: 'MA11-2', name: 'MA11-2 소회의실', group: '본관 › 11층', floor: '11층', entry: 'free', signage: true,
      devs: ['LT-1103', 'AC-1102', 'PW-1102', 'DL-1102'], btns: [['입실', '회의 시작'], ['퇴실', '퇴실']],
      rsv: [['09:00', '10:00', '최은영', '4201'], ['13:00', '15:00', '이수민', '0655']] },
    { id: 'PB-A', name: '폰부스 A', group: '본관 › 11층', floor: '11층', entry: 'free', signage: false,
      devs: ['LT-1104', 'AC-1104'], btns: [['입실', ''], ['퇴실', '']],
      rsv: [['10:00', '11:00', '심우진', '1530'], ['14:00', '15:00', '한소라', '2098'], ['15:00', '15:30', '윤재호', '5561'], ['16:00', '17:00', '구본석', '8826']] },
    { id: 'PB-B', name: '폰부스 B', group: '본관 › 11층', floor: '11층', entry: 'free', signage: false,
      devs: ['LT-1105', 'AC-1105'], btns: [['입실', ''], ['퇴실', '']],
      rsv: [['13:00', '14:00', '천유미', '4470'], ['17:00', '18:00', '권다인', '7184']] },
    { id: 'MA12-2', name: 'MA12-2 (소비자 보호팀 옆)', group: '본관 › 12층', floor: '12층', entry: 'free', signage: true,
      devs: [], btns: [['입실', ''], ['퇴실', '']],
      rsv: [['10:00', '11:00', '조은지', '5092'], ['15:00', '16:00', '김태윤', '6638'], ['16:00', '17:00', '정다은(외부 손님)', '5678']] },
    { id: 'WL-12', name: '여성휴게실 12층', group: '본관 › 12층', floor: '12층', entry: 'free', signage: false,
      devs: [], btns: [['입실', ''], ['퇴실', '']], rsv: [] },
    { id: 'MA13-1', name: 'MA13-1 회의실', group: '본관 › 13층', floor: '13층', entry: 'qr', signage: true, state: 'fix',
      devs: ['LT-1301', 'AC-1301', 'PW-1301', 'DL-1301'], btns: [['입실', '회의 시작'], ['퇴실', '퇴실']], rsv: [] },
    { id: 'MA13-2', name: 'MA13-2 회의실', group: '본관 › 13층', floor: '13층', entry: 'qr', signage: true,
      devs: ['LT-1302', 'AC-1302', 'DL-1302'], btns: [['입실', '회의 시작'], ['퇴실', '퇴실']],
      rsv: [['13:00', '14:00', '오세준', '2215'], ['14:00', '15:00', '최은영', '4201', 1]] },
    { id: 'MA14-1', name: 'MA14-1 세미나실', group: '본관 › 14층', floor: '14층', entry: 'reader', signage: true,
      devs: ['LT-1401', 'LT-1402', 'AC-1401', 'AC-1402', 'PW-1401', 'BL-1401', 'DL-1401', 'PJ-1401'], btns: [['입실', '회의 시작'], ['퇴실', '퇴실'], ['발표 모드', '발표 모드']],
      rsv: [['09:00', '12:00', '강민지', '3349'], ['15:00', '17:00', '홍유진', '9915', 1]] },
    { id: 'MA15-1', name: 'MA15-1 협업실', group: '본관 › 15층', floor: '15층', entry: 'free', signage: true,
      devs: ['LT-1501', 'AC-1501', 'PW-1501', 'BL-1501', 'DL-1501'], btns: [['입실', '회의 시작'], ['퇴실', '퇴실'], ['발표 모드', '발표 모드']],
      rsv: [['14:00', '16:00', '정민석', '7720'], ['17:00', '18:00', '백승호', '6027']] },
    { id: 'MA15-2', name: 'MA15-2 브리핑룸', group: '본관 › 15층', floor: '15층', entry: 'qr', signage: false,
      devs: ['LT-1502', 'DL-1502'], btns: [['입실', '회의 시작'], ['퇴실', '']],
      rsv: [['11:00', '12:00', '문지영', '7712']] },
    { id: 'MA18-1', name: 'MA18-1 대강당', group: '별관 › 18층', floor: '18층', entry: 'reader', signage: true,
      devs: ['LT-1801', 'AC-1801', 'BL-1801', 'DL-1801', 'PJ-1801'], btns: [['입실', ''], ['퇴실', '퇴실'], ['발표 모드', '발표 모드']],
      rsv: [['09:00', '12:00', '전사 월례회', '3001'], ['15:00', '17:00', '신입 오리엔테이션', '3002', 1]] },
    { id: 'WL-15', name: '여성휴게실 15층', group: '본관 › 15층', floor: '15층', entry: 'free', signage: false, state: 'off',
      devs: ['LT-1503', 'AC-1503'], btns: [['입실', ''], ['퇴실', '']], rsv: [] }
  ];

  /* siot.mr.site.v1 처음 값 — 관리자 web A-12와 id까지 같다(키가 아예 없을 때만 쓴다) */
  var SITE_SEED = {
    v: 1,
    rooms: {
      'MA13-2 회의실': {
        notices: [{ id: 'N-1302-1', title: 'HDMI 케이블 위치', body: '화상 장비 HDMI 케이블은 책상 서랍에 있어요', from: '2026-09-01', to: '2026-09-30' }],
        cautions: [{ id: 'C-1302-1', text: '뚜껑 있는 음료만 들고 와 주세요' }, { id: 'C-1302-2', text: '퇴실할 때 화이트보드를 지워 주세요' }, { id: 'C-1302-3', text: '창문은 열지 마세요(공조)' }]
      },
      'MA11-1 대회의실': { notices: [], cautions: [{ id: 'C-1101-1', text: '대회의실 마이크는 퇴실할 때 충전대에' }] }
    },
    common: { notices: [{ id: 'N-C-1', title: '9/12(토) 11층 공조 점검', body: '10:00–11:00 냉난방이 멈춰요', from: '2026-09-01', to: '2026-09-12' }] },
    ads: [
      { id: 'A-1', title: '사내 카페 가을 신메뉴 · 2층', img: null, link: '', from: '2026-09-01', to: '2026-09-30' },
      { id: 'A-2', title: '10월 사내 봉사활동 신청', img: null, link: '', from: '2026-09-01', to: '2026-10-31' }
    ]
  };

  /* SIOT 자동화가 기기에 하는 일 — 실제로는 SIOT가 실행한다(이름은 A-02 버튼 매핑 · AUTOS 설명과 같게) */
  var AUTOS = {
    '회의 시작': function (d) {
      if (d.kind === 'light') d.on = true;
      if (d.kind === 'hvac') d.on = true;
      if (d.kind === 'plug') d.on = true;
    },
    '화상회의': function (d) {
      if (d.kind === 'light') d.on = true;
      if (d.kind === 'power' && d.label === '화상장비') d.on = true;
    },
    '발표 모드': function (d) {
      if (d.kind === 'light') d.on = true;
      if (d.kind === 'blind') d.pos = 0;
      if (d.kind === 'power' || d.kind === 'plug') d.on = true;
    },
    '퇴실': function (d) {
      if (d.kind === 'door') d.locked = true;
      else if (d.kind !== 'blind') d.on = false;
    }
  };
  var AUTO_BRIGHT = { '회의 시작': 100, '화상회의': 70, '발표 모드': 30 };

  var KIND = { '조명': 'light', '냉난방': 'hvac', '콘센트': 'plug', '블라인드': 'blind', '도어락': 'door', 'TV': 'power', '화상장비': 'power', '빔프로젝터': 'power' };
  var LABEL = { '도어락': '도어' };


  /* ── 작은 도구 ───────────────────────────────────────────── */

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function icon(n, cls) { return '<svg class="icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + n + '"/></svg>'; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hm(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function toMin(s) { var p = String(s).split(':'); return +p[0] * 60 + +p[1]; }
  function iso(m) { return DAY + 'T' + hm(m); }
  function fromIso(s) {
    var m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(s || '');
    return m && m[1] === DAY ? +m[2] * 60 + +m[3] : null;
  }
  function arr(a) { return Array.isArray(a) ? a.filter(function (x) { return x && typeof x === 'object'; }) : []; }
  function byId(id) { return ROOMS.filter(function (r) { return r.id === id; })[0] || null; }
  function leftLabel(m) { return m >= 60 ? Math.floor(m / 60) + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : '') : m + '분'; }
  var WEEK = '일월화수목금토';
  function dateLabel(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return '';
    return (+m[2]) + '/' + (+m[3]) + '(' + WEEK[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] + ')';
  }

  /* 저장소 — 시크릿 창 · 막힌 저장소에서도 화면은 그대로 돈다. 미리보기는 읽기만 */
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function save(k, v) { if (PREVIEW) return; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 이 화면은 계속 */ } }
  function drop(k) { if (PREVIEW) return; try { localStorage.removeItem(k); } catch (e) { /* 위와 같다 */ } }
  function objOf(k) { var o = load(k); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }


  /* ── 상태 ────────────────────────────────────────────────── */

  var Q = new URLSearchParams(location.search);
  var PREVIEW = Q.get('preview') === '1';
  if (PREVIEW) document.documentElement.classList.add('is-preview');

  function parseT(s) { var m = /^(\d{2}):?(\d{2})$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; }

  var S = {
    rid: Q.get('r') || DEFAULT_ROOM,
    code: Q.get('c') || null,
    now: parseT(Q.get('t')) || BASE_NOW,
    tab: PREVIEW && Q.get('tab') === 'ctl' ? 'ctl' : (PREVIEW ? 'info' : 'ctl'),
    digits: '',
    msg: null,                /* { tone:'bad'|'wait', text } — G-01 칸 아래 한 줄 */
    devFail: false,           /* 시연 도구 「응답 없음」 — 모든 명령이 3초 뒤 실패 */
    override: null,           /* 미리보기 — 관리자 web이 보낸 저장 전 편집값 */
    focus: !PREVIEW
  };
  /* r 없이 열면 시연 기본 무대(MA13-2 · 지금 현황판 코드) */
  if (!Q.get('r') && !PREVIEW) S.code = codeNow();

  var room = null, RT = null;
  var pending = {}, failed = {};
  var autoRun = null, autoDone = null, remoteId = null;


  /* ── 회의실 런타임 — 예약(연장 · 입실) · 기기 값. 화면을 다시 열면 처음 값 + 이 폰의 세션 ── */

  function setRoom(id) {
    S.rid = id;
    room = byId(id);
    pending = {}; failed = {}; autoRun = autoDone = remoteId = null;
    if (!room) { RT = null; return; }
    document.title = room.name + ' · SIOT';

    var count = {};
    room.devs.forEach(function (id2) { var d = DEV[id2]; if (d) count[d[0]] = (count[d[0]] || 0) + 1; });
    RT = {
      rsv: room.rsv.map(function (x) { return { s: toMin(x[0]), e: toMin(x[1]), who: x[2], n4: x[3], wait: !!x[4], done: false }; }),
      dev: [], door: null, bright: 80
    };
    room.devs.forEach(function (id2) {
      var d = DEV[id2];
      if (!d) return;
      var words = d[1].split(' ');
      var o = { id: id2, kind: KIND[d[0]], label: LABEL[d[0]] || d[0], sub: words[words.length - 1], off: d[2] !== 'ok' };
      o.name = o.label + (count[d[0]] > 1 ? ' · ' + o.sub : '');
      var t = /(\d+)\s*°C/.exec(d[3]);
      if (o.kind === 'hvac') { o.on = !!t; o.target = t ? +t[1] : 24; o.fan = 2; o.min = 18; o.max = 28; }
      else if (o.kind === 'blind') o.pos = d[3] === '닫힘' ? 0 : 100;
      else if (o.kind === 'door') o.locked = true;
      else o.on = d[3] === '켜짐';
      if (o.kind === 'door') { if (room.entry !== 'free') RT.door = o; return; }   /* 문 열기 카드는 QR · 리더기 방만 */
      RT.dev.push(o);
    });

    /* 이 폰에 세션이 있으면 그 예약은 이미 입실 · 연장된 끝 시각 · 퇴실을 되살린다 */
    var ss = sess(), r = ss && sessRsv(ss);
    if (r) {
      var en = fromIso(ss.end);
      if (en > r.e) r.e = en;
      if (r.wait) { r.wait = false; runAuto(room.btns[0][1]); }
      if (ss.out) { r.done = true; runAuto(room.btns[1][1]); }
    }
  }

  function current() { return RT ? RT.rsv.filter(function (r) { return !r.done && r.s <= S.now && S.now < r.e; })[0] || null : null; }
  function upcoming() { return RT ? RT.rsv.filter(function (r) { return r.s > S.now; }).sort(function (a, b) { return a.s - b.s; }) : []; }
  function codeOk() {
    if (!room.signage) return true;   /* 스티커 QR — 현장 코드가 없다(§2 보안 메모) */
    var t = Date.now();
    return !!S.code && (S.code === codeNow(t) || S.code === codeNow(t - 300000));
  }

  /* 세션 · 잠금 — 회의실 ID마다 */
  function sess() {
    if (PREVIEW) return null;
    var ss = objOf(K_SESS)[S.rid];
    return ss && typeof ss === 'object' && fromIso(ss.start) != null && fromIso(ss.end) != null ? ss : null;
  }
  function sessSet(v) { var a = objOf(K_SESS); if (v) a[S.rid] = v; else delete a[S.rid]; save(K_SESS, a); }
  function sessRsv(ss) { var st = fromIso(ss.start); return RT ? RT.rsv.filter(function (r) { return r.s === st; })[0] || null : null; }
  function lockGet() {
    var l = objOf(K_LOCK)[S.rid];
    if (!l || (+l.until && +l.until <= Date.now())) return { fails: 0, until: 0 };   /* 잠금이 풀리면 처음부터 */
    return { fails: +l.fails || 0, until: +l.until || 0 };
  }
  function lockSet(v) { var a = objOf(K_LOCK); if (v) a[S.rid] = v; else delete a[S.rid]; save(K_LOCK, a); }
  function lockLeft() { var l = lockGet(); return l.until > Date.now() ? l.until - Date.now() : 0; }


  /* ── 어느 화면인가 ───────────────────────────────────────── */

  function view() {
    if (!room) return 'unknown';
    if (PREVIEW) return 'g2';
    var ss = sess();
    if (ss) {
      var st = fromIso(ss.start), en = fromIso(ss.end);
      if (S.now < st) return 'g1';                       /* 시연 시각을 앞으로 돌린 경우 */
      if (!ss.out && S.now < en) return 'g2';            /* 다시 찍어도 번호 없이 바로 */
      var cur = current();
      if (cur && cur.s !== st) { sessSet(null); return 'g1'; }   /* 그 뒤 다른 예약 시간 — 지난 세션은 버린다 */
      return 'g3';
    }
    return 'g1';
  }

  /* G-01 — 입력이 있는가 */
  function g1Mode() {
    if (room.state) return 'closed';
    if (!codeOk()) return 'expired';
    if (!current() && !upcoming().length) return 'none';
    return 'form';
  }

  function roomState() {
    if (room.state === 'fix') return ['점검 중', 'dim'];
    if (room.state === 'off') return ['사용 안 함', 'dim'];
    var cur = current();
    if (!cur) return ['비어 있음', 'ok'];
    if (cur.wait && room.entry !== 'free') return ['입실 대기', 'warn'];
    return ['사용 중', 'muted'];
  }


  /* ── 안내 콘텐츠 — 관리자 web A-12가 쓴다 ───────────────────── */

  function siteData() {
    if (S.override) return S.override;
    var d = load(K_SITE);
    return d && typeof d === 'object' && !Array.isArray(d) ? d : SITE_SEED;
  }
  function inPeriod(x) { var f = x.from || '', t = x.to || ''; return (!f || f <= DAY) && (!t || DAY <= t); }
  function hasText(n) { return String(n.title || '').trim() || String(n.body || '').trim(); }
  function content() {
    var d = siteData(), rm = (d.rooms && typeof d.rooms === 'object' && d.rooms[room.name]) || {};
    return {
      notices: arr(rm.notices).filter(inPeriod).filter(hasText),
      cautions: arr(rm.cautions).filter(function (c) { return String(c.text || '').trim(); }),
      common: arr(d.common && d.common.notices).filter(inPeriod).filter(hasText),
      ads: arr(d.ads).filter(inPeriod).filter(function (a) { return String(a.title || '').trim() || safeImg(a.img); })
    };
  }
  function noticeIds() { var c = content(); return c.notices.concat(c.common).map(function (n) { return String(n.id); }); }
  function unseen() {
    var ss = sess();
    if (!ss) return 0;
    var seen = Array.isArray(ss.seen) ? ss.seen : [];
    return noticeIds().filter(function (id) { return seen.indexOf(id) === -1; }).length;
  }
  function markSeen() {
    var ss = sess();
    if (!ss) return;
    ss.seen = noticeIds();
    sessSet(ss);
  }
  function safeImg(s) { return typeof s === 'string' && (/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(s) || /^https:\/\//i.test(s)) ? s : ''; }
  function safeLink(s) { return typeof s === 'string' && /^https?:\/\/[^\s]+$/i.test(s.trim()) ? s.trim() : ''; }


  /* ============================================================
     그리기
     ============================================================ */

  var screen = $('#screen');
  var lastKey = '';

  function appLink() {
    return '<a class="applink" href="' + esc(APP_URL) + '" data-applink>앱이 있으면 앱으로 열기' + icon('next') + '</a>';
  }
  function logo() { return '<span class="login__logo" role="img" aria-label="SIOT"></span>'; }

  function render() {
    $('#statusTime').textContent = hm(S.now);
    var v = view();
    var key = v + '|' + S.tab + '|' + S.rid;
    var old = $('.screen__body', screen);
    var top = old && key === lastKey ? old.scrollTop : 0;
    var hadFocus = document.activeElement && document.activeElement.id === 'code';
    /* 미리보기 · 안내 탭이 아니면 제어 탭의 기기 바탕(회색) */
    screen.className = 'screen is-active' + (v === 'g2' && S.tab === 'ctl' ? ' screen--board' : '');
    screen.innerHTML = v === 'g1' ? g1Html() : v === 'g2' ? g2Html() : v === 'g3' ? g3Html() : unknownHtml();
    var nb = $('.screen__body', screen);
    if (nb && top) nb.scrollTop = top;
    lastKey = key;
    if (v === 'g1') {
      syncCode();
      if ((hadFocus || S.focus) && $('#code') && !$('#code').disabled) { $('#code').focus({ preventScroll: true }); }
      S.focus = false;
    }
    if (remoteId && isSheetOpen()) { var a = devOf(remoteId); if (a) $('#sheetBody').innerHTML = remoteHtml(a); }
    if ($('#demo').classList.contains('is-open')) renderDemo();
  }

  /* ── G-01 번호 확인 ─────────────────────────────────────── */

  var g1Shown = '';
  function g1Html() {
    var st = roomState(), mode = g1Mode(), cur = current(), next = upcoming()[0];
    g1Shown = mode;
    var head = '<div class="g1">' + logo() +
      '<h1 class="g1__name">' + esc(room.name) + '</h1>' +
      '<p class="g1__group">' + esc(room.group) + '</p>' +
      '<p class="g1__state"><span class="status status--' + st[1] + '">' + esc(st[0]) + '</span></p>' +
      (mode === 'form' && !cur && next ? '<p class="g1__next tnum">지금은 예약이 없어요 · 다음 예약 ' + hm(next.s) + '</p>' : '') +
    '</div>';

    if (mode !== 'form') {
      var stop = {
        closed: ['alert', '오늘은 이용할 수 없어요', ''],
        expired: ['qr', 'QR이 바뀌었어요', '문 앞 QR을 다시 찍어 주세요'],
        none: ['cal', '지금은 예약이 없어요', next ? '다음 예약 ' + hm(next.s) : '']
      }[mode];
      return appLink() + '<div class="screen__body">' + head +
        '<div class="g1__stop">' + icon(stop[0]) + '<b>' + esc(stop[1]) + '</b>' + (stop[2] ? '<span class="tnum">' + esc(stop[2]) + '</span>' : '') + '</div>' +
      '</div>';
    }

    var locked = lockLeft() > 0;
    var boxes = '';
    for (var i = 0; i < 4; i++) boxes += '<i></i>';
    return appLink() + '<div class="screen__body">' + head +
      '<div class="g1__form">' +
        '<label class="g1__label" for="code">휴대폰 번호 뒤 4자리</label>' +
        '<div class="codebox codebox--4' + (locked ? ' is-locked' : '') + '">' + boxes +
          '<input id="code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" aria-describedby="g1msg"' + (locked ? ' disabled' : '') + '>' +
        '</div>' +
        '<p class="g1__msg" id="g1msg" role="status"></p>' +
      '</div>' +
    '</div>' +
    '<div class="fixedcta"><button class="btn btn--primary" id="g1go" disabled>확인</button></div>';
  }

  /* 칸 · 버튼 · 한 줄 — 다시 그리지 않고 고친다(입력 중 커서를 지키려고) */
  function syncCode() {
    var inp = $('#code');
    if (!inp) return;
    var left = lockLeft(), locked = left > 0;
    if (inp.value !== S.digits) inp.value = S.digits;
    inp.disabled = locked;
    $$('.codebox i').forEach(function (b, i) {
      b.textContent = S.digits[i] || '';
      b.classList.toggle('is-on', !locked && i === S.digits.length);
    });
    $('.codebox').classList.toggle('is-locked', locked);
    $('#g1go').disabled = locked || S.digits.length !== 4;
    var m = $('#g1msg');
    if (locked) {
      var s = Math.max(0, Math.ceil(left / 1000) - 1);   /* 잠그는 순간 4:59부터 */
      m.className = 'g1__msg is-wait tnum';
      m.textContent = '잠시 뒤 다시 시도해 주세요 · ' + Math.floor(s / 60) + ':' + pad(s % 60);
    } else if (S.msg) {
      m.className = 'g1__msg is-' + S.msg.tone;
      m.textContent = S.msg.text;
    } else { m.className = 'g1__msg'; m.textContent = ''; }
  }

  function submit() {
    if (view() !== 'g1' || S.digits.length !== 4 || lockLeft()) return;
    if (g1Mode() !== 'form') { render(); return; }   /* 그새 코드가 바뀌었으면 만료 화면 */
    var d = S.digits, cur = current();
    S.digits = '';
    if (cur && cur.n4 === d) { auth(cur); return; }
    /* 시작 전 — 이 방의 다가오는 예약과 맞으면 그 예약 본인이니 시각만 알린다(인증하지 않음 · 실패로 세지 않음) */
    var early = upcoming().filter(function (r) { return r.n4 === d; })[0];
    if (early) { S.msg = { tone: 'wait', text: hm(early.s) + '부터 입실할 수 있어요' }; S.focus = true; render(); return; }
    /* 틀림 — 번호인지 시간인지 말하지 않는다 · 남은 횟수도 보이지 않는다 */
    var l = lockGet();
    l.fails += 1;
    if (l.fails >= LOCK_FAILS) l.until = Date.now() + LOCK_MS;
    lockSet(l);
    S.msg = l.until ? null : { tone: 'bad', text: '이 회의실의 지금 예약과 맞지 않아요' };
    S.focus = true;
    render();
  }

  /* 인증 = 입실 처리(앱 QR 체크인과 같은 효력). QR 방이면 문이 열리고 입실 자동화, 이미 입실한 예약은 제어만 이어 준다 */
  function auth(r) {
    lockSet(null);
    var firstIn = r.wait && room.entry !== 'free';
    r.wait = false;
    sessSet({ name: room.name, start: iso(r.s), end: iso(r.e), at: iso(S.now), seen: [] });
    S.msg = null; S.tab = 'ctl';
    if (firstIn) runAuto(room.btns[0][1]);
    render();

    var opened = false;
    function after() {
      if (!firstIn || opened) return;
      opened = true;
      if (room.entry === 'qr' && RT.door) { openDoor(); toast('입실했어요 · 문이 열렸어요'); }
      else toast('입실했어요');
    }
    var cs = content().cautions;
    if (cs.length) {
      openSheet({
        title: '이 회의실 이용 전에',
        body: '<ul class="clist">' + cs.map(function (c) { return '<li>' + esc(c.text) + '</li>'; }).join('') + '</ul>',
        cta: { label: '확인했어요' },
        onClose: after
      });
    } else after();
  }

  /* ── G-02 이용 — 탭 「제어 | 안내」 ───────────────────────── */

  function g2Html() {
    var dot = !PREVIEW && S.tab !== 'info' && unseen() > 0;
    var r = activeRsv();
    if (S.tab === 'ctl' && !r) S.tab = 'info';
    var tabs = '<div class="stabs" role="tablist">' +
      '<button class="stabs__b' + (S.tab === 'ctl' ? ' is-on' : '') + '" role="tab" aria-selected="' + (S.tab === 'ctl') + '" data-tab="ctl">제어</button>' +
      '<button class="stabs__b' + (S.tab === 'info' ? ' is-on' : '') + '" role="tab" aria-selected="' + (S.tab === 'info') + '" data-tab="info">안내' +
        (dot ? '<i class="stabs__dot" aria-label="새 공지"></i>' : '') + '</button>' +
    '</div>';
    return appLink() + tabs + '<div class="screen__body" role="tabpanel">' + (S.tab === 'ctl' ? ctlHtml(r) : infoHtml()) + '</div>';
  }

  /* 이 폰이 인증한 예약 — 미리보기는 인증이 없으니 지금 예약(제어 탭을 요청했을 때만) */
  function activeRsv() {
    if (PREVIEW) return current();
    var ss = sess();
    return ss ? sessRsv(ss) : null;
  }

  function ctlHtml(r) {
    var total = r.e - r.s, pct = Math.min(100, Math.max(0, Math.round((S.now - r.s) / total * 100)));
    var ext = extendCheck(r);
    /* 머리 — 앱 S-14와 같다: 이름 + 상태 한 줄 · 그룹 + 시간 · 진행 바 · 30분 연장 | 퇴실하기 */
    var hero = '<div class="hero hero--site">' +
      '<div class="hero__top"><h1 class="hero__name">' + esc(room.name) + '</h1>' +
        '<span class="status status--brand">사용 중 · ' + esc(leftLabel(r.e - S.now)) + ' 남음</span></div>' +
      '<p class="hero__meta tnum">' + esc(room.floor + ' · ' + hm(r.s) + '–' + hm(r.e)) + '</p>' +
      '<div class="elapsed"><i style="width:' + pct + '%"></i></div>' +
      '<div class="btnrow">' +
        '<button class="btn btn--sm btn--secondary' + (ext.ok ? '' : ' is-blocked') + '" data-extend>30분 연장</button>' +
        '<button class="btn btn--sm btn--danger" data-exit>퇴실하기</button>' +
      '</div>' +
    '</div>';

    var cards = deviceCards(), autos = autoRow();
    var body = '<div class="devwrap">' + doorCard() +
      (cards || autos
        ? '<p class="groupt" style="padding:0">기기</p>' + autos + (cards ? '<div class="dgrid">' + cards + '</div>' : '')
        : (RT.door ? '' : '<div class="empty">' + icon('plug', 'icon--lg') + '<p class="empty__text">이 회의실에는 연동된 기기가 없어요</p></div>')) +
    '</div>';
    return hero + body;
  }

  /* 30분 연장 — 뒤 30분이 비어 있고 운영 시간 안이면 몇 번이든(최대 사용 시간과 무관 · mock extendCheck와 같다) */
  function extendCheck(r) {
    var to = r.e + EXTEND_MIN;
    if (to > CLOSE_MIN) return { ok: false, reason: hm(CLOSE_MIN) + '에 운영이 끝나 연장할 수 없어요' };
    var nx = RT.rsv.filter(function (x) { return x !== r && x.s < to && x.e > r.e; })[0];
    if (nx) return { ok: false, reason: hm(nx.s) + '에 다음 예약이 있어 연장할 수 없어요' };
    return { ok: true, until: to };
  }
  function doExtend() {
    var r = activeRsv();
    if (!r) return;
    var ch = extendCheck(r);
    if (!ch.ok) { toast(ch.reason); return; }
    if (PREVIEW) return;
    r.e = ch.until;
    var ss = sess();
    if (ss) { ss.end = iso(r.e); sessSet(ss); }   /* 세션도 함께 늘어난다 */
    render();
    toast(hm(r.e) + '까지 연장했어요');
  }

  /* 퇴실 = 「퇴실」 버튼에 매핑한 자동화 실행 → G-03. 매핑이 없는 방이면 기기 이야기를 하지 않는다 */
  function confirmExit() {
    if (PREVIEW) return;
    var auto = room.btns[1][1];
    openSheet({
      title: '퇴실할까요',
      body: '<p class="note">' + esc(room.name + ' 사용을 마쳐요' + (auto ? ' · 「' + auto + '」 자동화가 실행돼요' : '')) + '</p>',
      cta: {
        label: '퇴실하기', kind: 'danger',
        onClick: function () {
          var r = activeRsv(), ss = sess();
          if (!r || !ss) return;
          runAuto(auto);
          r.done = true;
          ss.out = iso(S.now);
          sessSet(ss);
          render();
        }
      }
    });
  }

  /* ── 기기 — SIOT 디바이스 카드(앱 S-14) · 3상태: 전송 중 · 확정 · 실패 ── */

  function devOf(id) { return RT.dev.concat(RT.door ? [RT.door] : []).filter(function (d) { return d.id === id; })[0] || null; }
  function lights() { return RT.dev.filter(function (d) { return d.kind === 'light'; }); }

  /** 낙관적 UI 금지 — 응답이 온 뒤에만 값을 바꾼다. key = 카드 하나(조명은 묶어서 한 장) */
  function send(key, label, devs, apply) {
    if (pending[key] || PREVIEW) return;
    delete failed[key];
    pending[key] = label;
    render();
    var fail = S.devFail || devs.some(function (d) { return d.off; });
    setTimeout(function () {
      delete pending[key];
      if (fail) failed[key] = { label: label, devs: devs, apply: apply };
      else if (apply) apply();
      render();
    }, fail ? FAIL_MS : CONFIRM_MS);
  }

  function devHead(name, off) {
    return '<div class="dcard__h"><span class="dcard__nm">' + esc(name) + '</span><span class="dcard__dot' + (off ? ' is-off' : '') + '"></span></div>';
  }
  function devBody(key, inner) {
    if (pending[key]) return '<div class="dsend"><span class="spinner"></span>' + esc(pending[key]) + ' 보내는 중</div>';
    if (failed[key]) {
      return '<div class="dfail"><p>응답이 없어요<br>현장 스위치를 써 주세요</p><button data-retry="' + esc(key) + '">다시 시도</button></div>';
    }
    return inner;
  }
  function trackFill(p) { return 'background:linear-gradient(to right,var(--dev) 0 ' + p + '%,var(--gray-200) ' + p + '% 100%)'; }

  function doorCard() {
    var d = RT.door;
    if (!d) return '';
    var inner = '<div class="duo"><button class="duo__b' + (!d.locked ? ' is-act' : '') + '" data-door>' +
      icon(d.locked ? 'unlock' : 'lock') + (d.locked ? '문 열기' : '열림 · 곧 잠김') + '</button></div>';
    return '<div class="dcard dcard--door">' + devHead('도어', d.off) + devBody(d.id, inner) + '</div>';
  }
  function openDoor() {
    var d = RT.door;
    if (!d) return;
    d.locked = false;
    render();
    setTimeout(function () { d.locked = true; render(); }, DOOR_RELOCK_MS);
  }

  function deviceCards() {
    var out = '', ls = lights();
    if (ls.length) {
      var multi = ls.length > 1, b = RT.bright;
      var inner = '<div class="swstack swstack--v">' + ls.map(function (l) {
        return '<button class="swstack__b' + (l.on ? ' is-on' : '') + '" data-light="' + esc(l.id) + '">' + icon('light') +
          esc(multi ? l.sub : (l.on ? '켜짐' : '꺼짐')) + '</button>';
      }).join('') + '</div>' +
        '<div class="drow"><span class="drow__l">밝기 <b class="tnum">' + b + '%</b></span>' +
        '<input class="slider" type="range" min="0" max="100" step="10" value="' + b + '" data-bright aria-label="밝기" style="' + trackFill(b) + '"></div>';
      out += '<div class="dcard">' + devHead('조명', ls.every(function (l) { return l.off; })) + devBody('light', inner) + '</div>';
    }
    ['hvac', 'plug', 'blind', 'power'].forEach(function (k) {
      RT.dev.filter(function (d) { return d.kind === k; }).forEach(function (d) {
        if (k === 'blind' && d.off) return;   /* 값 없는 블라인드 타일은 숨긴다 — 앱과 같다 */
        out += '<div class="dcard">' + devHead(d.name, d.off) + devBody(d.id, cardInner(d)) + '</div>';
      });
    });
    return out;
  }
  function cardInner(d) {
    if (d.kind === 'hvac') {
      return '<div class="dcard__big tnum">' + (d.on ? d.target + '℃' : '꺼짐') + '</div>' +
        '<p class="dcard__sub">' + (d.on ? '풍량 ' + d.fan + '단' : '전원 꺼짐') + '</p>' +
        '<button class="dpill" data-remote="' + esc(d.id) + '">리모컨 제어</button>';
    }
    if (d.kind === 'blind') {
      return '<div class="dcard__big tnum">' + (d.pos >= 100 ? '열림' : d.pos <= 0 ? '닫힘' : d.pos + '%') + '</div>' +
        /* 손잡이(22px)가 열림 · 닫힘 끝에서 카드 밖으로 나가지 않게 */
        '<div class="dbar"><i style="width:' + d.pos + '%"></i><span style="left:calc(11px + (100% - 22px) * ' + (d.pos / 100) + ')"></span></div>' +
        '<div class="tri">' +
          '<button class="tri__b" data-blind="down" data-id="' + esc(d.id) + '" aria-label="내리기">' + icon('down') + '</button>' +
          '<button class="tri__b" data-blind="stop" data-id="' + esc(d.id) + '" aria-label="멈추기">' + icon('stop') + '</button>' +
          '<button class="tri__b" data-blind="up" data-id="' + esc(d.id) + '" aria-label="올리기">' + icon('up') + '</button>' +
        '</div>';
    }
    /* 콘센트 · TV · 화상장비 · 빔프로젝터 — 전원 하나 */
    return '<div class="plug"><button class="plug__c plug__c--sm' + (d.on ? ' is-on' : '') + '" data-power="' + esc(d.id) + '" aria-label="' + esc(d.name + (d.on ? ' 끄기' : ' 켜기')) + '">' +
      icon(d.kind === 'plug' ? 'power' : 'tv') + '</button>' +
      '<span class="plug__s' + (d.on ? ' is-on' : '') + '">' + (d.on ? 'ON' : 'OFF') + '</span></div>';
  }

  /* 냉난방 리모컨 창 — 카드에는 상태만, 조작은 창에서(앱 69차). 전송 중 · 실패가 창에도 같이 */
  function remoteHtml(a) {
    var inner = '<div class="dcard__big tnum">' + (a.on ? a.target + '℃' : '꺼짐') + '</div>' +
      '<div class="rmt">' +
        '<button class="rmt__b' + (a.on ? ' is-power' : '') + '" data-hvac="' + esc(a.id) + '">' + icon('power') + '전원</button>' +
        '<button class="rmt__b" data-fan="' + esc(a.id) + '">' + icon('temp') + '풍량 ' + a.fan + '단</button>' +
        '<button class="rmt__b' + (a.target <= a.min ? ' is-disabled' : '') + '" data-temp="-1" data-id="' + esc(a.id) + '">' + icon('minus') + '온도</button>' +
        '<button class="rmt__b' + (a.target >= a.max ? ' is-disabled' : '') + '" data-temp="1" data-id="' + esc(a.id) + '">' + icon('plus') + '온도</button>' +
      '</div>';
    return '<div class="remote">' + devBody(a.id, inner) + '</div>';
  }

  /* 추가 버튼(SIOT 자동화) — 입실 · 퇴실은 기본 버튼이라 여기 없다 */
  function autoRow() {
    var list = room.btns.slice(2).filter(function (b) { return b[1]; });
    if (!list.length) return '';
    return '<div class="autorow">' + list.map(function (b, i) {
      return '<button class="autobtn' + (autoRun === i ? ' is-running' : '') + (autoDone === i ? ' is-done' : '') +
        '" data-auto="' + i + '">' + icon('bolt') + esc(b[0]) + '<span class="autobtn__bar"></span></button>';
    }).join('') + '</div>';
  }
  function runAuto(name) {
    if (!name || !AUTOS[name]) return;
    RT.dev.concat(RT.door ? [RT.door] : []).forEach(function (d) { if (!d.off) AUTOS[name](d); });
    if (AUTO_BRIGHT[name]) RT.bright = AUTO_BRIGHT[name];
  }
  function pressAuto(i) {
    if (autoRun !== null || PREVIEW) return;
    var b = room.btns.slice(2).filter(function (x) { return x[1]; })[i];
    if (!b) return;
    autoRun = i; autoDone = null;
    render();
    setTimeout(function () {
      runAuto(b[1]);
      autoRun = null; autoDone = i;
      render();
      setTimeout(function () { autoDone = null; render(); }, 700);
    }, AUTO_MS);
  }

  /* ── G-02 안내 — 이 회의실 공지 → 주의사항 → 전체 공지 → 광고. 빈 묶음은 통째로 숨긴다 ── */

  function noticeHtml(n) {
    var p = n.from || n.to ? (dateLabel(n.from) || '') + '–' + (dateLabel(n.to) || '') : '';
    return '<div class="ncard">' +
      (String(n.title || '').trim() ? '<b class="ncard__t">' + esc(n.title) + '</b>' : '') +
      (String(n.body || '').trim() ? '<p class="ncard__b">' + esc(n.body) + '</p>' : '') +
      (p ? '<span class="ncard__p">' + esc(p) + '</span>' : '') +
    '</div>';
  }
  function adsHtml(ads) {
    if (!ads.length) return '';
    return '<div class="ads"><div class="ads__t' + (ads.length > 1 ? ' is-many' : '') + '">' + ads.map(function (a) {
      var img = safeImg(a.img), link = safeLink(a.link);
      var cls = 'ad' + (img ? ' has-img' : '');
      var inner = (img ? '<img src="' + esc(img) + '" alt="">' : '') + '<span class="ad__t">' + esc(a.title) + '</span>';
      return link
        ? '<a class="' + cls + '" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>'
        : '<div class="' + cls + '">' + inner + '</div>';
    }).join('') + '</div>' +
      (ads.length > 1 ? '<div class="tdots">' + ads.map(function (a, i) { return '<span' + (i ? '' : ' class="is-on"') + '></span>'; }).join('') + '</div>' : '') +
    '</div>';
  }
  function infoHtml() {
    var c = content();
    var parts = [];
    if (c.notices.length) parts.push('<section class="isec"><h2 class="isec__t">공지</h2>' + c.notices.map(noticeHtml).join('') + '</section>');
    if (c.cautions.length) parts.push('<section class="isec"><h2 class="isec__t">주의사항</h2><ul class="clist">' +
      c.cautions.map(function (x) { return '<li>' + esc(x.text) + '</li>'; }).join('') + '</ul></section>');
    if (c.common.length) parts.push('<section class="isec"><h2 class="isec__t">전체 공지</h2>' + c.common.map(noticeHtml).join('') + '</section>');
    if (c.ads.length) parts.push(adsHtml(c.ads));
    return '<div class="info"><h1 class="info__name">' + esc(room.name) + '</h1>' +
      (parts.length ? parts.join('') : '<div class="empty">' + icon('alert', 'icon--lg') + '<p class="empty__text">지금은 안내가 없어요</p></div>') +
    '</div>';
  }

  /* ── G-03 이용 끝 ───────────────────────────────────────── */

  function g3Html() {
    var ss = sess(), st = fromIso(ss.start), out = fromIso(ss.out || '');
    var endAt = out != null ? out : fromIso(ss.end);
    return '<div class="screen__body site"><div class="g3">' + logo() +
      '<span class="status status--muted">' + (out != null ? '퇴실했어요' : '예약 시간이 끝났어요') + '</span>' +
      '<h1 class="g3__t">이용해 주셔서 고마워요</h1>' +
      '<div class="waitlist">' +
        '<div class="waitrow"><span class="waitrow__k">회의실</span><span class="waitrow__v">' + esc(room.name) + '</span></div>' +
        '<div class="waitrow"><span class="waitrow__k">이용 시간</span><span class="waitrow__v tnum">' + hm(st) + '–' + hm(endAt) + '</span></div>' +
      '</div>' +
      '<div class="g3__ads">' + adsHtml(content().ads) + '</div>' +
      '<a class="linkbtn g3__app" href="' + esc(APP_URL) + '" data-applink>SIOT 앱 받기</a>' +
    '</div></div>';
  }

  function unknownHtml() {
    return '<div class="screen__body"><div class="g1">' + logo() + '</div>' +
      '<div class="g1__stop">' + icon('alert') + '<b>회의실을 찾을 수 없어요</b><span>문 앞 QR을 다시 찍어 주세요</span></div></div>';
  }


  /* ============================================================
     시트 · 토스트 — 앱과 같은 부품(우상단 X · 스크림 · ESC · 끌어내리기)
     ============================================================ */

  var sheetOnClose = null;
  function isSheetOpen() { return $('#sheetLayer').classList.contains('is-open'); }
  function openSheet(o) {
    $('#sheetTitle').textContent = o.title || '';
    $('#sheetBody').innerHTML = o.body || '';
    var cta = $('#sheetCta');
    if (o.cta) {
      cta.hidden = false;
      cta.innerHTML = '<button class="btn btn--' + (o.cta.kind || 'primary') + '" id="sheetCtaBtn">' + esc(o.cta.label) + '</button>';
      $('#sheetCtaBtn').onclick = function () { closeSheet(); if (o.cta.onClick) o.cta.onClick(); };
    } else { cta.hidden = true; cta.innerHTML = ''; }
    sheetOnClose = o.onClose || null;
    $('#toast').classList.remove('is-on');   /* 앞 토스트가 시트의 실행 버튼을 가리지 않게 */
    var layer = $('#sheetLayer');
    layer.classList.add('is-open');
    $('#sheet').style.transform = '';
    requestAnimationFrame(function () { layer.classList.add('is-in'); });
  }
  function closeSheet() {
    var layer = $('#sheetLayer');
    if (!layer.classList.contains('is-open')) return;
    layer.classList.remove('is-in');
    var fn = sheetOnClose; sheetOnClose = null; remoteId = null;
    setTimeout(function () { layer.classList.remove('is-open'); }, 280);
    if (fn) fn();
  }
  (function wireDrag() {
    var sheet = $('#sheet'), handle = $('.sheet__handle', sheet), y0 = null;
    handle.style.touchAction = 'none';
    handle.addEventListener('pointerdown', function (e) { y0 = e.clientY; if (handle.setPointerCapture) handle.setPointerCapture(e.pointerId); });
    handle.addEventListener('pointermove', function (e) {
      if (y0 === null) return;
      sheet.style.transition = 'none';
      sheet.style.transform = 'translateY(' + Math.max(0, e.clientY - y0) + 'px)';
    });
    function end(e) {
      if (y0 === null) return;
      var d = Math.max(0, (e.clientY || 0) - y0);
      y0 = null; sheet.style.transition = ''; sheet.style.transform = '';
      if (d > 90) closeSheet();
    }
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  })();

  var toastTimer = null;
  function toast(msg) {
    $('#toastText').textContent = msg;
    var el = $('#toast');
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-on'); }, 3000);
  }


  /* ============================================================
     시연 도구 — 발표자용. ?demo=1 또는 빈 곳 0.8초 길게 누르기
     ============================================================ */

  var TIMES = [[13 * 60 + 55, '13:55 시작 전'], [BASE_NOW, '14:18 지금'], [16 * 60 + 5, '16:05'], [15 * 60 + 5, '15:05 끝']];

  function qrKind() { return !room || !room.signage ? 'sticker' : (codeOk() ? 'live' : 'old'); }
  function chip(on, attrs, label, off) {
    return '<button type="button" class="chip' + (on ? ' is-selected' : '') + (off ? ' is-disabled' : '') + '" ' + attrs + '>' + esc(label) + '</button>';
  }
  function renderDemo() {
    var k = qrKind(), sg = room && room.signage;
    $('#demo').innerHTML =
      '<div class="demo__scrim" data-demo-close></div>' +
      '<div class="demo__panel">' +
        '<div class="demo__head"><h2 class="demo__title">시연 도구</h2>' +
          '<button type="button" class="iconbtn" data-demo-close aria-label="닫기">' + icon('close') + '</button></div>' +
        '<div class="demo__g"><span class="demo__k">회의실</span><div class="demo__row">' +
          ROOMS.map(function (r) { return chip(r.id === S.rid, 'data-demo-room="' + r.id + '"', r.id); }).join('') + '</div></div>' +
        '<div class="demo__g"><span class="demo__k">QR 종류</span><div class="demo__row">' +
          chip(k === 'live', 'data-demo-qr="live"', '현황판', !sg) +
          chip(k === 'sticker', 'data-demo-qr="sticker"', '스티커', sg) +
          chip(k === 'old', 'data-demo-qr="old"', '만료 코드', !sg) + '</div></div>' +
        '<div class="demo__g"><span class="demo__k">시각 · 2026-09-09(수)</span><div class="demo__row">' +
          TIMES.map(function (t) { return chip(S.now === t[0], 'data-demo-time="' + t[0] + '"', t[1]); }).join('') + '</div></div>' +
        '<div class="demo__g"><span class="demo__k">기기 응답</span><div class="demo__row">' +
          chip(!S.devFail, 'data-demo-dev="ok"', '정상') + chip(S.devFail, 'data-demo-dev="fail"', '응답 없음') + '</div></div>' +
        '<div class="demo__g"><span class="demo__k">데모 번호 · ' + esc(room ? room.name : S.rid) + '</span>' +
          (RT && RT.rsv.length
            ? '<div class="demo__nums">' + RT.rsv.map(function (r) {
                return '<button type="button" class="demo__num" data-demo-num="' + esc(r.n4) + '"><span>' + esc(r.who + ' · ' + hm(r.s) + '–' + hm(r.e)) + '</span><b>' + esc(r.n4) + '</b></button>';
              }).join('') + '</div>'
            : '<p class="note">오늘 예약이 없어요</p>') + '</div>' +
        '<div class="demo__g"><span class="demo__k">처음 상태로</span>' +
          '<button type="button" class="demo__danger" data-demo-reset>세션 · 잠금 지우기</button></div>' +
      '</div>';
  }
  function openDemo() { if (PREVIEW) return; renderDemo(); $('#demo').classList.add('is-open'); }
  function closeDemo() { $('#demo').classList.remove('is-open'); }

  /* 시연 상태는 주소에 둔다(r · c · t) — 새로 고쳐도 같은 무대 */
  function syncUrl() {
    if (PREVIEW) return;
    var p = new URLSearchParams();
    p.set('r', S.rid);
    if (S.code) p.set('c', S.code);
    if (S.now !== BASE_NOW) p.set('t', hm(S.now).replace(':', ''));
    if (Q.get('demo') === '1') p.set('demo', '1');
    try { history.replaceState(null, '', location.pathname + '?' + p.toString()); } catch (e) { /* file:// 등 */ }
  }

  function demoClick(t) {
    if (t.closest('[data-demo-close]')) { closeDemo(); return true; }
    var b;
    if ((b = t.closest('[data-demo-room]'))) {
      setRoom(b.getAttribute('data-demo-room'));
      S.code = room && room.signage ? codeNow() : null;
      S.digits = ''; S.msg = null; S.tab = 'ctl';
      syncUrl(); render(); return true;
    }
    if ((b = t.closest('[data-demo-qr]'))) {
      if (b.classList.contains('is-disabled')) return true;
      var k = b.getAttribute('data-demo-qr');
      S.code = k === 'live' ? codeNow() : k === 'old' ? codeNow(Date.now() - 600000) : null;
      S.msg = null; syncUrl(); render(); return true;
    }
    if ((b = t.closest('[data-demo-time]'))) {
      S.now = +b.getAttribute('data-demo-time');
      S.msg = null; syncUrl(); render(); return true;
    }
    if ((b = t.closest('[data-demo-dev]'))) { S.devFail = b.getAttribute('data-demo-dev') === 'fail'; render(); return true; }
    if ((b = t.closest('[data-demo-num]'))) {
      S.digits = b.getAttribute('data-demo-num'); S.msg = null; S.focus = true;
      closeDemo(); render(); return true;
    }
    if (t.closest('[data-demo-reset]')) {
      drop(K_SESS); drop(K_LOCK);
      setRoom(S.rid);
      S.digits = ''; S.msg = null; S.tab = 'ctl';
      closeDemo(); closeSheet(); render(); toast('처음 상태로 돌렸어요');
      return true;
    }
    return false;
  }

  /* 빈 곳 0.8초 길게 누르기 — 손을 떼면 오는 click은 삼킨다 */
  (function wireLongPress() {
    if (PREVIEW) return;
    var timer = null, armed = false, fired = false, sx = 0, sy = 0;
    var BUSY = 'button,a,input,label,select,textarea,.dcard,.sheetlayer,.demo,.toast,.codebox,.ads';
    function disarm() { clearTimeout(timer); armed = false; }
    document.addEventListener('pointerdown', function (e) {
      fired = false;
      if (!$('#device').contains(e.target) || e.target.closest(BUSY)) return;
      sx = e.clientX; sy = e.clientY;
      disarm(); armed = true;
      timer = setTimeout(function () { armed = false; fired = true; if (navigator.vibrate) navigator.vibrate(15); openDemo(); }, 800);
    }, true);
    ['pointerup', 'pointercancel'].forEach(function (n) { document.addEventListener(n, disarm, true); });
    document.addEventListener('pointermove', function (e) { if (armed && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 12) disarm(); }, true);
    document.addEventListener('click', function (e) { if (fired) { fired = false; e.stopPropagation(); e.preventDefault(); } }, true);
    /* 안드로이드의 길게 누르기 메뉴가 끼어들지 않게 — 누르고 있는 동안만 */
    document.addEventListener('contextmenu', function (e) { if (armed || fired) e.preventDefault(); }, true);
  })();


  /* ============================================================
     이벤트 — 위임 하나
     ============================================================ */

  document.addEventListener('click', function (e) {
    var t = e.target, b;
    if (t.closest('[data-close]')) { closeSheet(); return; }
    if (t.closest('.demo') && demoClick(t)) return;

    if (PREVIEW) {   /* 미리보기는 보기만 — 앱 링크 · 탭은 움직이지 않는다(광고 링크는 새 창 그대로) */
      if (t.closest('[data-applink]')) e.preventDefault();
      return;
    }

    if ((b = t.closest('[data-tab]'))) {
      S.tab = b.getAttribute('data-tab') === 'info' ? 'info' : 'ctl';
      if (S.tab === 'info') markSeen();
      render(); return;
    }
    if (t.closest('#g1go')) { submit(); return; }

    /* 제어 */
    if ((b = t.closest('[data-extend]'))) {
      var r0 = activeRsv();
      if (r0 && b.classList.contains('is-blocked')) { toast(extendCheck(r0).reason); return; }   /* 흐린 버튼 — 누르면 이유만 */
      doExtend(); return;
    }
    if (t.closest('[data-exit]')) { confirmExit(); return; }
    if (t.closest('[data-door]')) {
      var dd = RT.door;
      if (!dd || !dd.locked) return;   /* 이미 열려 있으면 곧 저절로 잠긴다 */
      send(dd.id, '문 열기', [dd], function () {
        dd.locked = false;
        setTimeout(function () { dd.locked = true; render(); }, DOOR_RELOCK_MS);
      });
      return;
    }
    if ((b = t.closest('[data-light]'))) {
      var ls = lights(), l = devOf(b.getAttribute('data-light'));
      if (!l) return;
      send('light', (ls.length > 1 ? l.sub + ' ' : '') + (l.on ? '끄기' : '켜기'), [l], function () { l.on = !l.on; });
      return;
    }
    if ((b = t.closest('[data-remote]'))) {
      var a = devOf(b.getAttribute('data-remote'));
      if (!a) return;
      openSheet({ title: a.name + ' 리모컨', body: remoteHtml(a) });
      remoteId = a.id;
      return;
    }
    if ((b = t.closest('[data-hvac]'))) {
      var h1 = devOf(b.getAttribute('data-hvac'));
      if (h1) send(h1.id, h1.on ? '끄기' : '켜기', [h1], function () { h1.on = !h1.on; });
      return;
    }
    if ((b = t.closest('[data-fan]'))) {
      var h2 = devOf(b.getAttribute('data-fan'));
      if (!h2) return;
      var f = h2.fan >= 3 ? 1 : h2.fan + 1;
      send(h2.id, '풍량 ' + f + '단', [h2], function () { h2.fan = f; });
      return;
    }
    if ((b = t.closest('[data-temp]'))) {
      if (b.classList.contains('is-disabled')) return;
      var h3 = devOf(b.getAttribute('data-id'));
      if (!h3) return;
      var n = h3.target + (+b.getAttribute('data-temp'));
      if (n < h3.min || n > h3.max) return;
      send(h3.id, n + '℃로 바꾸기', [h3], function () { h3.target = n; });
      return;
    }
    if ((b = t.closest('[data-power]'))) {
      var p = devOf(b.getAttribute('data-power'));
      if (p) send(p.id, p.on ? '끄기' : '켜기', [p], function () { p.on = !p.on; });
      return;
    }
    if ((b = t.closest('[data-blind]'))) {
      var bl = devOf(b.getAttribute('data-id')), how = b.getAttribute('data-blind');
      if (!bl) return;
      send(bl.id, { down: '내리기', up: '올리기', stop: '멈추기' }[how], [bl], function () {
        if (how === 'down') bl.pos = 0;
        if (how === 'up') bl.pos = 100;
      });
      return;
    }
    if ((b = t.closest('[data-retry]'))) {
      var k = b.getAttribute('data-retry'), fx = failed[k];
      if (fx) send(k, fx.label, fx.devs, fx.apply);
      return;
    }
    if ((b = t.closest('[data-auto]'))) { pressAuto(+b.getAttribute('data-auto')); return; }
  });

  /* 밝기 — 손을 뗄 때 한 번 보낸다 */
  document.addEventListener('change', function (e) {
    if (!e.target.matches || !e.target.matches('[data-bright]')) return;
    var v = +e.target.value, ls = lights();
    send('light', '밝기 ' + v + '%', ls, function () { RT.bright = v; ls.forEach(function (l) { l.on = v > 0; }); });
  });

  /* 번호 4칸 */
  document.addEventListener('input', function (e) {
    if (e.target.id !== 'code') return;
    var d = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (d.length && !S.digits.length) S.msg = null;   /* 다시 치기 시작하면 앞 결과 한 줄을 지운다 */
    S.digits = d;
    syncCode();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.id === 'code') { e.preventDefault(); submit(); return; }
    if (e.key === 'Escape') {
      if ($('#demo').classList.contains('is-open')) closeDemo();
      else if (isSheetOpen()) closeSheet();
    }
  });

  /* 광고 넘김 점 */
  document.addEventListener('scroll', function (e) {
    var tr = e.target;
    if (!tr.classList || !tr.classList.contains('ads__t')) return;
    var items = tr.children, i = Math.round(tr.scrollLeft / Math.max(1, items[0].offsetWidth + 10));
    $$('span', tr.parentNode.querySelector('.tdots') || document.createElement('i')).forEach(function (s, j) { s.classList.toggle('is-on', j === i); });
  }, true);

  /* 관리자 web이 저장하면(같은 origin의 다른 탭) 그 자리에서 */
  window.addEventListener('storage', function (e) {
    if (e.key !== null && [K_SITE, K_SESS, K_LOCK].indexOf(e.key) === -1) return;
    if (e.key === K_SESS && room) setRoom(S.rid);
    render();
  });

  /* 미리보기 — 관리자 web 드로어의 저장 전 편집값 */
  window.addEventListener('message', function (e) {
    if (!PREVIEW || e.origin !== location.origin) return;
    var d = e.data || {};
    if (d.type === 'site-content') { S.override = d.data && typeof d.data === 'object' && !Array.isArray(d.data) ? d.data : null; render(); }
    else if (d.type === 'site-room' && typeof d.r === 'string') { setRoom(d.r); render(); }
  });

  /* 잠금 시계 · 현황판 코드 만료 — 1초마다(G-01일 때만 고친다) */
  setInterval(function () {
    if (!room || PREVIEW || view() !== 'g1') return;
    if (g1Mode() !== g1Shown) { render(); return; }
    if ($('#code')) {
      var wasLocked = $('#code').disabled;
      if (wasLocked && !lockLeft()) { lockSet(null); S.focus = true; render(); return; }
      if (wasLocked || lockLeft()) syncCode();
    }
  }, 1000);


  /* ── 시작 ── */
  setRoom(S.rid);
  syncUrl();
  render();
  if (PREVIEW && window.parent !== window) {
    try { window.parent.postMessage({ type: 'site-ready', r: S.rid }, location.origin === 'null' ? '*' : location.origin); } catch (e) { /* 부모가 없으면 그만 */ }
  }
  if (Q.get('demo') === '1') setTimeout(openDemo, 400);
})();
