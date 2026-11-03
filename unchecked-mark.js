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
    // 좁은 세로 화면(태블릿 화면 크기를 키운 경우 등)에서는 글자를 숨기고 ❓만 — 켜짐은 색과 아래 띠의 안내로 보인다
    "@media (max-width:699px){.um-mode-btn .um-label{display:none}.um-mode-btn{padding-left:8px;padding-right:8px}}" +
    ".um-tab-n{margin-left:4px;padding:0 5px;border-radius:8px;background:#d97706;color:#fff;font-size:10px;font-weight:900}" +
    // 띠는 늘 한 줄(높이 고정) — 미확인이 많으면 이름 칩을 옆으로 밀어 본다. 좌석판이 줄어들지 않게 한다.
    ".um-bar{display:flex;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;align-items:center;gap:6px;margin:0 10px 6px;padding:5px 12px;" +
    "border-radius:var(--radius,10px);border:1.5px dashed #d97706;background:var(--surface,#fff);color:var(--text,#111);font-size:12px;font-weight:800;" +
    "flex-shrink:0;scrollbar-width:none}.um-bar::-webkit-scrollbar{display:none}" +
    ".um-bar .um-title,.um-bar .um-hint{white-space:nowrap;flex-shrink:0}" +
    ".um-bar .um-title{color:#b45309}" +
    ".um-chip{display:inline-flex;flex-shrink:0;align-items:center;border:1px solid #d97706;border-radius:999px;overflow:hidden;background:var(--surface-2,#fff7ed)}" +
    ".um-chip button{border:0;background:transparent;color:var(--text,#111);font:inherit;padding:3px 9px;cursor:pointer;white-space:nowrap}" +
    ".um-chip .um-ok{border-left:1px solid #d97706;color:#15803d;font-weight:900}" +
    ".um-hint{color:var(--text-sub,#555);font-weight:700}";

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* host(앱이 넘김):
     storageKey() — 지금 자습실의 저장 키, date() — 지금 보는 날짜(YYYYMMDD), period() — 'p1'|'p2'|'p3',
     students() — { 학번: { name, element } }, active() — 배치도가 있고 백업 복원 모드가 아니고 오늘 근무일 화면이면 true,
     openDetail(id) — 상세 창, tabs() — 교시 탭 단추 3개, buttonBefore — 모드 단추를 넣을 자리(이 요소 앞),
     barAfter — 미확인 띠를 넣을 자리(이 요소 뒤) */
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

    var bar = el("div", "um-bar");
    bar.style.display = "none";
    host.barAfter.parentNode.insertBefore(bar, host.barAfter.nextSibling);

    function periodLabel(p) { return String(p).slice(1) + "교시"; }

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

      // 좌석 표시 — 앱이 className을 통째로 바꾸므로 data 속성으로 둔다. 배치도에 있는 학번만 센다.
      var marked = active ? idsOf(all, date, p).filter(function (id) { return students[id]; }) : [];
      Object.keys(students).forEach(function (id) {
        var s = students[id];
        if (!s || !s.element) return;
        if (marked.indexOf(id) !== -1) s.element.setAttribute("data-um", "1");
        else s.element.removeAttribute("data-um");
      });

      // 교시 탭의 미확인 수
      var tabs = host.tabs() || [];
      for (var i = 0; i < tabs.length && i < PERIODS.length; i++) {
        var old = tabs[i].querySelector(".um-tab-n");
        if (old) old.parentNode.removeChild(old);
        var n = active ? idsOf(all, date, PERIODS[i]).filter(function (id) { return students[id]; }).length : 0;
        if (n) tabs[i].appendChild(el("span", "um-tab-n", "?" + n));
      }

      // 미확인 띠
      bar.textContent = "";
      if (!active || (!marked.length && !on)) { bar.style.display = "none"; return; }
      bar.style.display = "flex";
      if (!marked.length) {
        bar.appendChild(el("span", "um-hint", "체크 모드 — 확인 안 된 학생의 좌석을 누르세요 (" + periodLabel(p) + ")"));
        return;
      }
      bar.appendChild(el("span", "um-title", "❓ " + periodLabel(p) + " 미확인 " + marked.length + "명"));
      marked.sort().forEach(function (id) {
        var chip = el("span", "um-chip");
        var name = el("button", "", id + " " + (students[id].name || ""));
        name.type = "button";
        name.title = "상세 창 열기";
        name.addEventListener("click", function () { host.openDetail(id); });
        var ok = el("button", "um-ok", "✓");
        ok.type = "button";
        ok.title = "확인 완료";
        ok.setAttribute("aria-label", id + " 확인 완료");
        ok.addEventListener("click", function () {
          if (host.active()) {
            var d = host.date(), pp = host.period();
            update(host.storageKey(), function (a) { setMark(a, d, pp, id, false); });
          }
          render();
        });
        chip.appendChild(name); chip.appendChild(ok);
        bar.appendChild(chip);
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
