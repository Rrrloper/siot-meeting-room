/* ============================================================
   storage-migrate.js — 저장 이름 바꾸기 (2026-10-01 · 가제 → SIOT)
   옛 가제 이름(아래 OLD)을 siot.mr.* 로 한 번 옮긴다. 저장소를 읽는 스크립트보다 먼저 실행한다.
     · 앱(app.html · 화면/ · 시연판 mobile/)은 mock.js 바로 앞에서 이 파일을 읽고,
       관리자 web 합본(_build.cjs)은 이 파일 내용을 <head>에 그대로 넣는다.
     · 앱과 web이 같은 주소(origin)에서 같은 저장소를 쓰므로 어느 쪽이 먼저 열려도 전부 옮긴다.
     · 새 이름에 이미 값이 있으면 새 값을 두고 옛 값만 지운다.
   이 파일만 옛 이름을 일부러 담고 있다 — 이름을 일괄로 바꿀 때 이 파일은 건드리지 않는다.
   ============================================================ */
(function () {
  try {
    var OLD = 'spacekey.', NEW = 'siot.mr.', ks = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(OLD) === 0) ks.push(k);
    }
    ks.forEach(function (k) {
      var nk = NEW + k.slice(OLD.length);
      if (localStorage.getItem(nk) === null) localStorage.setItem(nk, localStorage.getItem(k));
      localStorage.removeItem(k);
    });
  } catch (e) { /* 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 그냥 넘어간다 */ }
})();
