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
  assert.ok(t.id === ""); // new task has no id yet
});

test("validateTask: rejects missing fields", () => {
  const base: Task = {
    id: "x", name: "A", cron: "0 3 * * *", command: "echo",
    nodes: ["n1"], timeout: 60, notify: true, enabled: true, createdAt: "",
  };
  assert.equal(validateTask({ ...base }), null);
  assert.ok(validateTask({ ...base, name: "" })?.includes("name"));
  assert.ok(validateTask({ ...base, cron: "" })?.includes("Cron"));
  assert.ok(validateTask({ ...base, cron: "*/10 *" })?.includes("Cron"));
  assert.ok(validateTask({ ...base, command: "" })?.includes("Command"));
  assert.ok(validateTask({ ...base, nodes: [] })?.includes("node"));
});

test("validateTask: allows @every style", () => {
  const base: Task = {
    id: "x", name: "A", cron: "@every 1m", command: "echo",
    nodes: ["n1"], timeout: 60, notify: true, enabled: true, createdAt: "",
  };
  assert.equal(validateTask(base), null);
});

// ---- buildHistoryEntry / previewResult / isFailure ----

test("buildHistoryEntry: maps results and carries round metadata", () => {
  const task: Task = {
    id: "t1", name: "Alpha", cron: "0 3 * * *", command: "echo a",
    nodes: ["n1", "n2"], timeout: 60, notify: true, enabled: true, createdAt: "",
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