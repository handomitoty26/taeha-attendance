// 자습실 출석부의 교시별 미확인 학생 표시 — 서현관·태하관 공용 모듈(두 저장소에서 바이트까지 같게 유지, 고치면 ?v를 올리고 두 앱을 함께 바꾼다)
/* 체크 모드를 켜면 좌석 누름이 그 교시 미확인 표시를 켜고 끈다. 출결 상태·통계·내보내기는 건드리지 않는다.
   저장은 앱이 정한 localStorage 키 하나에 { "YYYYMMDD": { p1: { 학번: 1 }, p2: {...}, p3: {...} } } — 날짜 기록(smartAttendanceHistory*)과 따로.
   날짜는 모듈이 만들지 않고 늘 앱이 준다. 이 파일을 못 불러오거나 오류가 나도 앱은 원래대로 동작해야 한다(앱의 연결 코드는 전부 try로 감싼다). */
(function (root) {
  "use strict";

  var PERIODS = ["p1", "p2", "p3"];
  var KEEP_DAYS = 14; // 날짜 칸은 최근 것만 남긴다

  // ---------- 저장 형식 다루기(순수 함수, 시험 대상) ----------
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  // 깨진 값이면 ok:false — 그 키에는 쓰지 않는다(덮어써서 지우지 않게)
  function parseAll(raw) {
    if (raw == null || raw === "") return { ok: true, all: {} };
    try {
      var o = JSON.parse(raw);
      return isObj(o) ? { ok: true, all: o } : { ok: false, all: {} };
    } catch (e) {
      return { ok: false, all: {} };
    }
  }

  function idsOf(all, date, p) {
    var day = isObj(all) ? all[date] : null;
    var set = isObj(day) ? day[p] : null;
    return isObj(set) ? Object.keys(set) : [];
  }

  function has(all, date, p, id) { return idsOf(all, date, p).indexOf(String(id)) !== -1; }

  function setMark(all, date, p, id, on) {
    if (PERIODS.indexOf(p) === -1 || !/^\d{8}$/.test(String(date))) return all;
    if (!isObj(all[date])) all[date] = {};
    if (!isObj(all[date][p])) all[date][p] = {};
    if (on) all[date][p][String(id)] = 1;
    else delete all[date][p][String(id)];
    if (!Object.keys(all[date][p]).length) delete all[date][p];
    if (!Object.keys(all[date]).length) delete all[date];
    return all;
  }

  function toggle(all, date, p, id) { return setMark(all, date, p, id, !has(all, date, p, id)); }

  function clearDay(all, date) { if (isObj(all)) delete all[date]; return all; }

  // 날짜 칸(YYYYMMDD)은 최근 keep개만 남긴다. 형식이 아닌 칸은 그대로 둔다.
  function prune(all, keep) {
    var dates = Object.keys(all).filter(function (k) { return /^\d{8}$/.test(k); }).sort();
    dates.slice(0, Math.max(0, dates.length - (keep || KEEP_DAYS))).forEach(function (k) { delete all[k]; });
    return all;
  }

  // 쓸 때마다 저장소를 다시 읽고 그 키만 바꿔 쓴다. 읽은 값이 깨졌으면 아무것도 쓰지 않고 false.
  function update(key, fn) {
    var r;
    try { r = parseAll(root.localStorage.getItem(key)); } catch (e) { return false; }
    if (!r.ok) return false;
    fn(r.all);
    try { root.localStorage.setItem(key, JSON.stringify(prune(r.all, KEEP_DAYS))); return true; } catch (e) { return false; }
  }
  function read(key) {
    try { return parseAll(root.localStorage.getItem(key)).all; } catch (e) { return {}; }
  }
  // 09시 자동 비움용 — 앱의 연결 코드가 자습실 키마다 그 블록의 날짜(YYYYMMDD)로 부른다
  function clearDayInStorage(key, date) {
    if (!read(key)[date]) return false;
    return update(key, function (all) { clearDay(all, date); });
  }

  // ---------- 화면 ----------
  var STYLE =
    ".seat-box[data-um='1']{outline:3px dashed #d97706;outline-offset:-4px}" +
    ".seat-box[data-um='1']::after{content:'?';position:absolute;top:2px;right:3px;width:16px;height:16px;border-radius:50%;" +
    "background:#d97706;color:#fff;font:900 11px/16px sans-serif;text-align:center;pointer-events:none}" +
    ".um-mode-btn{background:var(--surface,#fff);color:var(--text,#111);border:1.5px solid #d97706}" +
    ".um-mode-btn.um-on{background:#d97706;color:#fff;border-color:#d97706}" +
    // 좁은 세로 화면(태블릿 화면 크기를 키운 경우 등)에서는 글자를 숨기고 ❓만 — 켜짐은 단추 색으로 보인다
    "@media (max-width:699px){.um-mode-btn .um-label{display:none}.um-mode-btn{padding-left:8px;padding-right:8px}}";

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* host(앱이 넘김):
     storageKey() — 지금 자습실의 저장 키, date() — 지금 보는 날짜(YYYYMMDD), period() — 'p1'|'p2'|'p3',
     students() — { 학번: { element } }, active() — 배치도가 있고 백업 복원 모드가 아니고 오늘 근무일 화면이면 true,
     buttonBefore — 모드 단추를 넣을 자리(이 요소 앞). 미확인은 좌석 칸에만 표시한다(좌석판 밖 목록·숫자 없음, 사용자 결정). */
  function create(host) {
    var on = false;
    if (!document.getElementById("um-style")) {
      var st = el("style"); st.id = "um-style"; st.textContent = STYLE;
      document.head.appendChild(st);
    }
    var btn = el("button", "action-btn um-mode-btn", "❓ 미확인");
    btn.type = "button";
    btn.title = "켜면 좌석을 누를 때 그 교시 미확인 표시를 켜고 끕니다";
    btn.style.display = "none";
    btn.addEventListener("click", function () { on = !on; refresh(); });
    host.buttonBefore.parentNode.insertBefore(btn, host.buttonBefore);

    function render() {
      var active = !!host.active();
      if (!active) on = false;
      var all = read(host.storageKey());
      var date = host.date(), p = host.period(), students = host.students() || {};
      btn.style.display = active ? "" : "none";
      btn.classList.toggle("um-on", on);
      btn.textContent = "";
      btn.appendChild(el("span", "", "❓"));
      btn.appendChild(el("span", "um-label", on ? " 체크 중 (끄기)" : " 미확인"));
      btn.setAttribute("aria-label", on ? "미확인 체크 끄기" : "미확인 체크 켜기");

      // 좌석 표시 — 앱이 className을 통째로 바꾸므로 data 속성으로 둔다. 지금 교시·지금 배치도에 있는 학번만.
      var marked = active ? idsOf(all, date, p).filter(function (id) { return students[id]; }) : [];
      Object.keys(students).forEach(function (id) {
        var s = students[id];
        if (!s || !s.element) return;
        if (marked.indexOf(id) !== -1) s.element.setAttribute("data-um", "1");
        else s.element.removeAttribute("data-um");
      });
    }

    function refresh() { render(); }

    return {
      // 좌석 누름 — 체크 모드이고 동작하는 화면이면 표시를 바꾸고 true(앱은 상세 창을 열지 않는다)
      onSeatTap: function (id) {
        if (!on) return false;
        if (!host.active()) { render(); return false; }
        var d = host.date(), p = host.period();
        // 저장이 안 되면(깨진 값·저장 공간 부족) 체크 모드를 끄고 false — 앱이 바로 상세 창을 연다
        if (!update(host.storageKey(), function (a) { toggle(a, d, p, id); })) { on = false; render(); return false; }
        render();
        return true;
      },
      // 상세 창에서 상태를 저장해 바뀐 교시들 — 그 학생의 그 교시 미확인을 지운다
      resolve: function (id, periods) {
        if (host.active() && periods && periods.length) {
          var d = host.date(), key = host.storageKey();
          if (periods.some(function (p) { return has(read(key), d, p, id); })) {
            update(key, function (a) { periods.forEach(function (p) { setMark(a, d, p, id, false); }); });
          }
        }
        render();
      },
      refresh: refresh,
      isOn: function () { return on; }
    };
  }

  root.UncheckedMark = {
    create: create,
    clearDayInStorage: clearDayInStorage,
    _pure: { parseAll: parseAll, idsOf: idsOf, has: has, setMark: setMark, toggle: toggle, clearDay: clearDay, prune: prune, update: update, KEEP_DAYS: KEEP_DAYS }
  };
})(typeof window !== "undefined" ? window : globalThis);
