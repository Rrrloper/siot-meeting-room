/* ============================================================
   mock.js — SPEC §17 더미 데이터
   SIOT 신설 「회의실 예약 솔루션」의 전용 앱. 기존 「공간 예약」 솔루션과 별개 상품이다.
   ------------------------------------------------------------
   · ES 모듈 아님. 일반 <script src="assets/mock.js"></script> 로 로드
     → file:// 로 열어도 CORS에 막히지 않는다
   · 전역 하나만 만든다 : window.MOCK
   · "지금"은 NOW 상수로 고정한다. Date.now() / new Date() (인자 없음) 금지
     — 데모 중에 상태가 바뀌면 안 된다 (SPEC §17 기준 시각 고정)
   · 모든 화면이 이 파일 하나만 본다. 화면에서 값을 하드코딩하지 않는다

   ⚠ SPEC §17과 실제 달력이 어긋나는 지점 (그대로 두고 양쪽을 다 보관한다)
     ① 요일 — §17은 9/8(월)·9/9(화)·9/3(수)·8/28(목)·8/26(화)로 적었지만
        2026년 실제 요일은 각각 화·수·목·금·수다(기준일 9/6은 §17대로 일요일).
        canonical 값은 실제 Date이고, §17이 쓴 문자열은 각 항목의 specLabel에 남겼다.
        화면 문구를 §17과 똑같이 뽑으려면 MOCK.useSpecLabels = true 로 둔다.
     ② 층별 현황 — §17의 "5F 4개 중 1개 가용"은 예약 데이터에서 파생되지 않는다
        (5F 4곳 중 지금 사용 중인 곳은 SP-03 하나뿐이라 파생값은 3개 가용).
        §17 문구는 MOCK.floorStatus에, 파생값은 MOCK.fn.getFloorStatus()에 나눠 뒀다.

   ⚠ §17에 값이 없어 데모 기본값으로 채운 것 (필드 주석에 [기본값] 표기)
     · 기기의 on/off·밝기·풍량   · 운영시간(09:00–19:00 — 원본 기획서 §07에서 가져옴)
     · §17이 id를 주지 않은 예약 4건의 id (RSV-3296/3297/3304/3305)
   ============================================================ */

(function (global) {
  'use strict';

  /* ── 기준 시각 — 2026년 9월 6일(일) 14:18 고정 ───────────── */

  var NOW = new Date(2026, 8, 6, 14, 18, 0, 0);

  /** 로컬 시각 생성 (월은 1부터). 이 파일 안의 모든 날짜는 이걸로만 만든다 */
  function at(y, m, d, h, mi) {
    return new Date(y, m - 1, d, h || 0, mi || 0, 0, 0);
  }

  /* 예약 단위 — SLOT_MIN은 관리자 web 설정 › 회의실 기본값 「예약 단위」(1시간 · 30분),
     회의실마다 policy.slotMin(없음 = 기본 설정 따르기 · 60 · 30)으로 바꿀 수 있다 (2026-09-28 57차 — 53차 1시간 고정 원복) */
  var SLOT_MIN = (function () {   /* 같은 origin이면 web이 저장한 값을 쓴다 (2026-09-29 66차 · 회원 · 회사코드와 같은 방식) */
    try { var d = JSON.parse(localStorage.getItem('siot.mr.defaults.v1') || 'null'); if (d && d.unit === '30분') return 30; } catch (e) {}
    return 60;
  })();
  var coSlot = SLOT_MIN;                   // 지금 고른 회사의 기본 예약 단위 — web 설정은 web 회사에만 (74차)
  var EXTEND_MIN = 30;                     // 30분 연장 — 뒤 30분이 비어 있을 때만 (57차 · RSV-08 복원)
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  var ACTIVE = ['APPROVED', 'CHECKED_IN'];   // 아직 살아 있는 예약
  // 그 시간에 실제로 공간을 차지한 것 — 슬롯·가용 판정에 쓴다.
  // USED가 빠지면 SP-03의 09:00–10:00(박서연)이 「비어 있음」으로 뒤집힌다
  var OCCUPYING = ['APPROVED', 'CHECKED_IN', 'USED'];


  /* ── 포맷 헬퍼 ───────────────────────────────────────────── */

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dateLabel(d) { return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + DOW[d.getDay()] + ')'; }   /* web 「9/9 (수)」처럼 요일 앞을 띄운다 (66차) */
  function rangeLabel(a, b) { return hm(a) + '–' + hm(b); }
  function addMin(d, n) { return new Date(d.getTime() + n * 60000); }
  function diffMin(a, b) { return Math.round((b - a) / 60000); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0); }
  function sameDay(a, b) { return startOfDay(a).getTime() === startOfDay(b).getTime(); }
  function diffDays(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / 86400000); }

  /** 'YYYY-MM-DD' 문자열도, Date도 받는다 */
  function toDate(v) {
    if (v instanceof Date) return v;
    var p = String(v).split('-').map(Number);
    return at(p[0], p[1], p[2]);
  }

  /** 소요 시간을 "1시간 30분" 꼴로 */
  function durationLabel(a, b) {
    var m = diffMin(a, b), h = Math.floor(m / 60), r = m % 60;
    if (h && r) return h + '시간 ' + r + '분';
    if (h) return h + '시간';
    return r + '분';
  }


  /* ── 01 회사 · 사업장 (§17) ──────────────────────────────── */

  var company = { id: 'CO-01', name: '(주)한빛산업' };

  var site = {
    id: 'ST-01',
    name: '판교 본사',
    address: '경기도 성남시 분당구',
    openAt: '09:00',                       // [기본값] 원본 기획서 §07 09:00~19:00에서
    closeAt: '19:00'
  };

  var floors = [
    { id: '3F', label: '3층', short: '3F' },
    { id: '5F', label: '5층', short: '5F' },
    { id: '8F', label: '8층', short: '8F' },
    { id: 'RF', label: '옥상', short: 'RF' }
  ];


  /* ── 02 사용자 4명 (§17) ─────────────────────────────────── */

  var users = [
    {
      id: 'U-001', name: '김도현', dept: '제품기획팀', title: '과장',
      empNo: '00142857', phone: '010-1234-5678',   // 앱 계정은 휴대폰 번호 · 이메일 없음 (2026-09-30 72차) — 부서 · 직급은 로그인 뒤 소속으로 다시 채운다(setMe)
      isMe: true
    },
    {
      id: 'U-002', name: '박서연', dept: '경영지원팀', title: '부장',
      empNo: null,
      isMe: false
    },
    {
      id: 'U-003', name: '이준호', dept: '제품기획팀', title: '대리',
      empNo: null,
      isMe: false
    },
    {
      id: 'U-004', name: '최민아', dept: '디자인팀', title: '사원',
      empNo: null,
      isMe: false
    }
  ];

  var me = users[0];
  var RANKS = ['사원', '대리', '과장', '차장', '부장', '이사'];   /* web 회원(A-05) 직급 목록 — 「지정 직급 이상」 판정 순서 (66차) */                                   // 로그인 계정 = 김도현

  function getUser(id) {
    for (var i = 0; i < users.length; i++) if (users[i].id === id) return users[i];
    return null;
  }
  function userName(id) { var u = getUser(id); return u ? u.name : ''; }

  /* 공간 그룹 — web 설정 › 공간 그룹과 같은 무한 단계 트리 (2026-09-29 69차).
     회의실은 어느 단계에나 붙는다(space.floor = 그룹 id). 배열 순서 = 같은 부모 안의 순서 */
  var groups = [
    { id: 'G-1', name: '본관', parent: null },
    { id: '3F', name: '3층', parent: 'G-1' },
    { id: '5F', name: '5층', parent: 'G-1' },
    { id: 'G-2', name: '별관', parent: null },
    { id: '8F', name: '8층', parent: 'G-2' },
    { id: 'RF', name: '옥상', parent: 'G-2' }
  ];
  function groupOf(id) { for (var i = 0; i < groups.length; i++) if (groups[i].id === id) return groups[i]; return null; }
  function groupChildren(pid) { return groups.filter(function (g) { return g.parent === (pid || null); }); }
  /** 뿌리부터 그 그룹까지의 id — 상위를 고르면 하위 회의실까지 걸리게 */
  function groupPath(id) { var out = [], g = groupOf(id); while (g) { out.unshift(g.id); g = groupOf(g.parent); } return out; }
  /** 트리를 위에서 아래로 편 순서 — 목록 정렬용 */
  function groupOrder() {
    var out = [];
    (function walk(pid) { groupChildren(pid).forEach(function (g) { out.push(g.id); walk(g.id); }); })(null);
    return out;
  }

  /** 그룹 id를 사람이 읽는 이름으로 — '5F' → '5층' (화면의 「위치」 표기) */
  function floorLabel(id) {
    var g = groupOf(id); if (g) return g.name;
    for (var i = 0; i < floors.length; i++) if (floors[i].id === id) return floors[i].label;
    return id;
  }


  /* ── 03 공간 10개 (§17) ──────────────────────────────────
     정책은 관리자 web › 회의실 상세 › 「예약 규칙」 · 「누가 · 언제」 · 「입장 인증」과 같은 항목 · 같은 값이다 (2026-09-29 66차 — web이 정본)
       web 항목            키                  값
       수용 인원           policy.capacity     명 (null = 제한 없음)
       예약 단위           policy.unit         '기본'(설정 › 회의실 기본값을 따름) · '1시간' · '30분'
       최대 사용 시간      policy.maxUsageMin  분 — 예약 단위의 배수(web 선택지 30 · 60 · 90 · 120 · 180 · 240)
       며칠 뒤까지 예약    policy.maxLeadDays  일
       최소 몇 분 전       policy.minBefore    분 — 시작까지 이만큼 남아야 예약된다
       연속 예약           policy.consecutive  false면 내 예약 바로 앞뒤에 이어 붙일 수 없다
       하루 예약 횟수      policy.daily        '제한 없음' · '1회' · '2회' — 한 사람이 이 회의실을 하루에
       예약할 수 있는 사람 policy.who          '전체 구성원' · '지정 부서만'(whoValue = 부서 목록) · '지정 직급 이상'(whoValue = 직급)
       운영 요일           days                '평일' · '매일' · '주말'
       운영 시간           openAt ~ closeAt
       입장 인증           entry               'QR' · '리더기' · '인증 없음'
       점검 중             maintenance
     「유형」(회의실 · 포커스룸 …)은 web에 없는 값이라 뺐다. 예약 사유(useReason)도 받지 않으므로 뺐다.
     ⚠ 관리자 승인 구조는 사용자 결정으로 제거했다 (2026-09-08) — 모든 예약은 신청 즉시 확정
     ───────────────────────────────────────────────────────── */

  /* 운영 요일 — web 값 → 요일 번호 */
  var DAYS_OF = { '매일': [0, 1, 2, 3, 4, 5, 6], '평일': [1, 2, 3, 4, 5], '주말': [0, 6] };

  var spaces = [
    {
      id: 'SP-01', name: '포커스룸 A', floor: '3F', entry: '인증 없음',
      favorite: true,
      intro: '혼자 집중할 때 쓰는 4인 포커스룸이에요',   // [기본값] §17에 없음
      hasIot: false, maintenance: false,
      openAt: '09:00', closeAt: '19:00', days: '매일',
      policy: {
        capacity: 4, unit: '기본', maxUsageMin: 120, maxLeadDays: 30, minBefore: 0,
        consecutive: true, daily: '제한 없음', who: '전체 구성원', whoValue: null
      }
    },
    {
      id: 'SP-02', name: '포커스룸 B', floor: '3F', entry: '인증 없음',
      favorite: false,
      intro: '혼자 집중할 때 쓰는 4인 포커스룸이에요',   // [기본값] §17에 없음
      hasIot: false, maintenance: false,
      openAt: '09:00', closeAt: '19:00', days: '매일',
      policy: {
        capacity: 4, unit: '기본', maxUsageMin: 120, maxLeadDays: 30, minBefore: 0,
        consecutive: true, daily: '제한 없음', who: '전체 구성원', whoValue: null
      }
    },
    {
      id: 'SP-03', name: '브레인스토밍룸', floor: '5F', entry: 'QR',
      favorite: true,
      intro: '화이트보드와 모니터가 있는 8인 회의실이에요',   // [기본값] §17에 없음
      hasIot: true, maintenance: false,
      openAt: '09:00', closeAt: '19:00', days: '매일',
      policy: {
        capacity: 8, unit: '기본', maxUsageMin: 120, maxLeadDays: 30, minBefore: 0,
        consecutive: true, daily: '제한 없음', who: '전체 구성원', whoValue: null
      }
    },
    {
      id: 'SP-04', name: '한빛홀', floor: '5F', entry: 'QR',
      favorite: false,
      intro: '빔프로젝터와 화상장비를 갖춘 24인 교육장이에요',   // [기본값] §17에 없음
      hasIot: true, maintenance: false,
      openAt: '09:00', closeAt: '19:00', days: '매일',
      policy: {
        capacity: 24, unit: '기본', maxUsageMin: 240, maxLeadDays: 30, minBefore: 60,
        consecutive: true, daily: '제한 없음', who: '전체 구성원', whoValue: null
      }
    },
    {
      id: 'SP-05', name: '임원회의실', floor: '5F', entry: '리더기',
      favorite: false,
      intro: '임원 일정이 먼저 잡히는 12인 회의실이에요',   // [기본값] §17에 없음
      hasIot: false, maintenance: false,
      openAt: '09:00', closeAt: '19:00', days: '매일',
      policy: {
        capacity: 12, unit: '기본', maxUsageMin: 240, maxLeadDays: 30, minBefore: 0,
        consecutive: true, daily: '제한 없음', who: '지정 직급 이상', whoValue: '부장'
      }
    },
    {
      id: 'SP-06', name: '라운지 미팅존', floor: '8F', entry: '인증 없음',
      favorite: true,
      intro: '바로 쓰는 6인 라운지예요',   // [기본값] §17에 없음
      hasIot: false, maintenance: false,
      openAt: '09:00', closeAt: '19:00', days: '매일',
      policy: {
        capacity: 6, unit: '기본', maxUsageMin: 240, maxLeadDays: 30, minBefore: 0,
        consecutive: true, daily: '제한 없음', who: '전체 구성원', whoValue: null
      }
    },
    {
      id: 'SP-07', name: '폰부스 1', floor: '8F', entry: '인증 없음',
      favorite: false,
      intro: '통화용 1인 부스예요',   // [기본값] §17에 없음
      hasIot: false, maintenance: false,
      openAt: '09:00', closeAt: '19:00', days: '매일',
      policy: {
        capacity: 1, unit: '30분', maxUsageMin: 60, maxLeadDays: 30, minBefore: 0,
        consecutive: false, daily: '1회', who: '전체 구성원', whoValue: null
      }
    },
    {
      id: 'SP-08', name: '폰부스 2', floor: '8F', entry: '인증 없음',
      favorite: false,
      intro: '통화용 1인 부스예요',   // [기본값] §17에 없음
      hasIot: false, maintenance: false,
      openAt: '09:00', closeAt: '19:00', days: '매일',
      policy: {
        capacity: 1, unit: '30분', maxUsageMin: 60, maxLeadDays: 30, minBefore: 0,
        consecutive: false, daily: '1회', who: '전체 구성원', whoValue: null
      }
    },
    {
      id: 'SP-09', name: '옥상 테라스', floor: 'RF', entry: '인증 없음',
      favorite: false,
      intro: '주말에만 여는 20인 옥상 공간이에요',   // [기본값] §17에 없음
      hasIot: false, maintenance: false,
      openAt: '09:00', closeAt: '19:00', days: '주말',
      policy: {
        capacity: 20, unit: '기본', maxUsageMin: 240, maxLeadDays: 30, minBefore: 0,
        consecutive: true, daily: '제한 없음', who: '전체 구성원', whoValue: null
      }
    },
    {
      id: 'SP-10', name: '화상회의실 VC-1', floor: '5F', entry: '리더기',
      capacityLabel: '원격',                       // §17 원격 — 인원 제한 없음
      favorite: false,
      intro: '원격 참석자와 연결하는 화상회의실이에요',   // [기본값] §17에 없음
      hasIot: false, maintenance: false,
      openAt: '09:00', closeAt: '19:00', days: '매일',
      policy: {
        capacity: null, unit: '기본', maxUsageMin: 240, maxLeadDays: 30, minBefore: 0,
        consecutive: true, daily: '제한 없음', who: '전체 구성원', whoValue: null
      }
    }
  ];
  spaces.forEach(function (s) { s.operatingDays = DAYS_OF[s.days] || DAYS_OF['매일']; });

  function getSpace(id) {
    for (var i = 0; i < spaces.length; i++) if (spaces[i].id === id) return spaces[i];
    return null;
  }
  function spaceName(id) { var s = getSpace(id); return s ? s.name : ''; }

  /** SpaceCard 메타 한 줄 — "8명 · 5층" — 모든 화면이 이 순서(인원 · 공간 그룹) (65차 · 66차 유형 삭제) */
  function spaceMeta(id) {
    var s = getSpace(id); if (!s) return '';
    var f = null;
    for (var i = 0; i < floors.length; i++) if (floors[i].id === s.floor) f = floors[i];
    var cap = s.policy.capacity ? s.policy.capacity + '명' : '';   /* 인원 단위는 「명」 하나 (65차) */   /* 정원이 없는 방은 인원을 적지 않는다 (2026-09-23) */
    return [cap, f ? f.label : s.floor].filter(Boolean).join(' · ');   /* 유형은 web에 없는 값이라 뺐다 (66차) */
  }



  /* ── 04 예약 (§17 김도현 6건 + 남의 예약 4건) ──────────────
     status : APPROVED / CHECKED_IN / USED / CANCELED (§15 · NO_SHOW는 2026-09-28 삭제 — 입실하지 않아도 예약은 끝날 때까지 유지)
     specLabel : §17이 적은 날짜 문자열 그대로 (요일이 실제 달력과 다름 — 파일 상단 ⚠①)

     ⚠ 승인 구조 제거(2026-09-08)로 §17과 달라진 곳
       · RSV-3302 REQUESTED → APPROVED (신청 즉시 확정)
       · RSV-3275 REJECTED  → CANCELED (반려라는 상태가 없어졌다)
       · RSV-3304 · RSV-3305 는 「박서연 승인함」 항목이었다. 남의 확정 예약으로 남긴다
     ───────────────────────────────────────────────────────── */

  var reservations = [

    /* — 김도현의 예약 6건 (§17) — */
    {
      id: 'RSV-3301', spaceId: 'SP-03', userId: 'U-001',
      start: at(2026, 9, 6, 14, 0), end: at(2026, 9, 6, 15, 0),
      specLabel: '오늘 14:00–15:00',
      reason: '주간 스프린트 회의', headcount: null,
      status: 'CHECKED_IN',
      checkedInAt: at(2026, 9, 6, 13, 58), checkedOutAt: null,
    },

    /* 오늘 예약 2건 추가 (2026-09-09) — 홈의 「오늘 예약」 스와이프 섹션은
       당일 예약을 여러 장으로 넘겨 보는 자리다. 1건뿐이면 섹션이 성립하지 않아
       시안(오늘 1/3 지난 · 2/3 다음 · 3/3 예정)과 같은 구성을 만들었다.
       §17에 없는 데모 데이터다 */
    {
      id: 'RSV-3299', spaceId: 'SP-06', userId: 'U-001',
      start: at(2026, 9, 6, 10, 0), end: at(2026, 9, 6, 11, 0),
      specLabel: '오늘 10:00–11:00',
      reason: null, headcount: 4,
      status: 'USED',
      checkedInAt: at(2026, 9, 6, 10, 2), checkedOutAt: at(2026, 9, 6, 10, 51),
    },
    {
      id: 'RSV-3300', spaceId: 'SP-01', userId: 'U-001',
      start: at(2026, 9, 6, 17, 0), end: at(2026, 9, 6, 18, 0),
      specLabel: '오늘 17:00–18:00',
      reason: null, headcount: 2,
      status: 'APPROVED',
      checkedInAt: null, checkedOutAt: null,
    },
    {
      id: 'RSV-3302', spaceId: 'SP-04', userId: 'U-001',
      start: at(2026, 9, 8, 10, 0), end: at(2026, 9, 8, 11, 0),
      specLabel: '9/8(월) 10:00–11:00',
      reason: '신제품 사내 설명회', headcount: 22,
      status: 'APPROVED',
      checkedInAt: null, checkedOutAt: null
    },
    {
      id: 'RSV-3303', spaceId: 'SP-01', userId: 'U-001',
      start: at(2026, 9, 9, 16, 0), end: at(2026, 9, 9, 17, 0),
      specLabel: '9/9(화) 16:00–17:00',
      reason: '1on1', headcount: null,
      status: 'APPROVED',
      checkedInAt: null, checkedOutAt: null,
    },
    {
      id: 'RSV-3288', spaceId: 'SP-06', userId: 'U-001',
      start: at(2026, 9, 3, 11, 0), end: at(2026, 9, 3, 12, 0),
      specLabel: '9/3(수) 11:00–12:00',
      reason: null, headcount: null,      // SP-06은 예약사유 불필요
      status: 'USED',
      checkedInAt: at(2026, 9, 3, 11, 2), checkedOutAt: at(2026, 9, 3, 11, 54),
    },
    {
      id: 'RSV-3275', spaceId: 'SP-05', userId: 'U-001',
      start: at(2026, 8, 28, 9, 0), end: at(2026, 8, 28, 10, 0),
      specLabel: '8/28(목) 09:00–10:00',
      reason: null, headcount: null,
      status: 'CANCELED',
      checkedInAt: null, checkedOutAt: null,
      canceledAt: at(2026, 8, 27, 17, 10),
      canceledBy: 'admin', cancelReason: '임원 일정 우선'   // web 예약 › 강제 취소(사유 필수) — 앱 상세 · 알림에 보인다 (66차)
    },
    {
      id: 'RSV-3260', spaceId: 'SP-02', userId: 'U-001',
      start: at(2026, 8, 26, 15, 0), end: at(2026, 8, 26, 16, 0),
      specLabel: '8/26(화) 15:00–16:00',
      reason: null, headcount: null,
      status: 'USED',
      checkedInAt: at(2026, 8, 26, 15, 2), checkedOutAt: at(2026, 8, 26, 15, 58),
    },

    /* — SP-03 오늘 남의 예약 2건 (원본 기획서 §17) —
         §17이 id를 주지 않아 여기서 붙였다 */
    {
      id: 'RSV-3296', spaceId: 'SP-03', userId: 'U-002',
      start: at(2026, 9, 6, 9, 0), end: at(2026, 9, 6, 10, 0),
      specLabel: '오늘 09:00–10:00',
      reason: null, headcount: null,
      status: 'USED',
      checkedInAt: at(2026, 9, 6, 9, 0), checkedOutAt: at(2026, 9, 6, 10, 0),
    },
    {
      id: 'RSV-3297', spaceId: 'SP-03', userId: 'U-003',
      start: at(2026, 9, 6, 16, 0), end: at(2026, 9, 6, 17, 0),
      specLabel: '오늘 16:00–17:00',
      reason: null, headcount: null,
      status: 'APPROVED',
      checkedInAt: null, checkedOutAt: null,
    },

    /* — 남의 확정 예약 2건 (원래 §17 「승인 대기 목록」이던 것) —
         §17이 id를 주지 않아 여기서 붙였다 */
    {
      id: 'RSV-3304', spaceId: 'SP-05', userId: 'U-004',
      start: at(2026, 9, 9, 14, 0), end: at(2026, 9, 9, 15, 0),
      specLabel: '9/9 14:00–15:00',
      reason: '디자인 리뷰', headcount: 8,
      status: 'APPROVED',
      checkedInAt: null, checkedOutAt: null
    },
    {
      id: 'RSV-3305', spaceId: 'SP-04', userId: 'U-003',
      start: at(2026, 9, 12, 13, 0), end: at(2026, 9, 12, 17, 0),
      specLabel: '9/12 13:00–17:00',
      reason: '신입 교육', headcount: 24,
      status: 'APPROVED',
      checkedInAt: null, checkedOutAt: null
    },

    /* — 30분 단위 방의 예약 1건 (57차) — 폰부스 1을 펼치면 30분 칸 사이에 막힌 칸이 보인다. §17에 없는 데모 데이터 */
    {
      id: 'RSV-3306', spaceId: 'SP-07', userId: 'U-004',
      start: at(2026, 9, 6, 15, 0), end: at(2026, 9, 6, 15, 30),
      specLabel: '오늘 15:00–15:30',
      reason: null, headcount: 1,
      status: 'APPROVED',
      checkedInAt: null, checkedOutAt: null
    }
  ];

  /* 인원은 방 정원을 넘지 않는다 — 더미가 다른 방으로 옮겨져도 (2026-09-23) */
  reservations.forEach(function (r) {
    var s = null; for (var i = 0; i < spaces.length; i++) if (spaces[i].id === r.spaceId) s = spaces[i];
    if (s && s.policy.capacity && r.headcount > s.policy.capacity) r.headcount = s.policy.capacity;
  });

  function getReservation(id) {
    for (var i = 0; i < reservations.length; i++) if (reservations[i].id === id) return reservations[i];
    return null;
  }


  /* ── 05 입실 QR (§12) — 예약마다 1회용으로 발급된다 ─────────
     계정에 붙은 고유 QR은 없다. QR은 「예약」이 발급하고,
     현장 QR 리더기가 읽으면 그 자리에서 소멸한다.

       QR_OPEN_MIN  예약 시작 몇 분 전부터 발급되는가 — 0: 내 예약 시간 안에서만(2026-09-28 54차)
       QR_TTL_SEC   발급 후 유효 시간(초). 지나면 다시 받아야 한다
       usedAt       리더기가 읽은 시각. 값이 있으면 그 QR은 죽은 코드다

     남은 시간 카운트다운은 화면(app.js)이 센다 — NOW는 고정이라 여기서 흐르지 않는다
     ───────────────────────────────────────────────────────── */

  /* 입장 인증 · 제어는 점유한 시간 안에서만 — 시작 시각부터. 앞 예약 시간에 문이 열리거나 입실 자동화가 돌지 않게 (2026-09-28 54차) */
  var QR_OPEN_MIN = 0;
  var QR_TTL_SEC = 180;

  var checkinCodes = {};      // reservationId → { code, issuedAt, ttlSec, usedAt }
  var codeSeq = 0;

  /** 지금 이 예약의 QR을 받을 수 있는가 — 시작 10분 전부터 종료 시각까지 */
  /** 입장 인증 — 회의실 속성(관리자 web 정책 탭 · 54차 이름). 인증 없는 방(free)은 QR이 없고 시작 시각에 자동 입실한다 (2026-09-22) */
  function isFreeSpace(spaceId) { var s = getSpace(spaceId); return !!s && s.entry === '인증 없음'; }
  /** 리더기 방(안면인식 등) — 현장 장비가 입실을 기록한다. 앱에는 QR도 버튼도 없다 */
  function isReaderSpace(spaceId) { var s = getSpace(spaceId); return !!s && s.entry === '리더기'; }
  function anyQrSpace() { return spaces.some(function (s) { return s.entry === 'QR' || !s.entry; }); }
  /** 자유 이용 방 — 시작 시각이 지났으면 아무것도 누르지 않아도 「사용 중」 */
  function autoEnter() {
    reservations.forEach(function (r) {
      if (r.status === 'APPROVED' && isFreeSpace(r.spaceId) && r.start <= NOW && NOW < r.end) { r.status = 'CHECKED_IN'; r.checkedInAt = r.start; r.autoEntered = true; }
    });
  }

  function canIssueCheckinCode(r) {
    if (!r) return false;
    if (isFreeSpace(r.spaceId) || isReaderSpace(r.spaceId)) return false;   // 인증 없는 방 · 리더기 방은 QR 체크인이 없다
    if (r.userId !== me.id) return false;
    if (r.status !== 'APPROVED') return false;      // 이미 입실했거나 끝난 예약은 대상이 아니다
    if (NOW >= r.end) return false;
    return diffMin(NOW, r.start) <= QR_OPEN_MIN;    // 시작 뒤(음수)도 포함한다
  }

  /** 1회용 코드 발급 — 같은 예약이라도 받을 때마다 코드가 새로 나온다 */
  function issueCheckinCode(reservationId) {
    var r = getReservation(reservationId);
    if (!r) return null;
    codeSeq += 1;
    checkinCodes[r.id] = {
      code: 'SK' + r.id.replace('RSV-', '') + '-' + String(100000 + (codeSeq * 48271) % 900000),
      issuedAt: NOW,
      ttlSec: QR_TTL_SEC,
      usedAt: null
    };
    return checkinCodes[r.id];
  }

  function getCheckinCode(reservationId) {
    return checkinCodes[reservationId] || null;
  }

  /** 리더기가 읽었다 — 코드를 소멸시키고 예약을 입실 상태로 바꾼다 */
  function consumeCheckinCode(reservationId) {
    var c = checkinCodes[reservationId];
    if (!c || c.usedAt) return null;
    c.usedAt = NOW;
    return c;
  }


  /* ── 06 SP-03 기기 5종 + 씬 3개 (§17 S-14) ──────────────
     [기본값] on/off·밝기·풍량은 §17에 값이 없어 "사용 중"에 맞춰 채웠다
     ───────────────────────────────────────────────────────── */

  var devices = {
    spaceId: 'SP-03',
    items: [
      {
        id: 'DV-LIGHT', kind: 'light', name: '조명', status: 'ONLINE',
        zones: [
          { id: 'LZ-1', name: '창측', on: true },      // [기본값]
          { id: 'LZ-2', name: '스크린측', on: true }   // [기본값]
        ],
        brightness: 80                                  // [기본값]
      },
      {
        id: 'DV-HVAC', kind: 'hvac', name: '냉난방', status: 'ONLINE',
        on: true,                                       // [기본값]
        current: 24, target: 24, min: 18, max: 28, step: 1,
        fan: 2, fanMax: 3                               // [기본값]
      },
      {
        id: 'DV-PLUG', kind: 'plug', name: '콘센트', status: 'ONLINE',
        channels: [
          { id: 'PC-1', name: '빔프로젝터', on: true },  // [기본값]
          { id: 'PC-2', name: '모니터', on: true },      // [기본값]
          { id: 'PC-3', name: '충전', on: false }        // [기본값]
        ]
      },
      {
        id: 'DV-DOOR', kind: 'door', name: '도어락', status: 'ONLINE',
        locked: true,                                   // 평소 잠김 — 「문 열기」로 잠깐 열리고 DOOR_RELOCK_MS 뒤 저절로 잠긴다(web 제어 패널과 같은 모델 · 66차)
        needsBiometric: true                            // §12 S-14 도어 해제는 생체인증 1회
      },
      {
        id: 'DV-BLIND', kind: 'blind', name: '블라인드', status: 'OFFLINE',
        position: null                                  // 오프라인 시연용 (§17)
      }
    ],
    /* 회의실 버튼(관리자 웹 › 회의실 상세 › 연동 장비 · 2026-09-28 47차).
       입실 · 퇴실은 기본 버튼이라 제어 화면에 따로 나오지 않는다 — 입실 자동화는 체크인되면, 퇴실 자동화는 「퇴실하기」를 누르면 실행된다.
       버튼 줄에는 관리자가 이름을 지어 추가한 버튼만 나온다(버튼마다 SIOT 자동화 하나) */
    entryAuto: '회의 시작',
    exitAuto: '퇴실',
    scenes: [
      { id: 'SC-2', name: '발표', cta: '발표 모드로 바꾸기' }
    ]
  };

  function getDevices(spaceId) { return devices.spaceId === spaceId ? devices : null; }

  var DOOR_RELOCK_MS = 3000;   /* web 제어 패널 「열림 · 3초 뒤 잠김」과 같다 (66차) */

  /* SIOT 자동화 — 이름은 web 회의실 상세 › 연동 장비의 입실 · 퇴실 · 추가 버튼에 매핑한 값.
     실제로는 SIOT가 실행한다. 프로토타입은 기기 값만 바꾸고 기록을 남긴다 (2026-09-29 66차) */
  var automations = {
    '회의 시작': function (dv) {
      dv.items.forEach(function (d) {
        if (d.kind === 'light') { d.zones.forEach(function (z) { z.on = true; }); d.brightness = 80; }
        if (d.kind === 'hvac') { d.on = true; d.target = 24; }
      });
    },
    '퇴실': function (dv) {
      dv.items.forEach(function (d) {
        if (d.kind === 'light') d.zones.forEach(function (z) { z.on = false; });
        if (d.kind === 'hvac') d.on = false;
        if (d.kind === 'plug') d.channels.forEach(function (c) { c.on = false; });
        if (d.kind === 'door') d.locked = true;
      });
    }
  };
  /** 입실 · 퇴실 자동화 실행 — 매핑이 없으면 아무것도 하지 않는다. web 기록의 「입실 · 회의 시작 자동화 실행」과 같은 한 줄 */
  function runAutomation(spaceId, which) {
    var dv = getDevices(spaceId);
    var name = dv ? (which === 'entry' ? dv.entryAuto : dv.exitAuto) : '';
    if (!name) return '';
    if (automations[name]) automations[name](dv);
    addLog(spaceId, which === 'entry' ? '입실' : '퇴실', name + ' 자동화 실행', 'OK', { auto: true });   /* web 기록 문구와 같다 */
    return name;
  }


  /* ── 07 층별 현황 (§17 S-05 문구 그대로) ─────────────────
     파생값과 다르다 — 파일 상단 ⚠② 참고. 화면 문구는 이 값을 쓴다
     ───────────────────────────────────────────────────────── */

  var floorStatus = {
    text: '3F 2개 · 5F 1개 · 8F 2개 비어 있어요',
    rows: [
      { floor: '3F', total: 2, free: 2 },
      { floor: '5F', total: 4, free: 1 },
      { floor: '8F', total: 3, free: 2 }
    ]
  };


  /* ── 08 알림 2건 (§17 S-21) ─────────────────────────────
     문안은 관리자 web 설정 › 알림(A-08 KINDS)이 정본 — 앱 알림함은 그 문안을 그대로 보여 준다 (2026-09-29 66차) */

  var notifications = [
    {
      id: 'NT-01', kind: 'remind',
      at: at(2026, 9, 6, 13, 30),                       // 리마인드 시점 = web 설정 값(처음 30분 전)
      title: '회의가 30분 뒤 시작해요', body: '브레인스토밍룸(5층) · 14:00\n문 앞 예약 현황판의 QR로 입실하세요',
      reservationId: 'RSV-3301', spaceId: 'SP-03', read: false
    },
    {
      id: 'NT-02', kind: 'cancel',                      // 관리자 강제 취소 — web 예약 › 강제 취소(사유 필수)
      at: at(2026, 8, 27, 17, 10),
      title: '관리자가 예약을 취소했어요', body: '임원회의실 · 8/28 (금) 09:00\n사유 · 임원 일정 우선',
      reservationId: 'RSV-3275', spaceId: 'SP-05', read: false
    }
  ];


  /** 내 알림만 — 알림은 회사 데이터에 있지만 사람마다 따로다. 예약에 딸린 알림은 그 예약 주인에게만 (72차) */
  function myNotifications() {
    return notifications.filter(function (n) {
      if (!n.reservationId) return true;
      var r = getReservation(n.reservationId);
      return !!r && r.userId === me.id;
    });
  }


  /* ── 08b 예약 사유 프리셋 (§11 S-09) ─────────────────────
     [기본값] §17에 없음. useReason이 true인 공간에서만 쓴다 */

  var reasonPresets = ['주간 회의', '1on1', '고객 미팅', '교육', '인터뷰', '집중 업무'];


  /* ── 08c 검색 (§11 S-24) ────────────────────────────────
     최근 검색어만 [기본값]. 추천 키워드는 2026-09-28 제거 */

  var recentSearches = ['화이트보드', '한빛홀', '8층'];

  /** 회의실 이름 · 층으로 찾는다 (설비 2026-09-28 · 유형 66차 삭제) */
  function searchSpaces(q) {
    var k = String(q || '').trim().toLowerCase();
    if (!k) return [];
    return spaces.filter(function (s) {
      var hay = [s.name, s.floor, spaceMeta(s.id)].join(' ').toLowerCase();
      return hay.indexOf(k) !== -1;
    });
  }


  /* ── 08d 제어 이력 (§12 S-14b) ──────────────────────────
     세션 중 실제 조작이 여기에 쌓인다. 초기값은 §17이 준 사실 하나 —
     RSV-3301의 체크인 시각(13:58)에 도어가 열린 기록뿐이다 */

  var controlLog = [
    {
      id: 'LG-0001', spaceId: 'SP-03', at: at(2026, 9, 6, 13, 58),
      actorId: 'U-001', auto: false,
      device: '도어락', action: '문 열기', result: 'OK', reason: null
    }
  ];

  var logSeq = 1;
  function addLog(spaceId, device, action, result, opts) {
    opts = opts || {};
    logSeq += 1;
    controlLog.unshift({
      id: 'LG-' + String(1000 + logSeq).slice(1),
      spaceId: spaceId,
      at: opts.at || NOW,
      actorId: opts.auto ? null : me.id,
      auto: !!opts.auto,
      device: device, action: action, result: result,
      reason: opts.reason || null
    });
    return controlLog[0];
  }

  /** 날짜 그룹으로 묶어서 돌려준다 (§12 S-14b) */
  function groupedLog(spaceId) {
    var list = controlLog.filter(function (l) { return !spaceId || l.spaceId === spaceId; });
    var groups = [];
    list.forEach(function (l) {
      var key = ymd(l.at);
      var g = null;
      groups.forEach(function (x) { if (x.key === key) g = x; });
      if (!g) { g = { key: key, label: dateLabel(l.at), items: [] }; groups.push(g); }
      g.items.push(l);
    });
    return groups;
  }


  /* ── 08f 알림 설정 (2026-09-30 70차) ────────────────────
     무엇을 · 언제 보낼지(정책)는 관리자 web 설정 › 알림 — 켠 종류 · 리마인드 시점 · 야간 보류 · 문안.
     이 폰에서 울릴지는 사람마다 앱 마이 › 알림 설정 — 전체 켜기/끄기 + 종류별. 관리자가 끈 종류는 목록에 없다.
     규약: 정책 siot.mr.notify.v1(web이 쓴다) · 이 폰 설정 siot.mr.push.v1(기기마다 · 프로토타입은 localStorage)
     74차 — 정책은 회사마다다. 이 폰 설정도 회사마다: { v:2, all, off: { 회사코드: { 종류: true }, _account: { member: true } } }
       · 회사 알림 = 그 회사가 켠 종류(web 회사만 siot.mr.notify.v1, 앱에만 있는 데모 회사는 처음 값)
       · 계정 알림 = 「가입 결과」(승인 · 반려 · 퇴사) — 회사가 끌 수 없는 필수 알림. 이 폰에서 울릴지만 고른다
       · v1(회사 구분 없는 옛 설정)은 읽지 않는다 */
  var NKEY = 'siot.mr.notify.v1', PUSH_KEY = 'siot.mr.push.v1';
  var NOTIFY_KINDS = [['confirm', '예약 확정', true], ['remind', '리마인드', true], ['fail', '제어 실패', false], ['cancel', '예약 취소 (관리자)', true]];   /* web 처음 값과 같다 */
  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  /** cos = [{ code, name, web }] — 내 정상 소속 회사들 */
  function readNotify(cos) {
    var mine = readJSON(PUSH_KEY) || {}, off = mine.v === 2 && mine.off ? mine.off : {};
    var acc = off._account || {};
    return {
      all: mine.all !== false,
      account: [{ id: 'member', name: '가입 결과', on: !acc.member }],
      groups: (cos || []).map(function (c) {
        var pol = c.web ? readJSON(NKEY) : null, on = (pol && pol.on) || {}, o = off[c.code] || {};
        return {
          code: c.code, name: c.name, remindBefore: +((pol && pol.lead) || 30),
          items: NOTIFY_KINDS.filter(function (k) { return on[k[0]] !== undefined ? on[k[0]] : k[2]; })
            .map(function (k) { return { id: k[0], name: k[1], on: !o[k[0]] }; })
        };
      })
    };
  }
  function savePush(s) {
    var off = { _account: {} };
    s.account.forEach(function (it) { if (!it.on) off._account[it.id] = true; });
    s.groups.forEach(function (g) { var o = {}; g.items.forEach(function (it) { if (!it.on) o[it.id] = true; }); off[g.code] = o; });
    try { localStorage.setItem(PUSH_KEY, JSON.stringify({ v: 2, all: s.all, off: off })); } catch (e) {}
  }
  var notifySettings = readNotify([]);


  /* ── 08g 전자명판 (§14 S-22 · S-23) ─────────────────────
     [기본값] §17에 없음. 공간마다 문 앞 명판이 하나씩 있다고 두고
     이름·영문·카테고리는 공간 데이터에서 옮겼다. SP-08만 오프라인 시연용 */

  var SIGN_EN = {
    'SP-01': 'FOCUS ROOM A', 'SP-02': 'FOCUS ROOM B', 'SP-03': 'BRAINSTORMING ROOM',
    'SP-04': 'HANBIT HALL', 'SP-05': 'EXECUTIVE ROOM', 'SP-06': 'LOUNGE',
    'SP-07': 'PHONE BOOTH 1', 'SP-08': 'PHONE BOOTH 2', 'SP-09': 'ROOFTOP', 'SP-10': 'VC-1'
  };

  var signage = spaces.map(function (s, i) {
    return {
      id: 'SG-' + pad(i + 1),
      spaceId: s.id,
      title: s.name,
      subtitle: SIGN_EN[s.id],
      template: 'T1',                      // T1 가운데 / T2 왼쪽 아래
      color: 'dark',                       // dark · brand · light
      titleX: 50, titleY: 42,              // % — 드래그로 바꾼다
      titleSize: 22, subSize: 11,          // 미리보기 폭 180px 기준 — 슬라이더로 바꾼다
      status: s.id === 'SP-08' ? 'OFFLINE' : 'ONLINE'
    };
  });

  function getSignage(id) {
    for (var i = 0; i < signage.length; i++) if (signage[i].id === id) return signage[i];
    return null;
  }


  /* ── 08h 고객사 브랜딩 (홈 좌측상단) ─────────────────────
     지금은 여기 값을 직접 고치지만, 나중에 관리자 페이지가 이 객체를 채운다.
     화면은 이 객체만 읽는다 — 상호·로고를 화면에 하드코딩하지 않는다.

     logo.src 에 파일 경로를 넣으면 그게 우선한다 (예: 'assets/img/logo.png').
     비어 있으면 logo.svg 의 인라인 마크를 쓴다. 색은 --logo-1~3 토큰. */

  var branding = {
    companyName: '대양씨아이에스',      // 상호
    companyCode: 'DYCIS-2026',      // 가입 화면의 회사코드 — 관리자 웹 A-18에서 바꾼다
    shortName: 'DY 대양',              // 워드마크에 쓰는 짧은 이름
    siteName: site.name,               // 사업장명 — 사업장이 바뀌면 여기서 갈린다

    logo: {
      /* 고객사가 준 원본 (91×35, 배경 투명). 마크 + "DY 대양" 글자가 한 덩어리라
         마크만 필요한 시안에서는 왼쪽 23px만 잘라 쓴다 — markRatio = 23/35 */
      src: 'logo/dy.gif',
      markRatio: 0.657,
      alt: '대양씨아이에스',
      /* 첨부 로고를 보고 옮긴 인라인 마크 — 같은 방향으로 기운 두 면이 겹치고
         겹친 가운데가 진해진다. 원본 파일을 쓰려면 위 src에 경로를 넣으면 된다 */
      svg:
        '<svg class="brandmark" viewBox="0 0 26 34" role="img" aria-label="대양씨아이에스">' +
          '<path d="M5 3h12l-5 28H0z" fill="var(--logo-1)"/>' +
          '<path d="M13 3h12l-5 28H8z" fill="var(--logo-3)"/>' +
          '<path d="M13 3h4l-5 28H8z" fill="var(--logo-2)"/>' +
        '</svg>'
    },

    /* 홈 좌측상단 표시 방식 — 시안 A~E. brand-variants.html에서 비교한다 */
    headerVariant: 'D'
  };

  /**
   * mode 'mark'   — 마크만 (시안 A·B·D·E. 옆에 상호·사업장 글자가 따로 오므로)
   * mode 'lockup' — 마크 + 글자 통째로 (시안 C)
   * 원본 파일이 없으면 인라인 SVG 마크로 떨어진다
   */
  function brandLogoHtml(mode) {
    var lg = branding.logo;
    if (!lg.src) return lg.svg;

    var img = '<img src="' + lg.src + '" alt="' + lg.alt + '">';
    if (mode === 'lockup') {
      return '<span class="brandmark brandmark--lockup">' + img + '</span>';
    }
    return '<span class="brandmark brandmark--mark" style="--mark-ratio:' + lg.markRatio + '">' + img + '</span>';
  }


  /* ── 09 상태 문구 사전 (§15) — 화면이 문구를 지어내지 않게 ── */

  var statusText = {
    // 예약 상태 5종 — 배지가 아니라 색 텍스트 (tone은 components.css의 .status--*)
    // REQUESTED · REJECTED는 승인 구조 제거(2026-09-08)로 사라졌다
    APPROVED:   { text: '예약 확정', tone: 'brand' },
    CHECKED_IN: { text: '사용 중', tone: 'brand', railLeft: true },
    USED:       { text: '예약 종료', tone: 'muted', dimThumb: true },
    CANCELED:   { text: '취소됨', tone: 'dim', dimAll: true }   // 상태는 명사형 한 벌 (2026-09-29 65차)
  };

  var availabilityText = {
    AVAILABLE:   { text: '바로 사용 가능', tone: 'ok' },
    IN_USE:      { text: '까지 사용 중', tone: 'muted' },     // 앞에 종료 시각을 붙인다
    OFFLINE:     { text: '기기 연결이 끊겼어요', tone: 'warn' },
    MAINTENANCE: { text: '점검 중이에요', tone: 'dim' }
  };


  /* ============================================================
     파생 함수
     ============================================================ */

  /** 아직 살아 있는 예약인가 (예정·진행 중) */
  function isActive(r) { return ACTIVE.indexOf(r.status) !== -1; }
  /** 그 시간에 공간을 차지한 예약인가 (지나간 예약 종료 포함) */
  function isOccupying(r) { return OCCUPYING.indexOf(r.status) !== -1; }

  /** 특정 공간의 특정 날짜 예약들 (공간을 차지한 것만, 시작 순) */
  function reservationsOf(spaceId, date) {
    var day = startOfDay(toDate(date));
    return reservations.filter(function (r) {
      return r.spaceId === spaceId && isOccupying(r) && sameDay(r.start, day);
    }).sort(function (a, b) { return a.start - b.start; });
  }

  /** 그 공간의 예약 단위(분) — 회의실 정책이 없으면 기본 설정 (57차) */
  function slotMinOf(spaceId) {
    var sp = getSpace(spaceId);
    if (!sp) return coSlot;
    return sp.policy.unit === '30분' ? 30 : sp.policy.unit === '1시간' ? 60 : coSlot;   /* '기본' = 그 회사 설정 값 (74차 · 회사마다) */   /* '기본' = web 설정 값 (66차) */
  }

  /**
   * getAvailableSlots(spaceId, date)
   * 그 공간의 예약 단위(1시간 · 30분)로 슬롯 목록을 만든다. 운영시간 밖은 애초에 만들지 않는다(§03 P-12 —
   * "존재 자체가 없는 것만 숨긴다"). 예약됨·지난 시간은 남겨 두고 이유를 붙인다.
   *
   * @returns [{ start, end, label, state, mine, by, reservationId, reason }]
   *   state : 'AVAILABLE' 고를 수 있음
   *           'BOOKED'    이미 예약됨 (누르면 reason 토스트)
   *           'PAST'      지난 시간   (누르면 reason 토스트)
   *   운영일이 아니면 빈 배열을 돌려준다
   */
  function getAvailableSlots(spaceId, date) {
    var sp = getSpace(spaceId);
    if (!sp) return [];

    var day = startOfDay(toDate(date));
    if (sp.operatingDays.indexOf(day.getDay()) === -1) return [];   // 운영일 아님

    var o = sp.openAt.split(':'), c = sp.closeAt.split(':');
    var open = new Date(day); open.setHours(+o[0], +o[1], 0, 0);
    var close = new Date(day); close.setHours(+c[0], +c[1], 0, 0);

    var booked = reservationsOf(spaceId, day);
    var out = [], step = slotMinOf(spaceId);

    for (var t = new Date(open); t < close; t = addMin(t, step)) {
      var s = new Date(t), e = addMin(t, step);
      var hit = null;
      for (var i = 0; i < booked.length; i++) {
        if (s < booked[i].end && e > booked[i].start) { hit = booked[i]; break; }
      }

      var slot = {
        start: s, end: e, label: hm(s),
        state: 'AVAILABLE', mine: false, reservationId: null, reason: null
      };

      // 남의 예약은 누구인지 드러내지 않는다 — 내 것인지와 예약 id만 붙인다 (§11 P-4)
      if (hit) {
        slot.mine = hit.userId === me.id;
        slot.reservationId = hit.id;
      }

      // 고를 수 없는 이유는 하나만 말한다 — 지난 시간이 예약됨보다 먼저다
      if (e <= NOW) {
        slot.state = 'PAST';
        slot.reason = '지난 시간은 예약할 수 없어요';
      } else if (hit) {
        slot.state = 'BOOKED';
        slot.reason = rangeLabel(hit.start, hit.end) + '은 이미 예약돼 있어요';
      }

      out.push(slot);
    }
    return out;
  }

  /**
   * getSpaceStatus(spaceId, at)
   * §15 "공간 가용 표시"를 그대로 돌려준다.
   *
   * @param at 생략하면 NOW
   * @returns { key, text, tone, until, by, reservationId }
   *   key : 'AVAILABLE' | 'IN_USE' | 'OFFLINE' | 'MAINTENANCE' | 'CLOSED'
   *   CLOSED(운영시간·운영일 밖)는 §15에 문구가 없어 text를 null로 둔다 — 화면이 정한다
   */
  function getSpaceStatus(spaceId, when) {
    var sp = getSpace(spaceId);
    if (!sp) return null;
    var t = when ? toDate(when) : NOW;

    if (sp.maintenance) {
      return { key: 'MAINTENANCE', text: availabilityText.MAINTENANCE.text, tone: 'dim', until: null, by: null, reservationId: null };
    }

    // 공간 단위 오프라인은 그 공간의 기기가 전부 끊겼을 때만
    var dv = getDevices(spaceId);
    if (dv && dv.items.length && dv.items.every(function (d) { return d.status === 'OFFLINE'; })) {
      return { key: 'OFFLINE', text: availabilityText.OFFLINE.text, tone: 'warn', until: null, by: null, reservationId: null };
    }

    // 운영일 · 운영시간 밖
    var o = sp.openAt.split(':'), c = sp.closeAt.split(':');
    var open = new Date(t); open.setHours(+o[0], +o[1], 0, 0);
    var close = new Date(t); close.setHours(+c[0], +c[1], 0, 0);
    if (sp.operatingDays.indexOf(t.getDay()) === -1 || t < open || t >= close) {
      return { key: 'CLOSED', text: null, tone: 'dim', until: null, by: null, reservationId: null };
    }

    // 지금 누가 쓰고 있나
    var day = reservationsOf(spaceId, t);
    for (var i = 0; i < day.length; i++) {
      var r = day[i];
      if (r.start <= t && t < r.end) {
        return {
          key: 'IN_USE',
          text: hm(r.end) + availabilityText.IN_USE.text,   // "15:00까지 사용 중"
          tone: 'muted',
          until: r.end, by: userName(r.userId), reservationId: r.id
        };
      }
    }

    return { key: 'AVAILABLE', text: availabilityText.AVAILABLE.text, tone: 'ok', until: null, by: null, reservationId: null };
  }

  /**
   * isDateSelectable(spaceId, date)
   * DateStrip에서 흐리게 둘 날짜와 그 이유 (§03 P-12 · §11 S-08)
   */
  function isDateSelectable(spaceId, date) {
    var sp = getSpace(spaceId);
    if (!sp) return { ok: false, reason: null };
    var day = startOfDay(toDate(date));
    var gap = diffDays(NOW, day);

    if (gap < 0) return { ok: false, reason: '지난 날짜는 예약할 수 없어요' };
    if (gap > sp.policy.maxLeadDays) {
      return { ok: false, reason: sp.policy.maxLeadDays + '일 뒤까지 예약할 수 있어요', short: sp.policy.maxLeadDays + '일 뒤까지' };
    }
    if (sp.operatingDays.indexOf(day.getDay()) === -1) {
      return { ok: false, reason: '이 회의실은 ' + sp.days + '에만 열려요', short: sp.days + '만' };
    }
    return { ok: true, reason: null };
  }

  /** 최대 사용시간을 슬롯 개수로 (§07 TimeSlotGrid — 넘기면 더 선택되지 않음) */
  function getMaxSlots(spaceId) {
    var sp = getSpace(spaceId);
    return sp ? Math.floor(sp.policy.maxUsageMin / slotMinOf(spaceId)) : 0;
  }

  /**
   * extendCheck(reservationId) — 30분 연장이 되는가 (RSV-08 · 2026-09-28 57차 복원)
   * 최대 사용 시간과는 무관하다. 뒤 30분이 비어 있고 운영 시간 안이면 몇 번이든 된다.
   * @returns { ok, until, reason }  reason은 막힌 이유 한 줄(토스트)
   */
  function extendCheck(id) {
    var r = getReservation(id);
    if (!r) return { ok: false, until: null, reason: '예약을 찾을 수 없어요' };
    var sp = getSpace(r.spaceId);
    var to = addMin(r.end, EXTEND_MIN);
    var c = sp.closeAt.split(':');
    var close = new Date(r.end); close.setHours(+c[0], +c[1], 0, 0);
    if (to > close) return { ok: false, until: null, reason: sp.closeAt + '에 운영이 끝나 연장할 수 없어요' };
    var next = reservationsOf(r.spaceId, r.end).filter(function (x) {
      return x.id !== r.id && x.start < to && x.end > r.end;
    })[0];
    if (next) return { ok: false, until: null, reason: hm(next.start) + '에 다음 예약이 있어 연장할 수 없어요' };
    return { ok: true, until: to, reason: null };
  }

  /** 연장한다 — 막히면 아무것도 바꾸지 않고 extendCheck 결과를 그대로 돌려준다 */
  function extendReservation(id) {
    var ch = extendCheck(id);
    if (ch.ok) getReservation(id).end = ch.until;
    return ch;
  }

  /** 최대 사용시간 초과 토스트 문구 (§11 S-08) */
  function maxUsageMessage(spaceId) {
    var sp = getSpace(spaceId);
    if (!sp) return '';
    var m = sp.policy.maxUsageMin;
    var label = m % 60 === 0 ? (m / 60) + '시간' : m + '분';
    return '이 회의실은 최대 ' + label + '까지 쓸 수 있어요';
  }

  /** 수용인원 초과 안내 (§11 S-08 스테퍼) */
  function capacityMessage(spaceId) {
    var sp = getSpace(spaceId);
    if (!sp || sp.policy.capacity == null) return null;
    return '이 회의실은 ' + sp.policy.capacity + '명까지예요';
  }

  /** 예약할 수 있는 사람 — web 「누가 · 언제 › 예약할 수 있는 사람」 (66차) */
  function whoCheck(spaceId) {
    var p = getSpace(spaceId).policy;
    /* 지정 부서만 — 상위 부서를 고르면 그 아래 부서도 들어간다(web 트리 · 72차). 내 부서 경로 중 하나라도 걸리면 된다 */
    var myPath = me.deptPath && me.deptPath.length ? me.deptPath : [me.dept];
    if (p.who === '지정 부서만' && !(p.whoValue || []).some(function (v) { return myPath.indexOf(v) !== -1; })) return { ok: false, reason: '지정 부서만 예약할 수 있어요', short: '지정 부서만' };
    if (p.who === '지정 직급 이상' && RANKS.indexOf(me.title) < RANKS.indexOf(p.whoValue)) return { ok: false, reason: p.whoValue + ' 이상만 예약할 수 있어요', short: p.whoValue + ' 이상만' };
    return { ok: true, reason: null };
  }

  /**
   * bookCheck(spaceId, start, end) — 이 시간으로 예약할 수 있는가. 관리자 web 회의실 상세의 예약 규칙을 그대로 태운다 (2026-09-29 66차)
   * 비어 있는지(슬롯)는 화면이 따로 본다. 여기서는 정책만 — 막히면 이유 한 줄
   */
  function bookCheck(spaceId, start, end) {
    var sp = getSpace(spaceId);
    if (!sp) return { ok: false, reason: null };
    var p = sp.policy;
    if (sp.maintenance) return { ok: false, reason: '점검 중이에요', short: '점검 중' };
    var w = whoCheck(spaceId); if (!w.ok) return w;
    var d = isDateSelectable(spaceId, start); if (!d.ok) return { ok: false, reason: d.reason, short: d.short || d.reason };
    if (p.minBefore && diffMin(NOW, start) < p.minBefore) return { ok: false, reason: '시작 ' + p.minBefore + '분 전까지 예약할 수 있어요', short: p.minBefore + '분 전까지' };
    if (end && diffMin(start, end) > p.maxUsageMin) return { ok: false, reason: maxUsageMessage(spaceId), short: '최대 ' + (p.maxUsageMin % 60 ? p.maxUsageMin + '분' : p.maxUsageMin / 60 + '시간') };
    var mine = reservations.filter(function (r) {
      return r.userId === me.id && r.spaceId === spaceId && OCCUPYING.indexOf(r.status) !== -1;
    });
    var limit = p.daily === '1회' ? 1 : p.daily === '2회' ? 2 : 0;
    if (limit && mine.filter(function (r) { return sameDay(r.start, start); }).length >= limit) {
      return { ok: false, reason: '이 회의실은 하루 ' + limit + '회까지 예약할 수 있어요', short: '하루 ' + limit + '회' };
    }
    if (!p.consecutive && end && mine.some(function (r) { return +r.end === +start || +r.start === +end; })) {
      return { ok: false, reason: '이 회의실은 내 예약에 이어서 예약할 수 없어요', short: '이어서 예약 불가' };
    }
    return { ok: true, reason: null };
  }

  /** 예약 목록 — 내 것만, 상태 필터 가능. 최신 순 */
  function myReservations(kind) {
    var list = reservations.filter(function (r) { return r.userId === me.id; });
    if (kind === 'upcoming') {
      list = list.filter(function (r) { return isActive(r) && r.end > NOW; });
      list.sort(function (a, b) { return a.start - b.start; });
    } else if (kind === 'past') {
      list = list.filter(function (r) { return !isActive(r) || r.end <= NOW; });
      list.sort(function (a, b) { return b.start - a.start; });
    } else {
      list.sort(function (a, b) { return b.start - a.start; });
    }
    return list;
  }

  /** 지금 진행 중인 내 예약 (홈 ① 진행 중 카드) */
  function currentReservation() {
    var list = reservations.filter(function (r) {
      return r.userId === me.id && r.status === 'CHECKED_IN' && r.start <= NOW && NOW < r.end;
    });
    return list.length ? list[0] : null;
  }

  /** 남은 시간(분) — "사용 중 · 42분 남음" */
  function remainingMin(reservationId) {
    var r = getReservation(reservationId);
    if (!r) return null;
    return Math.max(0, diffMin(NOW, r.end));
  }

  /** 층별 현황 파생값 — §17 문구(MOCK.floorStatus)와 다를 수 있다 (⚠②) */
  function getFloorStatus(when) {
    var t = when ? toDate(when) : NOW;
    return floors.map(function (f) {
      var inFloor = spaces.filter(function (s) { return s.floor === f.id; });
      var free = inFloor.filter(function (s) {
        var st = getSpaceStatus(s.id, t);
        return st && st.key === 'AVAILABLE';
      });
      return { floor: f.id, label: f.label, total: inFloor.length, free: free.length };
    });
  }

  /** 지금 입실 QR을 받을 수 있는 내 예약 — 없으면 null (§12) */
  function checkinTarget() {
    var list = reservations.filter(canIssueCheckinCode);
    list.sort(function (a, b) { return a.start - b.start; });
    return list.length ? list[0] : null;
  }


  /* ── 10 회사별 데이터 (2026-09-30 72차) ─────────────────────
     앱은 플랫폼이다 — 한 사람이 여러 회사에 소속되고 홈 헤더에서 회사를 바꾼다.
     공간 그룹 · 회의실 · 예약 · 알림 · 제어 이력은 회사마다 따로다. useCompany(key)가 배열을 그 자리에서 갈아 끼운다
     (화면이 쥔 M.spaces 같은 참조는 그대로). 떠나는 회사의 배열은 SETS에 되돌려 둔다 — 세션 중에 잡은 예약이 남는다
       DY 대양씨아이에스 — 위의 §17 데이터 전부
       HB (주)한빛산업   — 작은 더미: 회의실 3곳 · 내 예약 3건 · 알림 1건. IoT 기기 없음
     회사 목록 · 조직 · 소속은 accounts.js가 갖는다 */

  function hbSpace(id, name, floor, cap, entry, intro, fav) {
    return {
      id: id, name: name, floor: floor, entry: entry, favorite: !!fav, intro: intro,
      hasIot: false, maintenance: false, openAt: '09:00', closeAt: '19:00', days: '매일',   /* 데모 기준일이 일요일이라 매일 */
      operatingDays: DAYS_OF['매일'],
      policy: { capacity: cap, unit: '기본', maxUsageMin: 120, maxLeadDays: 14, minBefore: 0,
                consecutive: true, daily: '제한 없음', who: '전체 구성원', whoValue: null }
    };
  }
  function hbRsv(id, spaceId, userId, s, e, status, extra) {
    return Object.assign({ id: id, spaceId: spaceId, userId: userId, start: s, end: e, reason: null, headcount: null,
      status: status, checkedInAt: null, checkedOutAt: null }, extra || {});
  }

  var SETS = {
    DY: {
      floors: floors.slice(), groups: groups.slice(), spaces: spaces.slice(), reservations: reservations.slice(),
      notifications: notifications.slice(), controlLog: controlLog.slice(), recentSearches: recentSearches.slice(),
      slotMin: SLOT_MIN,   /* web 설정 › 회의실 기본값 — web 회사의 값 */
      brand: { companyName: '대양씨아이에스', shortName: 'DY 대양', siteName: site.name, logoSrc: branding.logo.src }
    },
    HB: {
      floors: [{ id: 'H2F', label: '2층', short: '2F' }, { id: 'H3F', label: '3층', short: '3F' }],
      groups: [{ id: 'H2F', name: '2층', parent: null }, { id: 'H3F', name: '3층', parent: null }],
      spaces: [
        hbSpace('HB-01', '대회의실', 'H3F', 12, 'QR', '화상장비가 있는 12인 회의실이에요', true),
        hbSpace('HB-02', '소회의실 1', 'H2F', 4, '인증 없음', '4인 소회의실이에요'),
        hbSpace('HB-03', '소회의실 2', 'H2F', 6, '인증 없음', '6인 소회의실이에요')
      ],
      reservations: [
        hbRsv('HR-5101', 'HB-01', 'U-001', at(2026, 9, 6, 16, 0), at(2026, 9, 6, 17, 0), 'APPROVED', { headcount: 6 }),
        hbRsv('HR-5102', 'HB-02', 'U-001', at(2026, 9, 8, 10, 0), at(2026, 9, 8, 11, 0), 'APPROVED', { headcount: 3 }),
        hbRsv('HR-5090', 'HB-03', 'U-001', at(2026, 9, 2, 15, 0), at(2026, 9, 2, 16, 0), 'USED',
              { checkedInAt: at(2026, 9, 2, 15, 0), checkedOutAt: at(2026, 9, 2, 15, 52) }),
        hbRsv('HR-5100', 'HB-01', 'U-101', at(2026, 9, 6, 10, 0), at(2026, 9, 6, 12, 0), 'USED',
              { checkedInAt: at(2026, 9, 6, 10, 1), checkedOutAt: at(2026, 9, 6, 11, 55) })
      ],
      notifications: [
        { id: 'NT-H1', kind: 'confirm', at: at(2026, 9, 5, 18, 20),
          title: '예약이 확정됐어요', body: '대회의실 · 9/6 (일) 16:00\n예약번호 HR-5101',   /* web 설정 › 알림 문안(confirm) */
          reservationId: 'HR-5101', spaceId: 'HB-01', read: true }
      ],
      controlLog: [], recentSearches: ['대회의실', '2층'],
      brand: { companyName: '(주)한빛산업', shortName: '한빛', siteName: '구로 사옥', logoSrc: '' }
    },
    /* 연출용 회사 (주)새움테크 — 회사코드 1111 (73차). 막 들어온 회사라 내 예약 · 즐겨찾기 · 알림이 없다.
       남의 예약 하나로 「사용 중」 줄을 보인다 */
    SW: {
      floors: [{ id: 'S7F', label: '7층', short: '7F' }, { id: 'S8F', label: '8층', short: '8F' }],
      groups: [{ id: 'S7F', name: '7층', parent: null }, { id: 'S8F', name: '8층', parent: null }],
      spaces: [
        hbSpace('SW-01', '라운지 회의실', 'S7F', 8, '인증 없음', '창가 쪽 8인 회의실이에요'),
        hbSpace('SW-02', '집중실', 'S7F', 2, '인증 없음', '둘이 쓰는 작은 방이에요'),
        hbSpace('SW-03', '큰 회의실', 'S8F', 14, 'QR', '모니터 두 대가 있는 14인 회의실이에요')
      ],
      reservations: [
        hbRsv('SR-7001', 'SW-03', 'U-201', at(2026, 9, 6, 13, 0), at(2026, 9, 6, 15, 0), 'CHECKED_IN',
              { checkedInAt: at(2026, 9, 6, 13, 2), headcount: 9 })
      ],
      notifications: [], controlLog: [], recentSearches: [],
      brand: { companyName: '(주)새움테크', shortName: '새움', siteName: '성수 사옥', logoSrc: '' }
    }
  };
  /* 한빛산업의 남 — 이름 찾기용 */
  users.push({ id: 'U-101', name: '정하늘', dept: '영업팀', title: '과장', empNo: null, isMe: false });
  users.push({ id: 'U-201', name: '서지우', dept: '플랫폼팀', title: '책임', empNo: null, isMe: false });   /* 새움테크의 남 (73차) */

  var curCo = 'DY';
  function fill(arr, src) { arr.length = 0; Array.prototype.push.apply(arr, src); }
  /** 회사 데이터 갈아 끼우기 — key는 accounts.js 회사의 key('DY' · 'HB') */
  function useCompany(key) {
    if (!SETS[key] || key === curCo) return curCo;
    var out = SETS[curCo];
    out.floors = floors.slice(); out.groups = groups.slice(); out.spaces = spaces.slice();
    out.reservations = reservations.slice(); out.notifications = notifications.slice(); out.controlLog = controlLog.slice();
    out.recentSearches = recentSearches.slice();
    var s = SETS[key];
    fill(floors, s.floors); fill(groups, s.groups); fill(spaces, s.spaces);
    fill(reservations, s.reservations); fill(notifications, s.notifications); fill(controlLog, s.controlLog);
    fill(recentSearches, s.recentSearches);
    coSlot = s.slotMin || 60;   /* 앱에만 있는 데모 회사는 처음 값 1시간 (74차) */
    MOCK.SLOT_MIN = coSlot;
    branding.companyName = s.brand.companyName; branding.shortName = s.brand.shortName;
    branding.siteName = s.brand.siteName; branding.logo.src = s.brand.logoSrc; branding.logo.alt = s.brand.companyName;
    curCo = key;
    autoEnter();
    return curCo;
  }

  /** 소속이 끝나면 그 회사의 남은 예약(아직 입실 전 · 끝나지 않은 확정 예약)을 취소한다 — 취소한 수 (74차)
      by 'admin'(퇴사 처리) | 'self'(나가기 · 계정 삭제). 제품에서는 서버가 한다 */
  function cancelMine(key, userId, reason, by) {
    var list = key === curCo ? reservations : (SETS[key] ? SETS[key].reservations : []);
    var n = 0;
    list.forEach(function (r) {
      if (r.userId !== userId || r.status !== 'APPROVED' || r.end <= NOW) return;
      r.status = 'CANCELED'; r.canceledAt = NOW; r.canceledBy = by || 'admin'; r.cancelReason = reason; n++;
    });
    return n;
  }

  /* 로그인한 사람 · 고른 회사의 소속으로 「나」를 채운다 — 이름 · 휴대폰 · 부서(경로) · 직급 · 사번.
     직급 서열(RANKS)도 그 회사 것으로 바꾼다(「지정 직급 이상」 판정) */
  function setMe(p) {
    /* 다른 사람으로 바뀌면 지금까지의 「나」는 「남」이 된다 — 기록 · 예약의 이름이 비지 않게 한 줄 남긴다 */
    if (p.id !== undefined && p.id !== me.id && me.name && !users.some(function (u) { return u !== me && u.id === me.id; })) {
      users.push({ id: me.id, name: me.name, dept: me.dept, title: me.title, isMe: false });
    }
    ['id', 'name', 'phone', 'provider', 'empNo', 'dept', 'deptPath', 'title'].forEach(function (k) {
      if (p[k] !== undefined) me[k] = p[k];
    });
    if (p.ranks && p.ranks.length) fill(RANKS, p.ranks);
  }


  /* ── 노출 ────────────────────────────────────────────────── */

  var MOCK = {
    NOW: NOW,
    SLOT_MIN: SLOT_MIN,
    EXTEND_MIN: EXTEND_MIN,
    DOW: DOW,
    ACTIVE_STATUSES: ACTIVE,

    /** true로 두면 화면이 §17이 적은 날짜 문자열(specLabel)을 그대로 쓴다 */
    useSpecLabels: false,

    company: company,
    site: site,
    floors: floors,
    groups: groups,                  /* 공간 그룹 트리 (69차) */

    users: users,
    me: me,

    spaces: spaces,
    reservations: reservations,
    devices: devices,
    floorStatus: floorStatus,
    reasonPresets: reasonPresets,

    QR_OPEN_MIN: QR_OPEN_MIN,
    QR_TTL_SEC: QR_TTL_SEC,
    signage: signage,
    branding: branding,
    recentSearches: recentSearches,
    controlLog: controlLog,
    notifications: notifications,
    notifySettings: notifySettings,   /* 알림 설정 (70차) */

    statusText: statusText,
    availabilityText: availabilityText,

    fn: {
      // 조회
      getUser: getUser, userName: userName,
      floorLabel: floorLabel,
      groupChildren: groupChildren, groupPath: groupPath, groupOrder: groupOrder,   /* 공간 그룹 트리 (69차) */
      getSpace: getSpace, spaceName: spaceName,
      isFreeSpace: isFreeSpace, isReaderSpace: isReaderSpace, anyQrSpace: anyQrSpace, autoEnter: autoEnter,   /* 입실 방식 (2026-09-22) */
      spaceMeta: spaceMeta,
      getReservation: getReservation, getDevices: getDevices,
      reservationsOf: reservationsOf, isActive: isActive, isOccupying: isOccupying,

      // 파생 (요청한 2종 + 정책 파생)
      getAvailableSlots: getAvailableSlots,
      getSpaceStatus: getSpaceStatus,
      isDateSelectable: isDateSelectable,
      slotMinOf: slotMinOf,                               /* 회의실별 예약 단위 (57차) */
      getMaxSlots: getMaxSlots,
      maxUsageMessage: maxUsageMessage,
      extendCheck: extendCheck, extendReservation: extendReservation,   /* 30분 연장 (57차) */
      capacityMessage: capacityMessage,
      whoCheck: whoCheck, bookCheck: bookCheck,             /* web 예약 규칙 판정 (66차) */
      useCompany: useCompany, setMe: setMe, companyKey: function () { return curCo; },   /* 회사 전환 · 나 (72차) */
      myNotifications: myNotifications, cancelMine: cancelMine,
      readNotify: readNotify, savePush: savePush,   /* 알림 — web 정책 + 이 폰 설정 (70차) */
      runAutomation: runAutomation, DOOR_RELOCK_MS: DOOR_RELOCK_MS,   /* 입실 · 퇴실 자동화 · 도어 모델 (66차) */
      myReservations: myReservations,
      currentReservation: currentReservation,
      remainingMin: remainingMin,
      getFloorStatus: getFloorStatus,

      // 입실 QR (§12) — 예약이 발급하는 1회용 코드
      canIssueCheckinCode: canIssueCheckinCode,
      issueCheckinCode: issueCheckinCode,
      getCheckinCode: getCheckinCode,
      consumeCheckinCode: consumeCheckinCode,
      checkinTarget: checkinTarget,

      searchSpaces: searchSpaces,
      addLog: addLog,
      groupedLog: groupedLog,
      getSignage: getSignage,
      brandLogoHtml: brandLogoHtml,

      // 포맷
      at: at, hm: hm, ymd: ymd, dateLabel: dateLabel, rangeLabel: rangeLabel,
      durationLabel: durationLabel, addMin: addMin, diffMin: diffMin,
      diffDays: diffDays, sameDay: sameDay, startOfDay: startOfDay, toDate: toDate
    }
  };

  global.MOCK = MOCK;

})(window);
