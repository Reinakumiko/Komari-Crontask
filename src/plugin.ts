import { definePlugin, server } from "@komari-monitor/plugin-sdk";
import {
  type HistoryEntry,
  type Task,
  type TaskResult,
  asBoolean,
  buildHistoryEntry,
  isFailure,
  normalizeCronExpression,
  previewResult,
  taskFromInput,
  validateTask,
} from "./core";

/**
 * Komari Cron Task plugin (v0.2).
 *
 * Tasks are stored in __storageDir__/tasks.json (arbitrary count) and are
 * managed through an injected admin page (admin/index.html) that talks to the
 * plugin over registered RPC methods (crontask.*). Each fire dispatches the
 * command via admin:exec, polls admin:getTaskResultsByTaskId until every
 * node reported (exit_code set) or the timeout, then persists a history entry
 * and notifies on failure.
 *
 * Cron re-registration: the host server.cron API registers jobs per load and
 * removes them on unload. Mutating a task therefore persists tasks.json and
 * then calls admin:setPluginConfiguration with a bump counter; the host
 * reloads the whole plugin, which re-runs load() and rebuilds every cron job.
 */

/** ExecTaskSummary as returned by admin:exec. */
type ExecTaskSummary = {
  task_id: string;
  clients: string[];
  queued_clients: string[];
};

/** Node record returned by common:getNodes. */
type NodeInfo = {
  uuid: string;
  name: string;
  [key: string]: unknown;
};

const TASKS_FILE = `${__storageDir__}/tasks.json`;
const HISTORY_FILE = `${__storageDir__}/history.json`;
const AUDIT_FILE = `${__storageDir__}/audit.json`;
const HISTORY_LIMIT = 200;
const AUDIT_LIMIT = 500;
const POLL_INTERVAL_MS = 2000;

/** One audit log entry (who did what to a task). */
type AuditEntry = {
  ts: string;
  action: string;      // create | update | delete | enable | disable | run
  operator: string;    // best-effort display name from the caller
  taskId: string;
  taskName: string;
  detail: string;
};

/** In-flight guards: task id -> true while a round is still settling. */
const inFlight = new Set<string>();

// ---------------------------------------------------------------------------
// Storage (synchronous: RPC handlers must return synchronously, the host does
// not await Promise returns from registerRPC handlers)
// ---------------------------------------------------------------------------

function readJsonFileSync<T>(path: string, fallback: T): T {
  try {
    const fs: any = require("fs");
    const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
    return parsed as T;
  } catch {
    return fallback;
  }
}

function writeJsonFileSync(path: string, data: unknown): void {
  const fs: any = require("fs");
  fs.writeFileSync(path, JSON.stringify(data), "utf8");
}

function loadTasksSync(): Task[] {
  return readJsonFileSync<Task[]>(TASKS_FILE, []);
}

function loadHistorySync(): HistoryEntry[] {
  return readJsonFileSync<HistoryEntry[]>(HISTORY_FILE, []);
}

function loadAuditSync(): AuditEntry[] {
  return readJsonFileSync<AuditEntry[]>(AUDIT_FILE, []);
}

/** Appends one audit entry, keeping at most AUDIT_LIMIT entries (newest first). */
function appendAuditSync(entry: AuditEntry): void {
  try {
    const items = loadAuditSync();
    items.push(entry);
    if (items.length > AUDIT_LIMIT) {
      items.splice(0, items.length - AUDIT_LIMIT);
    }
    writeJsonFileSync(AUDIT_FILE, items);
  } catch (err) {
    console.log(`[crontask] audit write failed: ${String(err)}`);
  }
}

/** Appends one history entry, keeping at most HISTORY_LIMIT entries. */
function appendHistorySync(entry: HistoryEntry): void {
  try {
    const items = loadHistorySync();
    items.push(entry);
    if (items.length > HISTORY_LIMIT) {
      items.splice(0, items.length - HISTORY_LIMIT);
    }
    writeJsonFileSync(HISTORY_FILE, items);
  } catch (err) {
    console.log(`[crontask] history write failed: ${String(err)}`);
  }
}

/**
 * Persists tasks and synchronizes cron scheduling without any host reload.
 * Each unique cron expression is registered at most once per plugin load;
 * the fired handler re-reads the current task list, so add/edit/delete/enable
 * take effect on the next fire without touching RPC registrations.
 */
function persistTasksSync(tasks: Task[]): void {
  writeJsonFileSync(TASKS_FILE, tasks);
  syncCrons(tasks);
}

// ---------------------------------------------------------------------------
// Cron scheduling (expression-keyed, no host reload needed)
// ---------------------------------------------------------------------------

/** Cron expressions already registered via server.cron in this load. */
const registeredCrons = new Set<string>();

/**
 * Fired by one registered cron expression. Re-reads current tasks and
 * dispatches every enabled task whose normalized cron equals this expression.
 * Returns the aggregated promise so callers (and tests) can await the rounds.
 */
function dispatchByExpression(expr: string): Promise<unknown[]> {
  const pending: Promise<void>[] = [];
  for (const task of loadTasksSync()) {
    if (!task.enabled) continue;
    if (normalizeCronExpression(task.cron) !== expr) continue;
    if (task.command === "" || task.nodes.length === 0) continue;
    pending.push(dispatchTask(task));
  }
  return Promise.all(pending);
}

/** Registers server.cron for every unique expression in the task list. */
function syncCrons(tasks: Task[]): void {
  for (const task of tasks) {
    if (!task.enabled) continue;
    const expr = normalizeCronExpression(task.cron);
    if (expr === "") continue;
    if (registeredCrons.has(expr)) continue;
    try {
      server.cron(expr, () => dispatchByExpression(expr));
      registeredCrons.add(expr);
      console.log(`[crontask] scheduled cron ${expr}`);
    } catch (err) {
      console.log(`[crontask] bad cron "${expr}": ${String(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Node name resolution
// ---------------------------------------------------------------------------

/** Resolves node uuids to a display map {uuid -> {uuid, name}}. */
async function nodeInfoMap(): Promise<Map<string, NodeInfo>> {
  const names = new Map<string, NodeInfo>();
  try {
    const nodes = (await server.call("common:getNodes")) as Record<string, NodeInfo>;
    for (const [uuid, info] of Object.entries(nodes)) {
      names.set(uuid, info);
    }
  } catch {
    // Fall back to raw uuids on lookup failure.
  }
  return names;
}

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------

/**
 * Dispatches one task round: exec -> poll -> settle -> notify -> history.
 * Concurrent rounds for the same task are dropped.
 */
async function dispatchTask(task: Task): Promise<void> {
  // Lock synchronously BEFORE the first await so concurrent fires are dropped
  // deterministically (the in-flight check must not race with async storage I/O).
  if (inFlight.has(task.id)) {
    console.log(`[crontask] task ${task.id} still running, skipping this fire`);
    return;
  }
  inFlight.add(task.id);
  try {
    // Use the freshest persisted copy so an edit made after registration wins.
    const effective = loadTasksSync().find((t) => t.id === task.id) ?? task;
    if (effective.command === "" || effective.nodes.length === 0) {
      console.log(`[crontask] task ${task.id} empty command or no nodes, skipping`);
      return;
    }

    let taskId: string;
    try {
      const summary = await server.call("admin:exec", {
        command: effective.command,
        clients: effective.nodes,
      });
      taskId = summary.task_id;
    } catch (err) {
      console.log(`[crontask] task ${task.id} exec failed: ${String(err)}`);
      if (effective.notify) {
        await server.call("admin:sendNotification", {
          event: {
            event: "TaskFailed",
            message: `[Cron Task] ${effective.name}\nExec failed: ${String(err)}`,
            emoji: "⚠️",
            time: new Date().toISOString(),
          },
        });
      }
      return;
    }

    const { results, timedOut } = await pollTaskResults(
      taskId,
      effective.nodes,
      effective.timeout,
    );
    const entry = buildHistoryEntry(effective, taskId, results, timedOut);
    appendHistorySync(entry);

    if (isFailure(results) && effective.notify) {
      const message = await buildFailureMessage(entry);
      await server.call("admin:sendNotification", {
        event: {
          event: "TaskFailed",
          message,
          emoji: "⚠️",
          time: entry.ts,
          clients: effective.nodes.map((uuid) => ({ uuid })),
        },
      });
    } else {
      console.log(
        `[crontask] task ${task.id} round ${taskId} ok (${results.length} results)`,
      );
    }
  } finally {
    inFlight.delete(task.id);
  }
}

/**
 * Polls admin:getTaskResultsByTaskId until every expected client reported a
 * finished result (exit_code != null) or the timeout elapses.
 */
async function pollTaskResults(
  taskId: string,
  expectedClients: string[],
  timeoutSeconds: number,
): Promise<{ results: TaskResult[]; timedOut: boolean }> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  const expected = new Set(expectedClients);
  let results: TaskResult[] = [];
  for (;;) {
    try {
      results = await server.call("admin:getTaskResultsByTaskId", {
        task_id: taskId,
      });
    } catch (err) {
      console.log(`[crontask] poll task ${taskId} failed: ${String(err)}`);
    }
    const reported = new Map(results.map((r) => [r.client, r]));
    const done =
      expected.size > 0 &&
      [...expected].every((uuid) => {
        const row = reported.get(uuid);
        return (
          row !== undefined &&
          row.exit_code !== null &&
          row.exit_code !== undefined
        );
      });
    if (done || Date.now() >= deadline) {
      return { results, timedOut: !done };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/** Builds the failure notification message body. */
async function buildFailureMessage(entry: HistoryEntry): Promise<string> {
  const nodes = await nodeInfoMap();
  const lines: string[] = [
    `[Cron Task] ${entry.name}`,
    `Time: ${entry.ts}`,
    `Task: ${entry.execTaskId}`,
    entry.timedOut ? "Status: timed out" : "Status: failed",
  ];
  for (const r of entry.results) {
    const name = nodes.get(r.client)?.name ?? r.client;
    lines.push(
      `• ${name} (exit ${r.exit_code}): ${previewResult(r.result) || "(no output)"}`,
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Management RPC (called by the admin page via /api/rpc2)
// ---------------------------------------------------------------------------

/** Generates a compact unique id. */
function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** crontask.list -> { tasks, nodes } */
function rpcList(): { tasks: Task[]; nodes: NodeInfo[] } {
  return { tasks: loadTasksSync(), nodes: [] };
}

/** crontask.save: create or update a task. Returns synchronously. */
function rpcSave(input: Record<string, unknown>): { ok: boolean; task?: Task; error?: string } {
  const operator = String((input as Record<string, unknown>)?._operator ?? "admin");
  const task = taskFromInput(input ?? {});
  const error = validateTask(task);
  if (error) return { ok: false, error };
  const tasks = loadTasksSync();
  let action = "create";
  if (task.id === "") {
    task.id = newId();
    task.createdAt = new Date().toISOString();
    tasks.push(task);
  } else {
    const idx = tasks.findIndex((t) => t.id === task.id);
    if (idx === -1) return { ok: false, error: "Task not found" };
    action = "update";
    tasks[idx] = { ...task, createdAt: tasks[idx].createdAt };
  }
  persistTasksSync(tasks);
  appendAuditSync({
    ts: new Date().toISOString(),
    action,
    operator,
    taskId: task.id,
    taskName: task.name,
    detail: `${action === "create" ? "创建" : "更新"}任务 "${task.name}" @ ${task.cron}，节点 ${task.nodes.length} 个`,
  });
  return { ok: true, task };
}

/** crontask.delete -> removes a task. Returns synchronously. */
function rpcDelete(params: unknown): { ok: boolean; error?: string } {
  const p = (params ?? {}) as Record<string, unknown>;
  const operator = String(p._operator ?? "admin");
  const id = String(p.id ?? "");
  if (!id) return { ok: false, error: "Task id is required" };
  const tasks = loadTasksSync();
  const target = tasks.find((t) => t.id === id);
  if (!target) return { ok: false, error: "Task not found" };
  const next = tasks.filter((t) => t.id !== id);
  persistTasksSync(next);
  appendAuditSync({
    ts: new Date().toISOString(),
    action: "delete",
    operator,
    taskId: id,
    taskName: target.name,
    detail: `删除任务 "${target.name}"`,
  });
  return { ok: true };
}

/** crontask.setEnabled -> enable/disable a task. Returns synchronously. */
function rpcSetEnabled(params: unknown): { ok: boolean; error?: string } {
  const p = (params ?? {}) as Record<string, unknown>;
  const operator = String(p._operator ?? "admin");
  const id = String(p.id ?? "");
  const enabled = asBoolean(p.enabled, true);
  const tasks = loadTasksSync();
  const task = tasks.find((t) => t.id === id);
  if (!task) return { ok: false, error: "Task not found" };
  task.enabled = enabled;
  persistTasksSync(tasks);
  appendAuditSync({
    ts: new Date().toISOString(),
    action: enabled ? "enable" : "disable",
    operator,
    taskId: id,
    taskName: task.name,
    detail: `${enabled ? "启用" : "停用"}任务 "${task.name}"`,
  });
  return { ok: true };
}

/** crontask.run -> manually trigger a task immediately (async dispatch, sync return). */
function rpcRun(params: unknown): { ok: boolean; error?: string } {
  const p = (params ?? {}) as Record<string, unknown>;
  const operator = String(p._operator ?? "admin");
  const id = String(p.id ?? "");
  const task = loadTasksSync().find((t) => t.id === id);
  if (!task) return { ok: false, error: "Task not found" };
  if (task.command === "" || task.nodes.length === 0) {
    return { ok: false, error: "Task has no command or nodes" };
  }
  void dispatchTask(task);
  appendAuditSync({
    ts: new Date().toISOString(),
    action: "run",
    operator,
    taskId: id,
    taskName: task.name,
    detail: `手动触发任务 "${task.name}"`,
  });
  return { ok: true };
}

/** crontask.history -> recent history entries (newest first). Returns synchronously. */
function rpcHistory(params: unknown): { history: HistoryEntry[] } {
  const limit = Math.max(1, Math.min(200, Number((params as Record<string, unknown>)?.limit ?? 50) || 50));
  const items = loadHistorySync();
  return { history: items.slice(-limit).reverse() };
}

/** crontask.audit -> recent operation log (newest first). Returns synchronously. */
function rpcAudit(params: unknown): { audit: AuditEntry[] } {
  const limit = Math.max(1, Math.min(500, Number((params as Record<string, unknown>)?.limit ?? 100) || 100));
  const items = loadAuditSync();
  return { audit: items.slice(-limit).reverse() };
}

// ---------------------------------------------------------------------------
// Plugin lifecycle
// ---------------------------------------------------------------------------

definePlugin({
  async load() {
    // Management RPCs are registered once per plugin load. Because task
    // mutations never reload the plugin, these stay stable for the whole
    // lifetime of the runtime (no host-reload race).
    const rpcs: Array<[string, (p: unknown) => unknown]> = [
      ["crontask.list", () => rpcList()],
      ["crontask.save", (p) => rpcSave((p ?? {}) as Record<string, unknown>)],
      ["crontask.delete", (p) => rpcDelete(p)],
      ["crontask.setEnabled", (p) => rpcSetEnabled(p)],
      ["crontask.run", (p) => rpcRun(p)],
      ["crontask.history", (p) => rpcHistory(p)],
      ["crontask.audit", (p) => rpcAudit(p)],
    ];
    for (const [name, handler] of rpcs) {
      try {
        server.registerRPC(name, handler);
      } catch (err) {
        console.log(`[crontask] registerRPC ${name} failed: ${String(err)}`);
      }
    }

    const tasks = loadTasksSync();
    syncCrons(tasks);
    const enabled = tasks.filter((t) => t.enabled).length;
    console.log(
      `[crontask] loaded: ${registeredCrons.size} unique schedules for ${enabled}/${tasks.length} enabled tasks`,
    );
  },
});