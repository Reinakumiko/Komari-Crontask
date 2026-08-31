import { definePlugin, server } from "@komari-monitor/plugin-sdk";
import {
  type HistoryEntry,
  type Task,
  type TaskResult,
  asBoolean,
  buildHistoryEntry,
  buildSingleHistoryEntry,
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
  const items = readJsonFileSync<HistoryEntry[]>(HISTORY_FILE, []);
  // 兼容旧记录：补齐缺失字段
  return items.map((it) => ({
    ...it,
    type: it.type ?? "command",
    results: it.results ?? [],
  }));
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
    if (!isTaskExecutable(task)) continue;
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
/** 判断任务可执行（按类型） */
function isTaskExecutable(t: Task): boolean {
  switch (t.type) {
    case "command": return t.command !== "" && t.nodes.length > 0;
    case "sandbox": return t.sandboxCommand !== "";
    case "action": return t.actionMethod !== "";
    default: return false;
  }
}

/** 执行后的统一失败通知 */
async function notifyFailure(task: Task, message: string, clients?: string[]): Promise<void> {
  if (!task.notify) return;
  try {
    await server.call("admin:sendNotification", {
      event: {
        event: "TaskFailed",
        message,
        emoji: "⚠️",
        time: new Date().toISOString(),
        ...(clients?.length ? { clients: clients.map((uuid) => ({ uuid })) } : {}),
      },
    });
  } catch (e) {
    console.log(`[crontask] notify failed: ${String(e)}`);
  }
}

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
    if (!isTaskExecutable(effective)) {
      console.log(`[crontask] task ${task.id} not executable (type=${effective.type}), skipping`);
      return;
    }

    switch (effective.type) {
      case "sandbox":
        await dispatchSandboxTask(effective);
        break;
      case "action":
        await dispatchActionTask(effective);
        break;
      default:
        await dispatchRemoteTask(effective);
    }
  } finally {
    inFlight.delete(task.id);
  }
}

/** command：远程节点执行 */
async function dispatchRemoteTask(effective: Task): Promise<void> {
  let taskId: string;
  try {
    const summary = await server.call("admin:exec", {
      command: effective.command,
      clients: effective.nodes,
    });
    taskId = summary.task_id;
  } catch (err) {
    console.log(`[crontask] task ${effective.id} exec failed: ${String(err)}`);
    await notifyFailure(effective, `[Cron Task] ${effective.name}\nExec failed: ${String(err)}`);
    return;
  }

  const { results, timedOut } = await pollTaskResults(
    taskId,
    effective.nodes,
    effective.timeout,
  );
  const entry = buildHistoryEntry(effective, taskId, results, timedOut);
  appendHistorySync(entry);

  if (isFailure(results)) {
    const message = await buildFailureMessage(entry);
    await notifyFailure(effective, message, effective.nodes);
  } else {
    console.log(`[crontask] task ${effective.id} round ${taskId} ok (${results.length} results)`);
  }
}

/**
 * sandbox：在插件自带的隔离沙箱（bwrap + busybox，全静态二进制）里执行命令。
 * 默认禁网 + 只读根 + 无权限；联网由任务配置打开（仍受沙箱隔离）。
 * 环境不支持命名空间时：严格模式报错（默认）/ 宽松模式降级直接执行。
 */
/** 确保沙箱二进制可执行（ZIP 解压可能丢执行位） */
function ensureExecutable(...paths: string[]): void {
  try {
    const fs: any = require("fs");
    for (const p of paths) {
      try { fs.chmodSync(p, 0o755); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

type SandboxCapability = { available: boolean; reason: string; checkedAt: string };
let sandboxProbeCache: SandboxCapability | null = null;
let sandboxProbePending = false;

function sandboxBins(): { bwrapBin: string; busyboxBin: string } {
  const sandboxDir = `${__dirname}/sandbox`;
  return {
    bwrapBin: `${sandboxDir}/bin/bwrap`,
    busyboxBin: `${sandboxDir}/bin/busybox`,
  };
}

/** 探测当前环境能否创建命名空间（bwrap 试运行 busybox true，结果缓存；内部自兜底，永不 reject） */
async function probeSandboxCapability(force = false): Promise<SandboxCapability> {
  if (sandboxProbeCache && !force) return sandboxProbeCache;
  try {
    const { bwrapBin, busyboxBin } = sandboxBins();
    ensureExecutable(bwrapBin, busyboxBin);
    const r = await spawnCS(
      bwrapBin,
      [
        "--ro-bind", "/", "/",
        "--dev", "/dev",
        "--proc", "/proc",
        "--unshare-net",
        "--unshare-pid",
        busyboxBin, "true",
      ],
      { env: envSafe(), timeout: 15000 },
    );
    sandboxProbeCache =
      r.exitCode === 0
        ? { available: true, reason: "", checkedAt: new Date().toISOString() }
        : {
            available: false,
            reason: (r.stderr || `bwrap exit ${r.exitCode}`).trim().slice(0, 160),
            checkedAt: new Date().toISOString(),
          };
  } catch (err) {
    sandboxProbeCache = {
      available: false,
      reason: String(err).slice(0, 160),
      checkedAt: new Date().toISOString(),
    };
  }
  sandboxProbePending = false;
  console.log(
    `[crontask] sandbox probe: available=${sandboxProbeCache.available}${sandboxProbeCache.reason ? ` (${sandboxProbeCache.reason})` : ""}`,
  );
  return sandboxProbeCache;
}

/** 无缓存时后台探测，立即返回缓存（probing=true 表示探测进行中） */
function startProbeIfNeeded(force: boolean): void {
  if (sandboxProbePending || (sandboxProbeCache && !force)) return;
  sandboxProbePending = true;
  void probeSandboxCapability(force).catch(() => { sandboxProbePending = false; });
}

async function dispatchSandboxTask(effective: Task): Promise<void> {
  try {
    const { bwrapBin, busyboxBin } = sandboxBins();
    ensureExecutable(bwrapBin, busyboxBin);
    const cap = await probeSandboxCapability();
    let result: { stdout: string; stderr: string; exitCode: number };
    let isolated = true;

    if (cap.available) {
      // bwrap 参数：只读根文件系统 / 临时 tmpfs / proc / dev；默认禁网
      const bwrapArgs = [
        "--ro-bind", "/", "/",
        "--tmpfs", "/tmp",
        "--proc", "/proc",
        "--dev", "/dev",
        "--unshare-pid",
        "--unshare-ipc",
        "--unshare-uts",
      ];
      bwrapArgs.push(effective.sandboxNetwork ? "--share-net" : "--unshare-net");
      // 用户空间名字空间（无需 root），失败自动回退（某些宿主禁止非特权 userns）
      bwrapArgs.unshift("--unshare-user-try");
      result = await spawnCS(
        bwrapBin,
        [...bwrapArgs, busyboxBin, "sh", "-c", effective.sandboxCommand],
        { env: envSafe(), timeout: effective.timeout * 1000 },
      );
    } else if (effective.sandboxStrict) {
      throw new Error(
        `当前环境不支持沙箱隔离（${cap.reason}）。` +
          `解法：以 --security-opt seccomp=unconfined 或 --privileged 运行 Komari 容器，或在裸机部署；` +
          `或在任务中改用宽松模式（隔离不可用时直接执行）`,
      );
    } else {
      // 宽松模式：无隔离直接执行，输出前加显著警告
      isolated = false;
      result = await spawnCS(busyboxBin, ["sh", "-c", effective.sandboxCommand], {
        env: envSafe(),
        timeout: effective.timeout * 1000,
      });
    }

    const ok = result.exitCode === 0;
    const prefix = isolated ? "" : "⚠️ 隔离不可用，本次为直接执行（非沙箱）\n";
    const entry = buildSingleHistoryEntry(
      effective,
      ok
        ? isolated ? "沙箱执行成功" : "执行成功（宽松模式，无隔离）"
        : `执行失败 (exit ${result.exitCode})`,
      result.exitCode,
      false,
      ok,
      new Date().toISOString(),
    );
    entry.detail = (prefix + result.stdout + result.stderr).slice(0, 1000);
    appendHistorySync(entry);
    if (!ok) {
      await notifyFailure(effective, `[Cron Task] ${effective.name}\n沙箱命令退出码 ${result.exitCode}\n${entry.detail}`);
    } else {
      console.log(`[crontask] task ${effective.id} sandbox ok (isolated=${isolated})`);
    }
  } catch (err) {
    await notifyFailure(effective, `[Cron Task] ${effective.name}\n沙箱执行失败: ${String(err)}`);
    const entry = buildSingleHistoryEntry(effective, `沙箱执行失败: ${String(err)}`, -2, false, false, new Date().toISOString());
    appendHistorySync(entry);
  }
}

/** child_process 执行封装：返回 {stdout, stderr, exitCode} */
async function spawnCS(command: string, args: string[], options: {
  env?: Record<string, string | undefined>;
  timeout?: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cp: any = require("child_process");
  return await new Promise((resolve, reject) => {
    const child: any = cp.spawn(command, args, {
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (d: unknown) => { stdout += String(d ?? ""); });
    child.stderr?.on("data", (d: unknown) => { stderr += String(d ?? ""); });
    const t = options.timeout
      ? setTimeout(() => {
          try { child.kill("SIGKILL"); } catch { /* ignore */ }
          reject(new Error("sandbox timeout"));
        }, options.timeout)
      : undefined;
    child.on("error", (e: Error) => { if (t) clearTimeout(t); reject(e); });
    child.on("close", (code: number | null | undefined) => {
      if (t) clearTimeout(t);
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
  });
}

/** 保留 PATH/常用变量，避免宿主环境变量泄露 */
function envSafe(): Record<string, string | undefined> {
  return {
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    LANG: "C.UTF-8",
  };
}

/**
 * action：调用 Komari 系统 RPC 执行。
 * 参数 actionParams 为 JSON 字符串；返回值（或错误）作为单条结果写入历史。
 */
async function dispatchActionTask(effective: Task): Promise<void> {
  const method = effective.actionMethod.trim();
  let params: unknown;
  try {
    params = JSON.parse(effective.actionParams || "{}");
  } catch {
    await notifyFailure(effective, `[Cron Task] ${effective.name}\nAction 参数不是合法 JSON`);
    return;
  }
  try {
    const result = await server.call(method, params);
    const summary = summarizeActionResult(result);
    const entry = buildSingleHistoryEntry(
      effective,
      `调用 ${method}：${summary}`,
      0,
      false,
      true,
      new Date().toISOString(),
    );
    entry.detail = JSON.stringify(result ?? null).slice(0, 1000);
    appendHistorySync(entry);
    console.log(`[crontask] task ${effective.id} action ${method} ok`);
  } catch (err) {
    const msg = `[Cron Task] ${effective.name}\nAction ${method} 调用失败: ${String(err)}`;
    await notifyFailure(effective, msg);
    const entry = buildSingleHistoryEntry(
      effective,
      `调用 ${method}：失败 - ${String(err)}`,
      -1,
      false,
      false,
      new Date().toISOString(),
    );
    appendHistorySync(entry);
  }
}

/** 将任意 RPC 返回值转成简短摘要（对象取大小/首键，避免超长） */
function summarizeActionResult(result: unknown): string {
  if (result === null || result === undefined) return "成功";
  if (typeof result === "string" || typeof result === "number" || typeof result === "boolean") {
    return String(result).slice(0, 200);
  }
  if (Array.isArray(result)) return `${result.length} 条记录`;
  if (typeof result === "object") {
    const entries = Object.entries(result as Record<string, unknown>);
    const brief = entries.slice(0, 5).map(([k, v]) => {
      if (v === null || v === undefined) return `${k}: null`;
      if (typeof v === "object") return `${k}: ${Array.isArray(v) ? `[${(v as unknown[]).length}]` : "{…}"}`;
      return `${k}: ${String(v).slice(0, 60)}`;
    }).join(", ");
    return entries.length > 5 ? brief + ", …" : brief;
  }
  return String(result).slice(0, 200);
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
    const name = (r.client && nodes.get(r.client)?.name) ?? r.client ?? "server";
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
  if (!isTaskExecutable(task)) {
    return { ok: false, error: "Task is not executable" };
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

/** crontask.sandboxStatus -> 沙箱环境探测结果（force=true 重新探测；probing=true 表示探测进行中） */
function rpcSandboxStatus(params: unknown): SandboxCapability & { probing: boolean } {
  const p = (params ?? {}) as Record<string, unknown>;
  const force = asBoolean(p.force, false);
  startProbeIfNeeded(force);
  return {
    ...(sandboxProbeCache ?? { available: false, reason: "", checkedAt: "" }),
    probing: sandboxProbePending,
  };
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
      ["crontask.sandboxStatus", (p) => rpcSandboxStatus(p)],
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