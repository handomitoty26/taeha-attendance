// index.html의 백업 지문·자동 백업 순서·미확인 연결 코드를 꺼내 vm에서 확인하는 시험(서현관 저장소가 옆에 있으면 같은 시험을 그쪽에도 돌린다)
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { REPO, SIBLING, read, hasSibling, block, fakeStorage, context, run, inlineScripts } from "./helpers.mjs";
import vm from "node:vm";

const APPS = [{ name: "태하관", dir: REPO, rooms: false }];
if (hasSibling()) APPS.push({ name: "서현관", dir: SIBLING, rooms: true });

function ymd(d) { return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; }

for (const app of APPS) {
  const html = read(join(app.dir, "index.html"));

  test(`${app.name}: 인라인 스크립트가 모두 문법 오류 없이 읽힌다`, () => {
    const scripts = inlineScripts(html);
    assert.ok(scripts.length >= 2);
    scripts.forEach((code, i) => assert.doesNotThrow(() => new vm.Script(code, { filename: `inline-${i}.js` }), `인라인 ${i}`));
  });

  test(`${app.name}: 모듈 주소가 index.html·sw.js에서 같고, 본 스크립트보다 먼저 불린다`, () => {
    const sw = read(join(app.dir, "sw.js"));
    const m = html.match(/<script src="(unchecked-mark\.js\?v=\d+)"><\/script>/);
    assert.ok(m, "모듈 script 태그");
    assert.ok(sw.includes(`'./${m[1]}'`), "서비스 워커 ASSETS에 같은 주소");
    assert.ok(html.indexOf(m[0]) < html.indexOf("[unchecked-link:start]"), "연결 코드보다 앞");
    assert.ok(html.includes("seatTap('${id}')"), "좌석 onclick은 seatTap");
    assert.ok(!html.includes("setAttribute('onclick', `openStudentDetail("), "좌석이 상세 창을 직접 부르지 않는다");
    assert.ok(/'studyUnchecked','studyUnchecked_A','studyUnchecked_B'/.test(html), "백업 키 목록에 미확인 키");
  });

  // ---------- 백업 지문 ----------
  function stampCtx(extra = {}) {
    const store = fakeStorage();
    const ctx = context({ localStorage: store, location: { pathname: "/taeha-attendance/index.html" }, ...extra });
    run(block(html, "backup-stamp"), ctx, "backup-stamp.js");
    return { ctx, store };
  }

  test(`${app.name}: 지문 기록 키는 경로를 정규화한다(index.html·끝 슬래시)`, () => {
    for (const p of ["/taeha-attendance/index.html", "/taeha-attendance/", "/taeha-attendance", "/taeha-attendance/INDEX.HTML"]) {
      const { ctx } = stampCtx({ location: { pathname: p } });
      assert.equal(ctx.driveStampKey(), "studyDriveStamp:/taeha-attendance", p);
    }
    const { ctx } = stampCtx({ location: { pathname: "/" } });
    assert.equal(ctx.driveStampKey(), "studyDriveStamp:/");
  });

  test(`${app.name}: 지문 — 같은 내용이면 같고(키 순서 무관), 드라이브 설정·자동 비움 시각은 빼고, 기록이 바뀌면 달라진다`, async () => {
    const { ctx } = stampCtx();
    const base = { smartAttendanceHistory: '{"20261103":{}}', studyTheme: "dark", studyDriveCfg: '{"a":1}', lastAutoClearTimestamp: "1" };
    const h1 = await ctx.studyBackupHash(base);
    assert.match(h1, /^[0-9a-f]{64}$/);
    assert.equal(await ctx.studyBackupHash({ lastAutoClearTimestamp: "1", studyTheme: "dark", studyDriveCfg: '{"a":1}', smartAttendanceHistory: '{"20261103":{}}' }), h1);
    assert.equal(await ctx.studyBackupHash({ ...base, studyDriveCfg: '{"a":2,"folderId":"x"}', lastAutoClearTimestamp: "999" }), h1);
    assert.notEqual(await ctx.studyBackupHash({ ...base, smartAttendanceHistory: '{"20261103":{"x":1}}' }), h1);
    assert.notEqual(await ctx.studyBackupHash({ ...base, studyUnchecked: "{}" }), h1, "새 키가 생겨도 다름");
  });

  test(`${app.name}: 지문 계산이 안 되면 빈 값(= 바뀐 것으로 보고 올린다)`, async () => {
    for (const extra of [{ crypto: undefined }, { crypto: { subtle: { digest: async () => { throw new Error("x"); } } } }, { TextEncoder: undefined }]) {
      const { ctx } = stampCtx(extra);
      assert.equal(await ctx.studyBackupHash({ a: "1" }), "");
    }
  });

  test(`${app.name}: 건너뛰기 — 지문·클라이언트 ID·폴더가 모두 같고 7일 안일 때만`, () => {
    const { ctx } = stampCtx();
    const now = Date.UTC(2026, 10, 3, 10);
    const st = { hash: "h", clientId: "c", folder: "f_백업", uploadedAt: now - 3600000 };
    assert.equal(ctx.driveCanSkip(st, "h", "c", "f_백업", now), true);
    assert.equal(ctx.driveCanSkip(st, "", "c", "f_백업", now), false, "지문 없음");
    assert.equal(ctx.driveCanSkip(st, "h2", "c", "f_백업", now), false, "내용 바뀜");
    assert.equal(ctx.driveCanSkip(st, "h", "c2", "f_백업", now), false, "클라이언트 ID 바뀜");
    assert.equal(ctx.driveCanSkip(st, "h", "c", "g_백업", now), false, "폴더 바뀜");
    assert.equal(ctx.driveCanSkip({ ...st, uploadedAt: now - 7 * 86400000 }, "h", "c", "f_백업", now), false, "7일 지남");
    assert.equal(ctx.driveCanSkip({ ...st, uploadedAt: now - 7 * 86400000 + 1 }, "h", "c", "f_백업", now), true);
    assert.equal(ctx.driveCanSkip({ ...st, uploadedAt: now + 1000 }, "h", "c", "f_백업", now), false, "시계가 뒤로 감");
    assert.equal(ctx.driveCanSkip({ hash: "h", clientId: "c", folder: "f_백업" }, "h", "c", "f_백업", now), false, "업로드 시각 없음");
    assert.equal(ctx.driveCanSkip({}, "h", "c", "f_백업", now), false);
    assert.equal(ctx.driveCanSkip(null, "h", "c", "f_백업", now), false);
  });

  test(`${app.name}: 지문 기록이 깨져 있으면 빈 기록으로 읽는다`, () => {
    const { ctx, store } = stampCtx();
    for (const bad of ["{깨짐", "[1]", "null"]) {
      store.setItem(ctx.driveStampKey(), bad);
      assert.deepEqual(JSON.parse(JSON.stringify(ctx.driveStamp())), {}, bad);
    }
    ctx.driveStampSave({ hash: "h" });
    assert.equal(JSON.parse(store.getItem(ctx.driveStampKey())).hash, "h");
    ctx.driveStampClear();
    assert.equal(store.getItem(ctx.driveStampKey()), null);
  });

  // ---------- 구글 준비 — 자동이면 조용히 ----------
  test(`${app.name}: 구글 준비 실패 — 자동(false)이면 토스트 없이, 수동이면 토스트`, async () => {
    for (const [cfg, ready] of [[{}, true], [{ clientId: "c" }, false]]) {
      for (const interactive of [false, true, undefined]) {
        const toasts = [];
        const ctx = context({ gd: () => cfg, gisReady: () => ready, ensureGsi: async () => false, backupToast: (m) => toasts.push(m), GDRIVE_SCOPE: "s" });
        run(`var gTokenClient=null, gAccessToken="", gTokenExp=0, gTokenCb=null;\n` + block(html, "init-client"), ctx, "init-client.js");
        assert.equal(await ctx.gInitClient(interactive), false);
        assert.equal(toasts.length, interactive === false ? 0 : 1, `${JSON.stringify(cfg)} ${interactive}`);
      }
    }
  });

  // ---------- 업로드와 지문 기록 ----------
  async function uploadRun({ failAt = null, idAfter = "c", folderAfter = "f_백업", tokenFor = "c" } = {}) {
    const puts = [], stamps = [];
    let builds = 0, gdCalls = 0, folderCalls = 0;
    const live = { smartAttendanceHistory: "v1" };
    const ctx = context({
      gAccessTokenFor: tokenFor,
      gEnsureFolder: async () => "folder1",
      buildStudyBackup: () => { builds++; return { _app: "studyRoomAttendance", store: { ...live } }; },
      studyBackupHash: async (store) => "hash:" + store.smartAttendanceHistory,
      gFindFile: async (name) => { live.smartAttendanceHistory = "v2"; return null; }, // 올리는 도중에 기록이 바뀐다
      gPutFile: async (name, json) => { puts.push([name, JSON.parse(json).store.smartAttendanceHistory]); if (failAt === puts.length) throw new Error("upload 500"); return { id: "x", name }; },
      todayStr: () => "2026-11-03",
      // 첫 호출(시작)은 원래 설정, 그 뒤(끝)는 바뀐 설정일 수 있다
      gd: () => ({ clientId: gdCalls++ === 0 ? "c" : idAfter, keepDays: 30 }),
      gdriveFolder: () => (folderCalls++ === 0 ? "f_백업" : folderAfter),
      driveStampSave: (s) => stamps.push(s),
      gCleanOld: () => {},
    });
    run(block(html, "upload"), ctx, "upload.js");
    let err = null, out = null;
    try { out = await ctx.gUploadBackup(); } catch (e) { err = e; }
    return { puts, stamps, builds, err, out };
  }

  test(`${app.name}: 업로드 — 내용은 한 번만 만들고, 두 파일이 모두 올라간 뒤에만 그 내용의 지문을 남긴다`, async () => {
    let r = await uploadRun();
    assert.equal(r.err, null);
    assert.equal(r.builds, 1, "백업 내용을 한 번만 만든다");
    assert.deepEqual(r.puts, [["최신.json", "v1"], ["2026-11-03.json", "v1"]]);
    assert.equal(r.stamps.length, 1);
    assert.equal(r.stamps[0].hash, "hash:v1", "올리는 도중 바뀐 v2가 아니라 실제로 올린 v1의 지문");
    assert.equal(r.stamps[0].clientId, "c");
    assert.equal(r.stamps[0].folder, "f_백업");
    assert.equal(typeof r.stamps[0].uploadedAt, "number");
    for (const failAt of [1, 2]) {
      r = await uploadRun({ failAt });
      assert.ok(r.err, `${failAt}번째 업로드 실패는 밖으로`);
      assert.equal(r.stamps.length, 0, `${failAt}번째 업로드가 실패하면 지문을 남기지 않는다`);
    }
  });

  test(`${app.name}: 업로드 — 그 사이 클라이언트 ID·폴더가 바뀌었거나 토큰이 다른 ID의 것이면 지문을 남기지 않는다`, async () => {
    for (const [why, opt] of [["ID 바뀜", { idAfter: "c2" }], ["폴더 바뀜", { folderAfter: "g_백업" }], ["다른 ID의 토큰", { tokenFor: "old" }]]) {
      const r = await uploadRun(opt);
      assert.equal(r.err, null, why);
      assert.equal(r.puts.length, 2, why);
      assert.equal(r.stamps.length, 0, why);
    }
  });

  // ---------- 토큰 요청 ----------
  function tokenCtx({ clientId = "c", token = "", tokenFor = "", exp = 0, request } = {}) {
    const timers = [];
    const ctx = context({
      gd: () => ({ clientId }),
      gInitClient: async () => true,
      setTimeout: (fn) => { timers.push(fn); return timers.length; },
      clearTimeout: () => {},
    });
    run(`var gTokenClient={ requestAccessToken: (o) => window.__request(o) }, gAccessToken=${JSON.stringify(token)}, gTokenExp=${exp}, gTokenCb=null, gAccessTokenFor=${JSON.stringify(tokenFor)};\n` + block(html, "token"), ctx, "token.js");
    ctx.__request = request || (() => {});
    return { ctx, timers };
  }

  test(`${app.name}: 토큰 — 받아 둔 토큰은 지금 ID의 것일 때만 다시 쓰고, 응답이 없으면 시간 초과로 실패, 늦은 응답은 무시`, async () => {
    const far = Date.now() + 3600000;
    let asked = 0;
    let t = tokenCtx({ token: "tok", tokenFor: "c", exp: far, request: () => { asked++; } });
    assert.equal(await t.ctx.gGetToken(false), true);
    assert.equal(asked, 0, "같은 ID의 유효한 토큰은 창 없이 다시 쓴다");
    t = tokenCtx({ token: "tok", tokenFor: "old", exp: far, request: () => { asked++; t.ctx.gTokenCb(true); } });
    assert.equal(await t.ctx.gGetToken(false), true);
    assert.equal(asked, 1, "다른 ID의 토큰이면 새로 요청한다");
    t = tokenCtx({ request: () => {} }); // 응답이 끝내 안 온다
    const p = t.ctx.gGetToken(false);
    await new Promise((r) => setImmediate(r));
    assert.equal(t.timers.length, 1, "시간 초과 타이머");
    const cb = t.ctx.gTokenCb;
    t.timers[0]();
    assert.equal(await p, false, "시간 초과면 실패로 끝난다");
    assert.equal(t.ctx.gTokenCb, null);
    assert.doesNotThrow(() => cb(true), "늦게 온 응답은 무시");
    t = tokenCtx({ request: () => { throw new Error("popup"); } });
    assert.equal(await t.ctx.gGetToken(true), false, "요청이 예외면 실패");
  });

  // ---------- 드라이브 작업 줄 ----------
  test(`${app.name}: 드라이브 작업 — 자동·수동이 겹쳐도 차례대로, 자동은 설정이 없어도 조용히`, async () => {
    const log = [];
    let cfg = { clientId: "c" };
    const ctx = context({
      gd: () => cfg,
      gInitClient: async () => true,
      gGetToken: async (loud) => { log.push(`token:${loud}`); await new Promise((r) => setImmediate(r)); return true; },
      gUploadBackup: async () => { log.push("up:start"); await new Promise((r) => setImmediate(r)); log.push("up:end"); return { name: "x.json" }; },
      gEnsureFolder: async () => { log.push("folder"); },
      renderDriveStatus: () => {},
      backupToast: (m) => log.push(`toast:${m}`),
    });
    run(block(html, "drive-ops"), ctx, "drive-ops.js");
    const a = ctx.driveBackupNow(false), b = ctx.driveBackupNow(true), c = ctx.driveConnect();
    await Promise.all([a, b, c]);
    // 한 작업이 끝나야 다음 작업이 시작된다(업로드 시작·끝이 엇갈리지 않음)
    assert.deepEqual(log.filter((x) => !x.startsWith("toast:")), ["token:false", "up:start", "up:end", "token:true", "up:start", "up:end", "token:true", "folder"]);
    assert.deepEqual(log.slice(0, 3), ["token:false", "up:start", "up:end"], "자동 백업은 토스트 없음");
    assert.equal(log[3], "token:true");
    assert.equal(log[6], "toast:드라이브 업로드 완료: x.json");
    log.length = 0;
    cfg = {};
    await ctx.driveBackupNow(false);
    assert.deepEqual(log, [], "자동 — 클라이언트 ID가 없어도 조용히");
    await ctx.driveBackupNow(true);
    assert.deepEqual(log, ["toast:클라이언트 ID를 입력하세요"]);
    // 앞 작업이 실패해도 줄이 막히지 않는다
    log.length = 0; cfg = { clientId: "c" };
    ctx.gUploadBackup = async () => { throw new Error("x"); };
    await ctx.driveBackupNow(false);
    ctx.gUploadBackup = async () => { log.push("again"); return { name: "y" }; };
    await ctx.driveBackupNow(false);
    assert.ok(log.includes("again"));
  });

  test(`${app.name}: 클라이언트 ID를 바꾸면 받아 둔 토큰·지문 기록을 버린다`, () => {
    let saved = null, cleared = 0;
    const ctx = context({
      gd: () => ({ clientId: "old", auto: true }),
      gdSave: (c) => { saved = c; },
      document: { getElementById: () => ({ value: " new-id " }) },
      driveStampClear: () => { cleared++; },
      renderDriveStatus: () => {},
    });
    run(`var gTokenClient={}, gAccessToken="tok", gAccessTokenFor="old", gTokenExp=99;\n` + block(html, "client-id"), ctx, "client-id.js");
    ctx.saveDriveClientId();
    assert.equal(saved.clientId, "new-id");
    assert.equal(run("gTokenClient", ctx), null);
    assert.equal(run("gAccessToken", ctx), "");
    assert.equal(run("gAccessTokenFor", ctx), "");
    assert.equal(run("gTokenExp", ctx), 0);
    assert.equal(cleared, 1);
  });

  // ---------- 자동 백업 순서 ----------
  async function autoRun({ cfg, hash = "h", stamp = {}, gsiOk = true, folder = "f_백업", throwIn } = {}) {
    const calls = [];
    let saved = null;
    const ctx = context({
      gd: () => { if (throwIn === "gd") throw new Error("x"); return cfg; },
      buildStudyBackup: () => ({ store: { a: "1" } }),
      studyBackupHash: async () => { if (throwIn === "hash") throw new Error("x"); return hash; },
      driveStamp: () => ({ ...stamp }),
      driveStampSave: (s) => { saved = s; },
      driveCanSkip: (st, h, c, f, now) => !!h && st.hash === h && st.clientId === c && st.folder === f && now - st.uploadedAt < 7 * 86400000,
      gdriveFolder: () => folder,
      ensureGsi: async () => { calls.push("gsi"); return gsiOk; },
      driveBackupNow: async (i) => { calls.push(["now", i]); },
      setTimeout: () => { throw new Error("타이머를 쓰지 않는다"); },
    });
    run(block(html, "auto-backup"), ctx, "auto-backup.js");
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    return { calls, saved };
  }

  test(`${app.name}: 자동 백업 — 같은 내용이면 구글 모듈을 부르지 않고 건너뜀 시각만 남긴다`, async () => {
    const now = Date.now();
    const { calls, saved } = await autoRun({ cfg: { auto: true, clientId: "c" }, stamp: { hash: "h", clientId: "c", folder: "f_백업", uploadedAt: now - 1000 } });
    assert.deepEqual(calls, []);
    assert.ok(saved && typeof saved.skippedAt === "number" && saved.hash === "h" && saved.uploadedAt === now - 1000);
  });

  test(`${app.name}: 자동 백업 — 바뀌었으면 지연 없이 모듈 로드 성공 뒤에만 조용한 업로드`, async () => {
    let r = await autoRun({ cfg: { auto: true, clientId: "c" }, stamp: { hash: "old", clientId: "c", folder: "f_백업", uploadedAt: Date.now() } });
    assert.deepEqual(r.calls, ["gsi", ["now", false]]);
    assert.equal(r.saved, null, "업로드 전에는 지문을 남기지 않는다");
    r = await autoRun({ cfg: { auto: true, clientId: "c" }, gsiOk: false });
    assert.deepEqual(r.calls, ["gsi"], "모듈 로드 실패면 업로드하지 않는다(토스트 경로로 가지 않음)");
    r = await autoRun({ cfg: { auto: true, clientId: "c" }, hash: "" });
    assert.deepEqual(r.calls, ["gsi", ["now", false]], "지문 계산 실패면 올린다");
  });

  test(`${app.name}: 자동 백업 — 꺼져 있거나 클라이언트 ID가 없으면 아무것도 안 하고, 오류는 밖으로 안 나간다`, async () => {
    for (const cfg of [{}, { auto: true }, { clientId: "c" }, { auto: false, clientId: "c" }]) {
      const r = await autoRun({ cfg });
      assert.deepEqual(r.calls, [], JSON.stringify(cfg));
    }
    for (const throwIn of ["gd", "hash"]) {
      const r = await autoRun({ cfg: { auto: true, clientId: "c" }, throwIn });
      assert.deepEqual(r.calls, [], throwIn);
    }
  });

  // ---------- 미확인 연결 ----------
  function linkCtx({ module = "fake", today = new Date(), room = "A" } = {}) {
    const calls = { open: [], sync: 0, load: 0, refresh: 0, resolve: [], host: null };
    const ctx = context({
      document: { querySelector: () => ({}), querySelectorAll: () => [], getElementById: () => ({}) },
      calls,
    });
    ctx.__tap = () => false;
    ctx.__refreshThrows = false;
    ctx.__resolveThrows = false;
    if (module === "fake") {
      ctx.UncheckedMark = {
        create(host) {
          calls.host = host;
          return {
            onSeatTap: (id) => ctx.__tap(id),
            refresh() { calls.refresh++; if (ctx.__refreshThrows) throw new Error("x"); },
            resolve(id, ps) { calls.resolve.push([id, [...ps]]); if (ctx.__resolveThrows) throw new Error("x"); },
          };
        },
      };
    } else if (module === "throws") {
      ctx.UncheckedMark = { create() { throw new Error("x"); } };
    }
    const stubs = `
      var currentFileDate = '${ymd(today)}', activePeriod = 1, hasLayout = true, studentMap = { '3101': { name: '가람' } }, manualOverrides = {}, activeRoom = '${room}';
      function K(b){ return b + '_' + activeRoom; }
      function openStudentDetail(id){ calls.open.push(id); }
      function syncAttendance(){ calls.sync++; return 'S'; }
      function generateGrid(){ calls.grid = (calls.grid || 0) + 1; return 'G'; }
      function loadRoomFromMemory(){ calls.load++; return 'L'; }
      function applyManualEdit(id){ return window.__apply(id); }
    `;
    run(stubs + "\n" + block(html, "unchecked-link"), ctx, "unchecked-link.js");
    return { ctx, calls };
  }

  test(`${app.name}: 좌석 누름 — 모듈이 없거나·오류·모드 꺼짐이면 늘 상세 창`, () => {
    for (const module of ["none", "throws"]) {
      const { ctx, calls } = linkCtx({ module });
      ctx.seatTap("3101");
      assert.deepEqual(calls.open, ["3101"], module);
    }
    const { ctx, calls } = linkCtx();
    ctx.seatTap("3101");
    ctx.__tap = () => { throw new Error("x"); };
    ctx.seatTap("3102");
    ctx.__tap = () => true;
    ctx.seatTap("3103");
    assert.deepEqual(calls.open, ["3101", "3102"], "모드가 표시를 바꾼 누름만 상세 창을 열지 않는다");
  });

  test(`${app.name}: syncAttendance 감싸개 — 원래 함수 먼저, 반환값 그대로, 그리기 오류는 삼킨다`, () => {
    const { ctx, calls } = linkCtx();
    assert.equal(ctx.syncAttendance(), "S");
    ctx.__refreshThrows = true;
    assert.equal(ctx.syncAttendance(), "S");
    assert.equal(calls.sync, 2);
    assert.equal(calls.refresh, 2);
    ctx.__refreshThrows = false;
    assert.equal(ctx.generateGrid([]), "G", "배치도 다시 그리기도 원래 함수 그대로");
    assert.equal(calls.grid, 1);
    assert.equal(calls.refresh, 3, "빈 배치도 조기 반환 경로도 다시 그린다");
    if (app.rooms) {
      assert.equal(ctx.loadRoomFromMemory(), "L", "자습실 전환도 원래 함수 그대로");
      assert.equal(calls.load, 1);
      assert.equal(calls.refresh, 4, "배치도 없는 자습실로 가도 다시 그린다");
      ctx.__refreshThrows = true;
      assert.equal(ctx.loadRoomFromMemory(), "L");
    }
  });

  test(`${app.name}: 상태 저장 감싸개 — 저장한 교시 + 바뀐 교시만 해제, 해제 오류는 저장을 막지 않는다`, () => {
    const { ctx, calls } = linkCtx();
    ctx.activePeriod = 2;
    run("activePeriod = 2;", ctx);
    ctx.__apply = (id) => { run(`manualOverrides['${id}'] = { p2: { status: '외출', memo: '' } };`, ctx); return "A"; };
    assert.equal(ctx.applyManualEdit("3101"), "A");
    assert.deepEqual(calls.resolve.at(-1), ["3101", ["p2"]]);
    ctx.__apply = (id) => { run(`manualOverrides['${id}'] = { p1: { status: '귀가' }, p2: { status: '귀가' }, p3: { status: '귀가' } };`, ctx); return "B"; };
    assert.equal(ctx.applyManualEdit("3102"), "B");
    assert.deepEqual(calls.resolve.at(-1), ["3102", ["p1", "p2", "p3"]], "1~3교시 일괄 상태");
    ctx.__apply = () => "C"; // 그대로 다시 저장
    ctx.applyManualEdit("3102");
    assert.deepEqual(calls.resolve.at(-1), ["3102", ["p2"]], "바뀐 게 없어도 저장한 교시는 확인으로 본다");
    ctx.__resolveThrows = true;
    ctx.__apply = (id) => { run(`manualOverrides['${id}'] = { p2: { status: '상담' } };`, ctx); return "D"; };
    assert.equal(ctx.applyManualEdit("3103"), "D");
    assert.equal(JSON.parse(JSON.stringify(run("manualOverrides['3103']", ctx))).p2.status, "상담");
  });

  test(`${app.name}: 오늘 근무일 — 오늘, 09시 전의 어제만(달 경계 포함)`, () => {
    const { ctx } = linkCtx();
    const at = (y, m, d, h, mi = 0) => new Date(y, m - 1, d, h, mi);
    assert.equal(ctx.umLiveWorkday("20261103", at(2026, 11, 3, 21)), true);
    assert.equal(ctx.umLiveWorkday("20261102", at(2026, 11, 3, 0, 30)), true, "자정 넘긴 근무");
    assert.equal(ctx.umLiveWorkday("20261102", at(2026, 11, 3, 8, 59)), true);
    assert.equal(ctx.umLiveWorkday("20261102", at(2026, 11, 3, 9, 0)), false);
    assert.equal(ctx.umLiveWorkday("20261101", at(2026, 11, 3, 1)), false);
    assert.equal(ctx.umLiveWorkday("20261031", at(2026, 11, 1, 2)), true, "달 경계");
    assert.equal(ctx.umLiveWorkday("20261231", at(2027, 1, 1, 3)), true, "해 경계");
    assert.equal(ctx.umLiveWorkday("", at(2026, 11, 3, 21)), false);
  });

  test(`${app.name}: 모듈에 넘기는 값 — 저장 키·교시·동작하는 화면`, () => {
    const { ctx, calls } = linkCtx();
    const h = calls.host;
    assert.ok(h, "모듈을 만들었다");
    assert.equal(h.storageKey(), app.rooms ? "studyUnchecked_A" : "studyUnchecked");
    if (app.rooms) { run("activeRoom = 'B';", ctx); assert.equal(h.storageKey(), "studyUnchecked_B"); }
    run("activePeriod = 3;", ctx);
    assert.equal(h.period(), "p3");
    assert.equal(h.active(), true);
    run("window.isBackupMode = true;", ctx);
    assert.equal(h.active(), false, "백업 복원 모드");
    run("window.isBackupMode = false; currentFileDate = '20200101';", ctx);
    assert.equal(h.active(), false, "과거 날짜");
    run(`currentFileDate = '${ymd(new Date())}'; hasLayout = false;`, ctx);
    assert.equal(h.active(), false, "배치도 없음");
    run(`hasLayout = true; studentMap = {};`, ctx);
    assert.equal(h.active(), false, "빈 배치도(좌석 없음)");
  });
}

test("두 앱의 공통 부분이 같다 — 모듈 바이트·지문·자동 백업 구간", { skip: !hasSibling() && "서현관 저장소가 옆에 없음" }, () => {
  const a = read(join(REPO, "index.html")), b = read(join(SIBLING, "index.html"));
  assert.equal(read(join(SIBLING, "unchecked-mark.js")), read(join(REPO, "unchecked-mark.js")), "unchecked-mark.js");
  for (const name of ["backup-stamp", "init-client", "token", "auto-backup", "upload", "drive-ops", "client-id"]) assert.equal(block(b, name), block(a, name), name);
});
