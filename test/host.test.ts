/**
 * Host-simulation integration test (v0.2).
 *
 * Loads the real build artifact (script.js) inside a simulated goja host:
 * - require("server") provides cron/getConfig/call/registerRPC
 * - require("fs") provides node fs with __storageDir__ confined
 * - definePlugin registered globalThis.load
 *
 * Covers: load() registering crons from tasks.json, dispatch/poll/settle,
 * failure notification, history persistence, and the management RPC surface
 * (crontask.list/save/delete/setEnabled/run/history) exactly as the admin
 * page would call them.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const PLUGIN_BUILD = path.resolve("script.js");
const STORAGE = fs.mkdtempSync(path.join(os.tmpdir(), "crontask-host-"));

// ---- simulated host state ----

type CronJob = { expr: string; fn: () => unknown };

const host = {
  cronJobs: [] as CronJob[],
  execCalls: [] as Array<{ command: string; clients: string[] }>,
  pollCalls: [] as string[],
  notifications: [] as unknown[],
  taskResults: {} as Record<string, unknown>,
  storageDir: STORAGE,
  /** registered plugin RPC methods (name -> fn), aligned with server.registerRPC */
  rpcs: new Map<string, (params: unknown) => unknown>(),
};

function makeTask(overrides: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: "t1",
    name: "Alpha",
    cron: "0 3 * * *",
    command: "echo alpha",
    nodes: ["n1"],
    timeout: 300,
    notify: true,
    enabled: true,
    createdAt: "2026-08-26T00:00:00.000Z",
    ...overrides,
  };
}

async function writeTasks(tasks: unknown[]): Promise<void> {
  await fs.promises.writeFile(path.join(STORAGE, "tasks.json"), JSON.stringify(tasks), "utf8");
}

async function readTasks(): Promise<unknown[]> {
  try {
    return JSON.parse(await fs.promises.readFile(path.join(STORAGE, "tasks.json"), "utf8"));
  } catch {
    return [];
  }
}

/** Seeds the task result store for a system exec task id. */
function seedResults(taskId: string, results: unknown[]) {
  host.taskResults[taskId] = results;
}

/** Implements the host server module surface the plugin uses. */
function createServerModule() {
  const server: Record<string, unknown> = {
    cron(expr: string, fn: () => unknown) {
      host.cronJobs.push({ expr, fn });
    },
    async getConfig<T>(): Promise<T> {
      return {} as T;
    },
    async call<T = unknown>(method: string, params?: unknown): Promise<T> {
      switch (method) {
        case "admin:exec": {
          const p = params as { command: string; clients: string[] };
          host.execCalls.push({ command: p.command, clients: p.clients });
          const taskId = `tid-${host.execCalls.length}`;
          // Mirror the real server: pre-create rows with exit_code null.
          if (!(taskId in host.taskResults)) {
            host.taskResults[taskId] = p.clients.map((c) => ({
              client: c, result: "", exit_code: null,
            }));
          }
          return { task_id: taskId, clients: p.clients, queued_clients: [] } as T;
        }
        case "admin:getTaskResultsByTaskId": {
          const p = params as { task_id: string };
          host.pollCalls.push(p.task_id);
          return (host.taskResults[p.task_id] ?? []) as T;
        }
        case "admin:sendNotification": {
          host.notifications.push(params);
          return null as T;
        }
        case "admin:setPluginConfiguration": {
          // Persist revision (host would reload; here just no-op).
          return null as T;
        }
        case "common:getNodes": {
          return { n1: { uuid: "n1", name: "Node One" } } as T;
        }
        default:
          throw new Error(`unexpected method: ${method}`);
      }
    },
    registerRPC(method: string, handler: (p: unknown) => unknown) {
      host.rpcs.set(method, handler);
    },
  };
  return server;
}

/** Boots the plugin bundle inside the simulated host. */
async function bootPlugin(): Promise<void> {
  host.cronJobs = [];
  host.execCalls = [];
  host.pollCalls = [];
  host.notifications = [];
  host.taskResults = {};
  host.rpcs.clear();

  const serverModule = createServerModule();
  const requireFn = (name: string) => {
    if (name === "server") return serverModule;
    if (name === "fs") return fs;
    throw new Error(`unexpected require: ${name}`);
  };

  const src = fs.readFileSync(PLUGIN_BUILD, "utf8");
  const wrapper = new Function(
    "require", "module", "__storageDir__", "console",
    "setTimeout", "clearTimeout", src,
  );
  wrapper(requireFn, { exports: {} }, STORAGE, console, setTimeout, clearTimeout);
  if (typeof (globalThis as any).load !== "function") {
    throw new Error("definePlugin did not install globalThis.load");
  }
  await (globalThis as any).load();
}

beforeEach(async () => {
  // Fresh storage per test.
  for (const f of ["tasks.json", "history.json"]) {
    try { await fs.promises.unlink(path.join(STORAGE, f)); } catch { /* ignore */ }
  }
  delete (globalThis as any).load;
  delete (globalThis as any).unload;
});

afterEach(() => {
  delete (globalThis as any).load;
  delete (globalThis as any).unload;
});

// ---- cron registration ----

test("load() registers crons for enabled tasks only", async () => {
  await writeTasks([
    makeTask({ id: "a", enabled: true, cron: "0 3 * * *" }),
    makeTask({ id: "b", enabled: false, cron: "0 4 * * *" }),
  ]);
  await bootPlugin();
  assert.equal(host.cronJobs.length, 1);
  assert.equal(host.cronJobs[0].expr, "0 3 * * *");
});

test("load() normalizes @every1m compact expression", async () => {
  await writeTasks([makeTask({ id: "a", cron: "@every1m" })]);
  await bootPlugin();
  assert.equal(host.cronJobs[0].expr, "@every 1m");
});

// ---- round lifecycle ----

test("fired cron round runs exec, polls, writes history, no notify on success", async () => {
  await writeTasks([makeTask({})]);
  await bootPlugin();
  seedResults("tid-1", [
    { client: "n1", result: "alpha ok", exit_code: 0 },
  ]);
  await host.cronJobs[0].fn();

  assert.equal(host.execCalls.length, 1);
  assert.deepEqual(host.execCalls[0].clients, ["n1"]);
  assert.ok(host.pollCalls.includes("tid-1"));
  assert.equal(host.notifications.length, 0);
  const history = JSON.parse(await fs.promises.readFile(path.join(STORAGE, "history.json"), "utf8"));
  assert.equal(history.length, 1);
  assert.equal(history[0].name, "Alpha");
  assert.equal(history[0].execTaskId, "tid-1");
  assert.equal(history[0].timedOut, false);
  assert.equal(history[0].results[0].exit_code, 0);
});

test("failed round triggers notification with exit codes", async () => {
  await writeTasks([makeTask({ command: "exit 1" })]);
  await bootPlugin();
  seedResults("tid-1", [{ client: "n1", result: "boom", exit_code: 1 }]);
  await host.cronJobs[0].fn();
  assert.equal(host.notifications.length, 1);
  const notif = host.notifications[0] as any;
  assert.equal(notif.event.event, "TaskFailed");
  assert.match(String(notif.event.message), /Alpha/);
  assert.match(String(notif.event.message), /exit 1/);
});

test("poll waits for exit_code to be set, not just a pre-created row", async () => {
  await writeTasks([makeTask({ command: "work", nodes: ["n1"] })]);
  await bootPlugin();
  host.taskResults["tid-1"] = [{ client: "n1", result: "", exit_code: null }];
  setTimeout(() => {
    host.taskResults["tid-1"] = [{ client: "n1", result: "done", exit_code: 0 }];
  }, 300);
  await host.cronJobs[0].fn();
  assert.ok(host.pollCalls.length >= 2, "expected more than one poll");
  const history = JSON.parse(await fs.promises.readFile(path.join(STORAGE, "history.json"), "utf8"));
  assert.equal(history[0].timedOut, false);
  assert.equal(history[0].results[0].exit_code, 0);
});

test("empty nodes task round is skipped without exec", async () => {
  await writeTasks([makeTask({ nodes: [] })]);
  await bootPlugin();
  await host.cronJobs[0].fn();
  assert.equal(host.execCalls.length, 0);
  assert.equal(host.notifications.length, 0);
});

test("concurrent in-flight fire for the same task is dropped", async () => {
  await writeTasks([makeTask({ command: "sleep", nodes: ["n1"] })]);
  await bootPlugin();
  seedResults("tid-1", [{ client: "n1", result: "ok", exit_code: 0 }]);
  const first = host.cronJobs[0].fn();
  const second = host.cronJobs[0].fn();
  await first;
  await second;
  assert.equal(host.execCalls.length, 1);
});

// ---- management RPC surface ----

async function rpc(method: string, params?: unknown): Promise<any> {
  const fn = host.rpcs.get(method);
  if (!fn) throw new Error(`RPC not registered: ${method}`);
  return fn(params ?? {});
}

test("registers all management RPC methods", async () => {
  await writeTasks([]);
  await bootPlugin();
  for (const m of ["crontask.list", "crontask.save", "crontask.delete",
                   "crontask.setEnabled", "crontask.run", "crontask.history", "crontask.audit"]) {
    assert.ok(host.rpcs.has(m), `missing ${m}`);
  }
});

test("crontask.audit logs create/delete with operator", async () => {
  await writeTasks([]);
  await bootPlugin();
  await rpc("crontask.save", { ...makeTask({ id: "" }), _operator: "alice" });
  const list = await rpc("crontask.list");
  const id = list.tasks[0].id;
  await rpc("crontask.delete", { id, _operator: "bob" });
  const audit = await rpc("crontask.audit");
  assert.equal(audit.audit.length, 2);
  assert.equal(audit.audit[0].action, "delete");
  assert.equal(audit.audit[0].operator, "bob");
  assert.equal(audit.audit[1].action, "create");
  assert.equal(audit.audit[1].operator, "alice");
  assert.match(audit.audit[1].detail, /Alpha/);
});

test("crontask.save creates a task; list returns it", async () => {
  await writeTasks([]);
  await bootPlugin();
  const saved = await rpc("crontask.save", makeTask({ id: "" }));
  assert.equal(saved.ok, true);
  assert.ok(saved.task.id, "generated id");
  const list = await rpc("crontask.list");
  assert.equal(list.tasks.length, 1);
  assert.equal(list.tasks[0].name, "Alpha");
  assert.deepEqual(list.tasks[0].nodes, ["n1"]);
});

test("crontask.save validates and rejects empty commands", async () => {
  await writeTasks([]);
  await bootPlugin();
  const res = await rpc("crontask.save", makeTask({ id: "", command: "" }));
  assert.equal(res.ok, false);
  assert.match(res.error, /Command/);
});

test("crontask.setEnabled toggles and re-load registers accordingly", async () => {
  await writeTasks([makeTask({ id: "a" })]);
  await bootPlugin();
  assert.equal(host.cronJobs.length, 1);
  const res = await rpc("crontask.setEnabled", { id: "a", enabled: false });
  assert.equal(res.ok, true);
  const tasks = await readTasks();
  assert.equal((tasks[0] as any).enabled, false);
});

test("crontask.delete removes the task", async () => {
  await writeTasks([makeTask({ id: "a" }), makeTask({ id: "b", name: "Beta" })]);
  await bootPlugin();
  const res = await rpc("crontask.delete", { id: "a" });
  assert.equal(res.ok, true);
  const tasks = await readTasks();
  assert.deepEqual(tasks.map((t: any) => t.id), ["b"]);
  const res2 = await rpc("crontask.delete", { id: "missing" });
  assert.equal(res2.ok, false);
});

test("crontask.run triggers a round and writes history", async () => {
  await writeTasks([makeTask({ id: "a", command: "manual" })]);
  await bootPlugin();
  seedResults("tid-1", [{ client: "n1", result: "manual done", exit_code: 0 }]);
  const res = await rpc("crontask.run", { id: "a" });
  assert.equal(res.ok, true);
  await new Promise((r) => setTimeout(r, 100));
  const history = await rpc("crontask.history", { limit: 10 });
  assert.equal(history.history.length, 1);
  assert.equal(history.history[0].name, "Alpha");
  assert.equal(history.history[0].execTaskId, "tid-1");
});

test("crontask.list returns tasks", async () => {
  await writeTasks([makeTask({ id: "a" })]);
  await bootPlugin();
  const list = await rpc("crontask.list");
  assert.equal(list.tasks.length, 1);
  assert.equal(list.tasks[0].id, "a");
});

test("crontask.history returns entries newest-first", async () => {
  await writeTasks([]);
  await bootPlugin();
  await writeTasks([makeTask({ id: "a" })]);
  seedResults("tid-1", [{ client: "n1", result: "r1", exit_code: 0 }]);
  await rpc("crontask.run", { id: "a" });
  await new Promise((r) => setTimeout(r, 50));
  const history = await rpc("crontask.history", { limit: 5 });
  assert.ok(Array.isArray(history.history));
  assert.ok(history.history.length >= 1);
});