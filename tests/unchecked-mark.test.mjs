// 공통 모듈 unchecked-mark.js의 저장 규칙(표시 켜고 끄기·날짜 정리·깨진 값 보호·09시 비움)을 node에서 확인하는 시험
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { REPO, read, fakeStorage, context, run } from "./helpers.mjs";

const SRC = read(join(REPO, "unchecked-mark.js"));
const plain = (v) => JSON.parse(JSON.stringify(v)); // vm 안에서 만든 배열·객체는 원형이 달라 엄격 비교 전에 평범한 값으로

function load(store = fakeStorage()) {
  const ctx = context({ localStorage: store });
  run(SRC, ctx, "unchecked-mark.js");
  return { UM: ctx.UncheckedMark, P: ctx.UncheckedMark._pure, store };
}

test("표시 켜고 끄기 — 교시·날짜별로 따로, 빈 교시·빈 날짜는 지운다, 잘못된 교시·날짜는 무시", () => {
  const { P } = load();
  const all = {};
  P.toggle(all, "20261103", "p1", "3101");
  P.toggle(all, "20261103", "p1", 3102);
  P.toggle(all, "20261103", "p2", "3101");
  assert.deepEqual(plain(P.idsOf(all, "20261103", "p1").sort()), ["3101", "3102"]);
  assert.deepEqual(plain(P.idsOf(all, "20261103", "p2")), ["3101"]);
  assert.deepEqual(plain(P.idsOf(all, "20261103", "p3")), []);
  assert.equal(P.has(all, "20261103", "p1", 3102), true, "숫자 학번도 같은 학번");
  P.toggle(all, "20261103", "p2", "3101");
  assert.equal(all["20261103"].p2, undefined, "빈 교시 칸은 남기지 않는다");
  P.toggle(all, "20261103", "p1", "3101"); P.toggle(all, "20261103", "p1", "3102");
  assert.equal(all["20261103"], undefined, "빈 날짜 칸은 남기지 않는다");
  for (const [d, p] of [["20261103", "p4"], ["2026-11-03", "p1"], ["", "p1"], ["20261103", ""]]) {
    P.toggle(all, d, p, "3101");
  }
  assert.deepEqual(all, {}, "잘못된 교시·날짜 형식은 쓰지 않는다");
});

test("날짜 칸은 최근 14개만 남고, 날짜 형식이 아닌 칸은 건드리지 않는다", () => {
  const { P } = load();
  const all = { note: { keep: 1 } };
  for (let i = 1; i <= 20; i++) all[`202610${String(i).padStart(2, "0")}`] = { p1: { [String(i)]: 1 } };
  P.prune(all, P.KEEP_DAYS);
  const dates = Object.keys(all).filter((k) => /^\d{8}$/.test(k)).sort();
  assert.equal(dates.length, 14);
  assert.equal(dates[0], "20261007");
  assert.equal(dates.at(-1), "20261020");
  assert.deepEqual(all.note, { keep: 1 });
});

test("깨진 저장 값 — 읽으면 빈 것, 쓰기는 하지 않아 원래 값이 그대로 남는다", () => {
  for (const bad of ["{깨짐", "[1,2]", "123", "\"글자\""]) {
    const store = fakeStorage({ studyUnchecked: bad });
    const { P, UM } = load(store);
    assert.equal(P.parseAll(bad).ok, false, bad);
    assert.equal(P.update("studyUnchecked", (a) => P.toggle(a, "20261103", "p1", "3101")), false, bad);
    assert.equal(store.getItem("studyUnchecked"), bad, "덮어쓰지 않는다");
    assert.equal(UM.clearDayInStorage("studyUnchecked", "20261103"), false);
    assert.equal(store.getItem("studyUnchecked"), bad);
  }
  const { P } = load();
  assert.deepEqual(plain(P.parseAll(null)), { ok: true, all: {} });
  assert.deepEqual(plain(P.parseAll("")), { ok: true, all: {} });
});

test("update는 쓸 때마다 다시 읽어 그 키만 바꾸고, 다른 키는 건드리지 않는다", () => {
  const store = fakeStorage({ studyUnchecked_A: JSON.stringify({ "20261103": { p1: { "1": 1 } } }), other: "x" });
  const { P } = load(store);
  // 다른 화면(같은 기기의 다른 탭)이 그 사이에 쓴 값도 살아 있어야 한다
  store.setItem("studyUnchecked_A", JSON.stringify({ "20261103": { p1: { "1": 1, "2": 1 } } }));
  assert.equal(P.update("studyUnchecked_A", (a) => P.toggle(a, "20261103", "p1", "3")), true);
  assert.deepEqual(Object.keys(JSON.parse(store.getItem("studyUnchecked_A"))["20261103"].p1).sort(), ["1", "2", "3"]);
  assert.equal(store.getItem("other"), "x");
  assert.equal(store.getItem("studyUnchecked_B"), null, "다른 자습실 키는 생기지 않는다");
});

test("09시 비움 — 그 날짜만 지우고 다른 날짜·다른 자습실은 그대로, 없으면 쓰지 않는다", () => {
  const init = { "20261102": { p1: { "1": 1 } }, "20261103": { p2: { "2": 1 } } };
  const store = fakeStorage({ studyUnchecked_A: JSON.stringify(init), studyUnchecked_B: JSON.stringify(init) });
  const { UM } = load(store);
  assert.equal(UM.clearDayInStorage("studyUnchecked_A", "20261103"), true);
  assert.deepEqual(JSON.parse(store.getItem("studyUnchecked_A")), { "20261102": { p1: { "1": 1 } } });
  assert.deepEqual(JSON.parse(store.getItem("studyUnchecked_B")), init);
  const before = store.getItem("studyUnchecked_A");
  assert.equal(UM.clearDayInStorage("studyUnchecked_A", "20261103"), false, "이미 없으면 쓰지 않는다");
  assert.equal(store.getItem("studyUnchecked_A"), before);
  assert.equal(UM.clearDayInStorage("studyUnchecked_X", "20261103"), false);
  assert.equal(store.getItem("studyUnchecked_X"), null);
});

// ---------- 화면(아주 작은 가짜 DOM) ----------
class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.style = {}; this.attrs = {}; this.className = ""; this._text = ""; this.parentNode = null; this.listeners = {};
    this.classList = {
      toggle: (c, on) => { const s = new Set(this.className.split(/\s+/).filter(Boolean)); if (on) s.add(c); else s.delete(c); this.className = [...s].join(" "); },
      contains: (c) => this.className.split(/\s+/).includes(c),
    };
  }
  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; }
  insertBefore(c, ref) { c.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; return p.children[p.children.indexOf(this) + 1] || null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  click() { (this.listeners.click || []).forEach((f) => f({})); }
  querySelector(sel) {
    const cls = sel.replace(/^\./, "");
    const walk = (e) => { for (const c of e.children) { if (c.className.split(/\s+/).includes(cls)) return c; const r = walk(c); if (r) return r; } return null; };
    return walk(this);
  }
  all(cls) { const out = []; const walk = (e) => e.children.forEach((c) => { if (c.className.split(/\s+/).includes(cls)) out.push(c); walk(c); }); walk(this); return out; }
}

function screen({ store = fakeStorage(), active = true } = {}) {
  const head = new El("head");
  const document = { head, createElement: (t) => new El(t), getElementById: (id) => head.children.find((c) => c.id === id) || null };
  const ctx = context({ localStorage: store, document });
  run(SRC, ctx, "unchecked-mark.js");
  const header = new El("div"), tabsAnchor = header.appendChild(new El("div"));
  const students = { "3101": { name: "가람", element: new El("div") }, "3102": { name: "나래", element: new El("div") } };
  const state = { active, period: "p1" };
  const um = ctx.UncheckedMark.create({
    storageKey: () => "studyUnchecked", date: () => "20261103", period: () => state.period, students: () => students,
    active: () => state.active, buttonBefore: tabsAnchor,
  });
  um.refresh();
  const btn = header.children[0];
  return { um, btn, header, students, state, store };
}

test("화면 — 모드를 켜고 좌석을 누르면 그 좌석에만 표시(좌석판 밖 목록 없음), 다시 누르면 지움, 모드를 끄면 누름을 앱에 넘긴다", () => {
  const s = screen();
  assert.equal(s.btn.style.display, "", "동작하는 화면이면 단추가 보인다");
  assert.equal(s.header.children.length, 2, "머리줄에는 단추 하나만 더한다");
  assert.equal(s.um.onSeatTap("3101"), false, "모드가 꺼져 있으면 앱이 상세 창을 연다");
  s.btn.click();
  assert.equal(s.um.isOn(), true);
  assert.equal(s.um.onSeatTap("3101"), true);
  assert.equal(s.students["3101"].element.getAttribute("data-um"), "1");
  assert.equal(s.students["3102"].element.getAttribute("data-um"), null);
  assert.equal(s.um.onSeatTap("3101"), true);
  assert.equal(s.students["3101"].element.getAttribute("data-um"), null, "다시 누르면 지워진다");
  assert.deepEqual(JSON.parse(s.store.getItem("studyUnchecked")), {});
  s.um.onSeatTap("3101");
  s.state.period = "p2"; s.um.refresh();
  assert.equal(s.students["3101"].element.getAttribute("data-um"), null, "교시마다 따로");
  s.state.period = "p1"; s.um.refresh();
  assert.equal(s.students["3101"].element.getAttribute("data-um"), "1");
  s.um.resolve("3101", ["p1"]);
  assert.equal(s.students["3101"].element.getAttribute("data-um"), null, "상태 저장 → 해제");
  s.state.period = "p2"; s.um.onSeatTap("3102"); s.um.resolve("3102", ["p1"]);
  assert.ok(JSON.parse(s.store.getItem("studyUnchecked"))["20261103"].p2["3102"], "다른 교시 해제는 그 교시만");
  s.um.resolve("3102", ["p2"]);
  assert.deepEqual(JSON.parse(s.store.getItem("studyUnchecked")), {});
});

test("화면 — 저장이 안 되면 체크 모드를 끄고 누름을 앱(상세 창)에 넘긴다", () => {
  const s = screen({ store: fakeStorage({ studyUnchecked: "{깨짐" }) });
  s.btn.click();
  assert.equal(s.um.onSeatTap("3101"), false);
  assert.equal(s.um.isOn(), false, "모드가 꺼진다");
  assert.equal(s.store.getItem("studyUnchecked"), "{깨짐", "깨진 값은 그대로");
  const full = fakeStorage();
  full.setItem = () => { throw new Error("QuotaExceeded"); };
  const s2 = screen({ store: full });
  s2.btn.click();
  assert.equal(s2.um.onSeatTap("3101"), false, "저장 공간이 없어도");
  assert.equal(s2.um.isOn(), false);
});

test("화면 — 동작하는 화면이 아니면 단추·표시를 숨기고 모드를 끈다", () => {
  const s = screen();
  s.btn.click(); s.um.onSeatTap("3101");
  s.state.active = false;
  s.um.refresh();
  assert.equal(s.btn.style.display, "none");
  assert.equal(s.students["3101"].element.getAttribute("data-um"), null);
  assert.equal(s.um.isOn(), false);
  assert.equal(s.um.onSeatTap("3101"), false);
  s.state.active = true; s.um.refresh();
  assert.equal(s.students["3101"].element.getAttribute("data-um"), "1", "다시 오늘 화면이면 저장된 표시가 보인다");
  assert.equal(s.um.isOn(), false, "모드는 꺼진 채");
});

test("localStorage를 쓸 수 없어도 예외를 내지 않는다", () => {
  const broken = { getItem() { throw new Error("막힘"); }, setItem() { throw new Error("막힘"); } };
  const { P, UM } = load(broken);
  assert.equal(P.update("k", () => {}), false);
  assert.equal(UM.clearDayInStorage("k", "20261103"), false);
});
