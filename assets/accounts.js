/* ============================================================
   accounts.js — 플랫폼 계정 저장소 (앱 ↔ 관리자 웹 공유)
   SIOT 신설 「회의실 예약 솔루션」의 전용 사용자 앱.
   ------------------------------------------------------------
   2026-09-30 72차 — 앱은 플랫폼이다 (개발자 미팅 피드백 · 68차 결정)
     · 한 사람 = 앱 계정 하나. 간편 로그인(카카오 · 네이버 · Apple · Google) 또는 휴대폰 번호 가입(이름 · 휴대폰 번호 · 비밀번호)
       이메일 없음 · 문자 인증은 이번에 없음(추후) · 간편 로그인 계정은 비밀번호가 없다
     · 회사마다 소속 하나. 회사코드를 넣고 사번 · 부서 · 직급을 고르면 그 회사 관리자 web(회원)이 승인한다
     · 앱 사용자에게 권한 구분은 없다(67차). 관리자 web은 SIOT 계정으로 로그인한다
   예전 규약 spacekey.accounts.v1(이메일 · 임시 비밀번호)은 쓰지 않는다.

   앱(회의실예약 APP/app.html)과 관리자 웹(회의실예약 web/…)이 같은 origin(localhost:8105)에서 열리므로
   localStorage를 함께 쓴다. ⚠ 프로토타입 저장소다 — 실제 제품에서는 서버가 갖고, 비밀번호는 해시로만 보관한다.

   저장 규약 — 이 주석이 정본이다. 관리자 웹(A-05 회원 · A-08 설정 · A-02 회의실 상세)도 같은 모양을 읽고 쓴다.
     spacekey.users.v1    { v:1, list:[ User ] }       앱이 쓴다
       User    id "U-…" · name · phone "010-1234-5678" · password(간편 로그인은 null)
               provider 'phone' | 'kakao' | 'naver' | 'apple' | 'google' · createdAt ISO
     spacekey.members.v1  { v:1, list:[ Member ] }     앱이 신청하고 web 회원이 승인 · 반려 · 퇴사 처리한다
       Member  id "M-…" · userId · companyCode · empNo 사번 · deptId · rankId
               status 'PENDING' 승인 대기 | 'ACTIVE' 정상 | 'REJECTED' 반려 | 'RETIRED' 퇴사
               appliedAt ISO · decidedAt ISO|null · rejectReason(반려는 사유 필수)
     spacekey.org.v1      { v:1, depts:[{ id, name, parent, order }], ranks:[{ id, name, order }] }   web 설정(A-08)이 쓴다
               부서는 무한 단계 트리(parent = 상위 id | null) · 직급은 서열(order 0 = 가장 낮음)
     spacekey.company.v1  { v:1, code }                web 설정(A-08)이 쓴다 — 그 web 회사의 회사코드
     spacekey.session.v1  { v:1, userId|null, co }     앱 전용(이 폰) — 로그인한 계정 · 고른 회사코드
     spacekey.inbox.v1    { v:1, read:{ id:true } }    앱 전용(이 폰) — 가입 결과 알림을 읽었는지 (74차)
   74차 더한 것
     Member  retiredBy 'admin'(관리자 퇴사 처리) | 'self'(본인이 나감 · 계정 삭제) · retireReason 「본인 요청」|「계정 삭제」
             canceledRsv 끝날 때 취소된 남은 예약 수(프로토타입은 앱이 채운다 · 제품은 서버)
     User    계정 삭제 = { id, deleted:true, deletedAt } — 이름 · 휴대폰 번호를 지운 흔적만 남긴다(같은 번호로 다시 가입할 수 있다)
     설정은 회사마다 — 알림 정책 · 회의실 기본값은 그 회사 관리자 web의 값이다. 프로토타입의 web 설정은 web 회사(대양씨아이에스)에만 쓴다

   프로토타입 약속
     · 관리자 web은 회사 하나(대양씨아이에스 = spacekey.company.v1의 코드)다. 두 번째 회사 (주)한빛산업(HANBIT-01)은
       앱에만 있는 데모 회사라 조직 · 데이터를 여기와 mock.js에 둔다.
     · 연출용 회사 (주)새움테크(회사코드 1111)도 앱에만 있다 — 가입 신청하면 앱이 몇 초 뒤 저절로 승인한다(73차).
     · 데모 계정 김도현(U-001 · 010-1234-5678 · abcd1234)은 두 회사에 이미 소속돼 있다. 저장소에는 쓰지 않는다 —
       관리자 web 회원 목록의 더미 김도현과 겹치지 않게. 비밀번호를 바꾸면 그때 users에 한 줄 생긴다.
     · 제품에서는 소속이 회사 id를 가리킨다. 회사코드는 가입할 때 찾는 열쇠일 뿐이다(관리자가 코드를 바꿔도 소속은 그대로).
   가입 링크 — {origin}/app?join={회사코드} (2026-09-28) · 로그인돼 있으면 회사 추가(S-25)가 코드를 채워 열린다
   ============================================================ */

(function (global) {
  'use strict';

  var UKEY = 'spacekey.users.v1', MKEY = 'spacekey.members.v1', OKEY = 'spacekey.org.v1',
      CKEY = 'spacekey.company.v1', SKEY = 'spacekey.session.v1', IKEY = 'spacekey.inbox.v1';

  function readJSON(k) {
    try { return JSON.parse(global.localStorage.getItem(k) || 'null'); }
    catch (e) { return null; }   /* 사생활 보호 모드 · 저장소 차단에서도 앱은 돌아가야 한다 */
  }
  function writeJSON(k, o) {
    try { global.localStorage.setItem(k, JSON.stringify(o)); return true; } catch (e) { return false; }
  }
  function readList(k) { var o = readJSON(k); return o && Array.isArray(o.list) ? o.list : []; }
  function writeList(k, l) { return writeJSON(k, { v: 1, list: l }); }
  function upsert(k, item) {
    var l = readList(k);
    for (var i = 0; i < l.length; i++) if (l[i].id === item.id) { l[i] = item; writeList(k, l); return item; }
    l.push(item); writeList(k, l); return item;
  }
  function newId(p) { return p + '-' + Date.now().toString(36) + Math.floor(Math.random() * 1e3); }
  function nowIso() { return new Date().toISOString(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /** 휴대폰 번호 — 숫자만 비교하고, 보여 줄 때는 010-1234-5678 */
  function digits(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
  function phoneFmt(s) {
    var d = digits(s).slice(0, 11);
    if (d.length < 4) return d;
    if (d.length < 8) return d.slice(0, 3) + '-' + d.slice(3);
    if (d.length === 10) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);   /* 011-123-4567 */
    return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
  }


  /* ── 회사 ─────────────────────────────────────────────────── */

  var WEB_DEFAULT = 'DYCIS-2026';
  /** 관리자 web 회사의 지금 회사코드 — 설정(A-08)이 저장한 값, 없으면 처음 값 */
  function webCode() {
    var o = readJSON(CKEY);
    return String((o && o.code) || WEB_DEFAULT).trim().toUpperCase();
  }

  /* key는 mock.js 데이터 묶음(useCompany) 이름. code가 null이면 web 회사 — 코드는 web 설정을 따른다 */
  var COMPANIES = [
    { key: 'DY', name: '대양씨아이에스', site: '판교 본사', code: null },
    { key: 'HB', name: '(주)한빛산업', site: '구로 사옥', code: 'HANBIT-01' },
    /* 연출용 — 회사코드 1111. 관리자 web이 없는 데모 회사라 가입 신청하면 몇 초 뒤 저절로 승인된다(앱이 관리자 대신).
       데모 계정 김도현도 소속이 없어 회사 가입 과정을 처음부터 보여 줄 수 있다 (2026-09-30 73차) */
    { key: 'SW', name: '(주)새움테크', site: '성수 사옥', code: '1111', autoApprove: true }
  ];
  function codeOf(c) { return c.code || webCode(); }
  /** 회사코드로 회사 찾기 — 대소문자 · 앞뒤 공백 무시. 없으면 null */
  function company(code) {
    var k = String(code || '').trim().toUpperCase();
    if (!k) return null;
    for (var i = 0; i < COMPANIES.length; i++) {
      var c = COMPANIES[i];
      if (codeOf(c) === k) return { key: c.key, name: c.name, site: c.site, code: codeOf(c), autoApprove: !!c.autoApprove };
    }
    return null;
  }


  /* ── 조직 — 부서 트리 · 직급 서열 ─────────────────────────── */

  /* web 설정 › 부서 · 직급의 처음 값과 같다 (A-08 SEED) */
  var SEED_ORG = {
    depts: [
      { id: 'D-1', name: '경영지원본부', parent: null, order: 0 },
      { id: 'D-11', name: '경영지원팀', parent: 'D-1', order: 0 },
      { id: 'D-12', name: '인사팀', parent: 'D-1', order: 1 },
      { id: 'D-13', name: '재무팀', parent: 'D-1', order: 2 },
      { id: 'D-2', name: '리스크관리본부', parent: null, order: 1 },
      { id: 'D-21', name: '리스크관리팀', parent: 'D-2', order: 0 },
      { id: 'D-22', name: '소비자보호팀', parent: 'D-2', order: 1 },
      { id: 'D-3', name: '디지털본부', parent: null, order: 2 },
      { id: 'D-31', name: 'IT기획팀', parent: 'D-3', order: 0 },
      { id: 'D-32', name: '디지털솔루션팀', parent: 'D-3', order: 1 },
      { id: 'D-33', name: '상품개발팀', parent: 'D-3', order: 2 },
      { id: 'D-4', name: '영업본부', parent: null, order: 3 },
      { id: 'D-41', name: '영업1팀', parent: 'D-4', order: 0 },
      { id: 'D-42', name: '영업2팀', parent: 'D-4', order: 1 }
    ],
    ranks: [
      { id: 'R-1', name: '사원', order: 0 }, { id: 'R-2', name: '대리', order: 1 }, { id: 'R-3', name: '과장', order: 2 },
      { id: 'R-4', name: '차장', order: 3 }, { id: 'R-5', name: '부장', order: 4 }, { id: 'R-6', name: '이사', order: 5 }
    ]
  };
  /* 데모 회사 (주)한빛산업 — 관리자 web이 없으므로 여기 둔다 */
  var HB_ORG = {
    depts: [
      { id: 'HD-1', name: '경영지원팀', parent: null, order: 0 },
      { id: 'HD-2', name: '생산본부', parent: null, order: 1 },
      { id: 'HD-21', name: '생산관리팀', parent: 'HD-2', order: 0 },
      { id: 'HD-22', name: '품질보증팀', parent: 'HD-2', order: 1 },
      { id: 'HD-3', name: '영업팀', parent: null, order: 2 }
    ],
    ranks: [
      { id: 'HR-1', name: '사원', order: 0 }, { id: 'HR-2', name: '주임', order: 1 }, { id: 'HR-3', name: '대리', order: 2 },
      { id: 'HR-4', name: '과장', order: 3 }, { id: 'HR-5', name: '팀장', order: 4 }
    ]
  };

  /* 연출용 회사 (주)새움테크(1111) */
  var SW_ORG = {
    depts: [
      { id: 'SD-1', name: '경영지원팀', parent: null, order: 0 },
      { id: 'SD-2', name: '개발본부', parent: null, order: 1 },
      { id: 'SD-21', name: '플랫폼팀', parent: 'SD-2', order: 0 },
      { id: 'SD-22', name: '서비스팀', parent: 'SD-2', order: 1 },
      { id: 'SD-3', name: '디자인팀', parent: null, order: 2 }
    ],
    ranks: [
      { id: 'SR-1', name: '사원', order: 0 }, { id: 'SR-2', name: '선임', order: 1 },
      { id: 'SR-3', name: '책임', order: 2 }, { id: 'SR-4', name: '수석', order: 3 }
    ]
  };

  /** 그 회사의 조직 — web 회사는 설정(A-08)이 저장한 값, 없거나 깨졌으면 처음 값 */
  function org(code) {
    var c = company(code);
    if (!c) return { depts: [], ranks: [] };
    if (c.key === 'HB') return HB_ORG;
    if (c.key === 'SW') return SW_ORG;
    var o = readJSON(OKEY) || {};
    return {
      depts: Array.isArray(o.depts) && o.depts.length ? o.depts : SEED_ORG.depts,
      ranks: Array.isArray(o.ranks) && o.ranks.length ? o.ranks : SEED_ORG.ranks
    };
  }

  /** 부서 트리를 위에서 아래로 편 목록 — { id, name, depth, path:[뿌리 … 자기 이름] }
      상위가 지워진 부서는 맨 위로 올린다(web과 같다) */
  function deptList(o) {
    var byId = {}, out = [], seen = {};
    o.depts.forEach(function (d) { byId[d.id] = d; });
    function parentOf(d) { return d.parent && byId[d.parent] ? d.parent : null; }
    function walk(pid, depth, path) {
      o.depts.filter(function (d) { return parentOf(d) === pid && !seen[d.id]; })
        .sort(function (a, b) { return (a.order || 0) - (b.order || 0); })
        .forEach(function (d) {
          seen[d.id] = true;
          var p = path.concat([d.name]);
          out.push({ id: d.id, name: d.name, depth: depth, path: p });
          walk(d.id, depth + 1, p);
        });
    }
    walk(null, 0, []);
    return out;
  }
  function deptPath(o, id) {
    var l = deptList(o);
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i].path;
    return [];
  }
  function rankList(o) { return o.ranks.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }); }
  function rankName(o, id) {
    for (var i = 0; i < o.ranks.length; i++) if (o.ranks[i].id === id) return o.ranks[i].name;
    return '';
  }


  /* ── 앱 계정 ──────────────────────────────────────────────── */

  var DEMO_ID = 'U-001';
  var DEMO_USER = { id: DEMO_ID, name: '김도현', phone: '010-1234-5678', password: 'abcd1234',
                    provider: 'phone', createdAt: '2026-03-02T09:00:00+09:00' };

  /** 저장된 계정 + 데모 계정(저장된 게 없을 때만). 삭제한 계정은 빠진다 (74차) */
  function users() {
    var l = readList(UKEY);
    var has = l.some(function (u) { return u.id === DEMO_ID; });
    var live = l.filter(function (u) { return !u.deleted; });
    return has ? live : [clone(DEMO_USER)].concat(live);
  }
  function userById(id) {
    var l = users();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  /** 휴대폰 번호로 계정 찾기 — 한 번호에 계정 하나 */
  function userByPhone(phone) {
    var k = digits(phone);
    if (!k) return null;
    var l = users();
    for (var i = 0; i < l.length; i++) if (digits(l[i].phone) === k) return l[i];
    return null;
  }
  /** 그 간편 로그인으로 가장 최근에 가입한 계정 — 프로토타입은 이것으로 「돌아온 사람」을 알아본다 */
  function lastUserOf(provider) {
    var l = users().filter(function (u) { return u.provider === provider; });
    return l.length ? l[l.length - 1] : null;
  }
  function createUser(d) {
    return upsert(UKEY, {
      id: newId('U'), name: String(d.name).trim(), phone: phoneFmt(d.phone),
      password: d.provider === 'phone' ? d.password : null,
      provider: d.provider || 'phone', createdAt: nowIso()
    });
  }
  function saveUser(u) { return upsert(UKEY, clone(u)); }


  /* ── 소속 ─────────────────────────────────────────────────── */

  function demoMembers() {
    return [
      { id: 'M-001', userId: DEMO_ID, companyCode: webCode(), empNo: '00142857', deptId: 'D-33', rankId: 'R-3',
        status: 'ACTIVE', appliedAt: '2026-03-02T09:10:00+09:00', decidedAt: '2026-03-02T10:02:00+09:00', rejectReason: '', demo: true },
      { id: 'M-002', userId: DEMO_ID, companyCode: 'HANBIT-01', empNo: 'HB-24117', deptId: 'HD-21', rankId: 'HR-3',
        status: 'ACTIVE', appliedAt: '2026-05-12T13:40:00+09:00', decidedAt: '2026-05-12T15:21:00+09:00', rejectReason: '', demo: true }
    ];
  }
  /** 그 사람의 소속 — 신청한 순서 */
  function membersOf(userId) {
    var l = readList(MKEY).filter(function (m) { return m.userId === userId; });
    if (userId === DEMO_ID) {
      demoMembers().reverse().forEach(function (d) {
        if (!l.some(function (m) { return m.id === d.id || String(m.companyCode).toUpperCase() === d.companyCode; })) l.unshift(d);
      });
    }
    return l;
  }
  /** 회사 가입 신청 — 승인 대기로 들어간다. 반려 · 퇴사된 소속이 있으면 그 줄을 다시 신청으로 바꾼다 */
  function applyMember(d) {
    var code = String(d.companyCode).trim().toUpperCase(), ex = null;
    readList(MKEY).forEach(function (m) { if (m.userId === d.userId && String(m.companyCode).toUpperCase() === code) ex = m; });
    return upsert(MKEY, {
      id: ex ? ex.id : newId('M'), userId: d.userId, companyCode: code,
      empNo: String(d.empNo || '').trim(), deptId: d.deptId, rankId: d.rankId,
      status: 'PENDING', appliedAt: nowIso(), decidedAt: null, rejectReason: ''
    });
  }


  /** 소속 결정 — 연출용 회사의 자동 승인이 쓴다(관리자 web은 A-05가 직접 쓴다). 아직 승인 대기일 때만 */
  function decideMember(id, status, reason) {
    var l = readList(MKEY);
    for (var i = 0; i < l.length; i++) {
      if (l[i].id !== id || l[i].status !== 'PENDING') continue;
      l[i].status = status; l[i].decidedAt = nowIso(); l[i].rejectReason = reason || '';
      writeList(MKEY, l);
      return l[i];
    }
    return null;
  }
  /** 연출 다시 하기 — 그 회사코드의 저장된 소속을 모두 지운다 */
  function removeMembersOf(code) {
    var k = String(code || '').trim().toUpperCase();
    writeList(MKEY, readList(MKEY).filter(function (m) { return String(m.companyCode).toUpperCase() !== k; }));
  }


  /** 소속 한 건 고치기 — 데모 소속(M-001 · M-002)이면 저장소에 한 줄 생기고, 그다음부터 저장된 쪽이 이긴다 (74차) */
  function patchMember(id, patch) {
    var l = readList(MKEY), m = null, i;
    for (i = 0; i < l.length; i++) if (l[i].id === id) m = l[i];
    if (!m) {
      var d = demoMembers().filter(function (x) { return x.id === id; })[0];
      if (!d) return null;
      m = clone(d); delete m.demo; l.push(m);
      if (!readList(UKEY).some(function (u) { return u.id === DEMO_ID; })) upsert(UKEY, clone(DEMO_USER));   /* web 회원 목록에 이름이 보이게 */
    }
    for (var k in patch) if (patch.hasOwnProperty(k)) m[k] = patch[k];
    writeList(MKEY, l);
    return m;
  }
  /** 이 회사에서 나가기 — 본인 요청 퇴사 (74차) */
  function leaveMember(id) {
    return patchMember(id, { status: 'RETIRED', decidedAt: nowIso(), retiredBy: 'self', retireReason: '본인 요청' });
  }
  /** 승인 대기 신청 취소 — 그 줄을 지운다 (74차) */
  function cancelApply(id) {
    writeList(MKEY, readList(MKEY).filter(function (m) { return !(m.id === id && m.status === 'PENDING'); }));
  }
  /** 계정 삭제 — 승인 대기는 지우고 정상 소속은 끝낸 뒤, 계정은 이름 · 번호를 지운 흔적만 남긴다 (74차) */
  function deleteUser(id) {
    membersOf(id).forEach(function (m) {
      if (m.status === 'PENDING') cancelApply(m.id);
      else if (m.status === 'ACTIVE') patchMember(m.id, { status: 'RETIRED', decidedAt: nowIso(), retiredBy: 'self', retireReason: '계정 삭제' });
    });
    upsert(UKEY, { id: id, deleted: true, deletedAt: nowIso() });
  }

  /* ── 알림함 읽음 (이 폰) — 가입 결과 알림 (74차) ── */
  function inboxRead() { var o = readJSON(IKEY); return (o && o.read) || {}; }
  function markRead(id) { var r = inboxRead(); r[id] = true; writeJSON(IKEY, { v: 1, read: r }); }


  /* ── 세션 (이 폰) ─────────────────────────────────────────── */

  /** null = 이 폰에서 처음 연다 → 데모 계정으로 시작한다 · { userId:null } = 로그아웃한 상태 */
  function session() { return readJSON(SKEY); }
  function setSession(s) { writeJSON(SKEY, { v: 1, userId: (s && s.userId) || null, co: (s && s.co) || null }); }

  /** 프로토타입 도구 — 앱 계정 · 소속 · 세션을 처음 상태로 */
  function reset() {
    try { [UKEY, MKEY, SKEY, IKEY].forEach(function (k) { global.localStorage.removeItem(k); }); } catch (e) {}
  }

  global.ACCOUNTS = {
    UKEY: UKEY, MKEY: MKEY, OKEY: OKEY, CKEY: CKEY, SKEY: SKEY, DEMO_ID: DEMO_ID,
    digits: digits, phoneFmt: phoneFmt,
    webCode: webCode, company: company,
    org: org, deptList: deptList, deptPath: deptPath, rankList: rankList, rankName: rankName,
    users: users, userById: userById, userByPhone: userByPhone, lastUserOf: lastUserOf,
    createUser: createUser, saveUser: saveUser,
    membersOf: membersOf, applyMember: applyMember, decideMember: decideMember, removeMembersOf: removeMembersOf,
    patchMember: patchMember, leaveMember: leaveMember, cancelApply: cancelApply, deleteUser: deleteUser,
    inboxRead: inboxRead, markRead: markRead, IKEY: IKEY,
    session: session, setSession: setSession, reset: reset
  };
})(window);
