import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCronExpression,
  asString,
  asBoolean,
  asNumber,
  asNodeIds,
  taskFromInput,
  validateTask,
  buildHistoryEntry,
  previewResult,
  isFailure,
  cronMatchesInTz,
  parseCronFields,
  parseTzOffsetMinutes,
  type Task,
} from "../src/core";

// ---- normalizeCronExpression ----

test("normalizeCronExpression: leaves normal expressions untouched", () => {
  assert.equal(normalizeCronExpression("0 3 * * *"), "0 3 * * *");
  assert.equal(normalizeCronExpression("*/10 * * * *"), "*/10 * * * *");
});

test("normalizeCronExpression: fixes compact @every", () => {
  assert.equal(normalizeCronExpression("@every1m"), "@every 1m");
  assert.equal(normalizeCronExpression("@every2h"), "@every 2h");
  assert.equal(normalizeCronExpression("@every 1m"), "@every 1m");
});

// ---- asString / asBoolean / asNumber ----

test("asString: trims and falls back on empty", () => {
  assert.equal(asString("  hello  ", "fb"), "hello");
  assert.equal(asString("", "fb"), "fb");
  assert.equal(asString(undefined, "fb"), "fb");
});

test("asBoolean: only true booleans pass", () => {
  assert.equal(asBoolean(true, false), true);
  assert.equal(asBoolean(false, true), false);
  assert.equal(asBoolean("true", false), false);
});

test("asNumber: clamps to [1, 3600]", () => {
  assert.equal(asNumber(300, 300), 300);
  assert.equal(asNumber(0, 300), 1);
  assert.equal(asNumber(99999, 300), 3600);
  assert.equal(asNumber("900", 300), 900);
  assert.equal(asNumber(NaN, 300), 300);
});

// ---- asNodeIds ----

test("asNodeIds: dedups, trims, drops non-strings", () => {
  assert.deepEqual(asNodeIds(["a", " b ", "a"]), ["a", "b"]);
  assert.deepEqual(asNodeIds([1, null, ""]), []);
  assert.deepEqual(asNodeIds(undefined), []);
});

test("asNodeIds: accepts JSON string form (managed config)", () => {
  assert.deepEqual(asNodeIds('["n1"," n2 ","n1"]'), ["n1", "n2"]);
  assert.deepEqual(asNodeIds("[]"), []);
  assert.deepEqual(asNodeIds(""), []);
  assert.deepEqual(asNodeIds("not json"), []);
});

// ---- taskFromInput / validateTask ----

test("taskFromInput: fills defaults and normalizes fields", () => {
  const t = taskFromInput({
    name: "  Alpha  ",
    cron: "0 3 * * *",
    command: "echo a",
    nodes: ["n1", "n1"],
    timeout: 99999,
  });
  assert.equal(t.name, "Alpha");
  assert.equal(t.cron, "0 3 * * *");
  assert.deepEqual(t.nodes, ["n1"]);
  assert.equal(t.timeout, 3600); // clamped
  assert.equal(t.notify, true); // default
  assert.equal(t.enabled, true); // default
  assert.equal(t.type, "command"); // default type
  assert.ok(t.id === ""); // new task has no id yet
});

test("validateTask: rejects missing fields", () => {
  const base: Task = {
    id: "x", name: "A", cron: "0 3 * * *", command: "echo", type: "command",
    nodes: ["n1"], sandboxCommand: "", sandboxNetwork: false, sandboxStrict: true, tz: "",
    actionMethod: "", actionParams: "{}",
    timeout: 60, notify: true, enabled: true, createdAt: "",
  };
  assert.equal(validateTask({ ...base }), null);
  assert.ok(validateTask({ ...base, name: "" })?.includes("name"));
  assert.ok(validateTask({ ...base, cron: "" })?.includes("Cron"));
  assert.ok(validateTask({ ...base, cron: "*/10 *" })?.includes("Cron"));
  assert.ok(validateTask({ ...base, command: "" })?.includes("Command"));
  assert.ok(validateTask({ ...base, nodes: [] })?.includes("node"));
});

test("taskFromInput: sandbox and action types parse", () => {
  const s = taskFromInput({ name: "S", type: "sandbox", sandboxCommand: "uptime", sandboxNetwork: true });
  assert.equal(s.type, "sandbox");
  assert.equal(s.sandboxCommand, "uptime");
  assert.equal(s.sandboxNetwork, true);
  assert.equal(s.sandboxStrict, true); // 默认严格模式
  const a = taskFromInput({ name: "A", type: "action", actionMethod: "admin:vacuumDatabase", actionParams: "{}" });
  assert.equal(a.type, "action");
  assert.equal(a.actionMethod, "admin:vacuumDatabase");
  const c = taskFromInput({ name: "C", type: "weird" });
  assert.equal(c.type, "command"); // unknown -> command fallback
});

test("validateTask: sandbox and action specific checks", () => {
  const sb: Task = {
    id: "x", name: "S", cron: "0 3 * * *", type: "sandbox",
    command: "", nodes: [], sandboxCommand: "", sandboxNetwork: false, sandboxStrict: true, tz: "",
    actionMethod: "", actionParams: "{}", timeout: 60, notify: true, enabled: true, createdAt: "",
  };
  assert.match(validateTask(sb) ?? "", /Sandbox/);
  assert.equal(validateTask({ ...sb, sandboxCommand: "uptime" }), null);

  const ac: Task = {
    id: "x", name: "A", cron: "0 3 * * *", type: "action",
    command: "", nodes: [], sandboxCommand: "", sandboxNetwork: false, sandboxStrict: true, tz: "",
    actionMethod: "", actionParams: "{}", timeout: 60, notify: true, enabled: true, createdAt: "",
  };
  assert.match(validateTask(ac) ?? "", /Action method/);
  assert.equal(validateTask({ ...ac, actionMethod: "admin:vacuumDatabase", actionParams: "not-json" }), "Action params must be valid JSON");
  assert.equal(validateTask({ ...ac, actionMethod: "admin:vacuumDatabase", actionParams: "{}" }), null);
});

test("validateTask: allows @every style", () => {
  const base: Task = {
    id: "x", name: "A", cron: "@every 1m", command: "echo", type: "command",
    nodes: ["n1"], sandboxCommand: "", sandboxNetwork: false, sandboxStrict: true, tz: "",
    actionMethod: "", actionParams: "{}",
    timeout: 60, notify: true, enabled: true, createdAt: "",
  };
  assert.equal(validateTask(base), null);
});

// ---- buildHistoryEntry / previewResult / isFailure ----

test("buildHistoryEntry: maps results and carries round metadata", () => {
  const task: Task = {
    id: "t1", name: "Alpha", cron: "0 3 * * *", command: "echo a", type: "command",
    nodes: ["n1", "n2"], sandboxCommand: "", sandboxNetwork: false, sandboxStrict: true, tz: "",
    actionMethod: "", actionParams: "{}",
    timeout: 60, notify: true, enabled: true, createdAt: "",
  };
  const entry = buildHistoryEntry(task, "exec-1", [
    { client: "n1", result: "out1", exit_code: 0 },
    { client: "n2", result: "out2", exit_code: null },
  ], true, "2026-08-26T00:00:00.000Z");
  assert.equal(entry.taskId, "t1");
  assert.equal(entry.execTaskId, "exec-1");
  assert.equal(entry.timedOut, true);
  assert.deepEqual(entry.results[1], { client: "n2", result: "out2", exit_code: null });
});

test("previewResult: collapses whitespace and truncates long output", () => {
  assert.equal(previewResult("  a\n  b  "), "a b");
  const long = "x".repeat(1000);
  const preview = previewResult(long);
  assert.ok(preview.endsWith("…"));
  assert.ok(preview.length <= 501);
  assert.equal(previewResult(""), "");
});

test("isFailure: non-zero, null, or no results means failure", () => {
  assert.equal(isFailure([]), true);
  assert.equal(isFailure([{ client: "n1", result: "", exit_code: 1 }]), true);
  assert.equal(isFailure([{ client: "n1", result: "", exit_code: null }]), true);
  assert.equal(isFailure([
    { client: "n1", result: "", exit_code: 0 },
    { client: "n2", result: "", exit_code: 1 },
  ]), true);
  assert.equal(isFailure([
    { client: "n1", result: "", exit_code: 0 },
    { client: "n2", result: "", exit_code: 0 },
  ]), false);
});
// ---- 时区调度：parseTzOffsetMinutes / parseCronFields / cronMatchesInTz ----

test("parseTzOffsetMinutes: accepts UTC offsets, rejects the rest", () => {
  assert.equal(parseTzOffsetMinutes(""), null); // 空 = 跟随服务器
  assert.equal(parseTzOffsetMinutes("UTC+8"), 480);
  assert.equal(parseTzOffsetMinutes("utc-5:30"), -330); // 大小写不敏感
  assert.equal(parseTzOffsetMinutes("+08:00"), 480);
  assert.equal(parseTzOffsetMinutes("UTC"), 0);
  assert.equal(parseTzOffsetMinutes("UTC+14"), 840);
  assert.equal(parseTzOffsetMinutes("Asia/Shanghai"), null); // 仅支持偏移
  assert.equal(parseTzOffsetMinutes("UTC+99"), null);
  assert.equal(parseTzOffsetMinutes("UTC+8:75"), null);
});

test("parseCronFields: validates fields, drops seconds, folds dow 7", () => {
  assert.ok(parseCronFields("0 5 * * *"));
  assert.ok(parseCronFields("30 8 1,15 * 1-5"));
  assert.ok(parseCronFields("0 0 0 0 0 0".slice(0, 0) + "0 3 * * * 5")); // 6字段丢秒
  assert.equal(parseCronFields("60 * * * *"), null); // 分钟越界
  assert.equal(parseCronFields("* 25 * * *"), null); // 小时越界
  assert.equal(parseCronFields("0 3 * 13 *"), null); // 月份越界
  assert.equal(parseCronFields("0 3 * *"), null); // 字段数不足
  const f = parseCronFields("0 3 * * 7");
  assert.ok(f && f.dow.values.has(0)); // 7 折叠为周日
});

test("cronMatchesInTz: daily 05:00 UTC+8 fires at 21:00 UTC prev day", () => {
  // 2026-03-10 21:00:00 UTC = 北京时间 2026-03-11 05:00
  const utc2100 = new Date("2026-03-10T21:00:00Z");
  assert.equal(cronMatchesInTz("0 5 * * *", 480, utc2100), true);
  // 同一时刻按 UTC（offset 0）应是 21:00，不匹配 05:00
  assert.equal(cronMatchesInTz("0 5 * * *", 0, utc2100), false);
  // 北京 05:01 不匹配
  const utc2101 = new Date("2026-03-10T21:01:00Z");
  assert.equal(cronMatchesInTz("0 5 * * *", 480, utc2101), false);
});

test("cronMatchesInTz: dom/dow OR semantics and lists/steps", () => {
  // 北京时间 2026-03-10（周二）05:00 = UTC 2026-03-09（周一）21:00
  const tueBeijing = new Date("2026-03-09T21:00:00Z");
  assert.equal(cronMatchesInTz("0 5 10 * 1", 480, tueBeijing), true); // dom 10 命中
  assert.equal(cronMatchesInTz("0 5 11 * 2", 480, tueBeijing), true); // dow 周二命中
  assert.equal(cronMatchesInTz("0 5 11 * 1", 480, tueBeijing), false); // 都不命中
  assert.equal(cronMatchesInTz("*/15 5 * * *", 480, new Date("2026-03-09T21:45:00Z")), true);
  assert.equal(cronMatchesInTz("*/15 5 * * *", 480, new Date("2026-03-09T21:50:00Z")), false);
});
