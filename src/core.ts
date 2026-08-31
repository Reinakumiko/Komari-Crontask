/**
 * Pure, SDK-free helpers for the Cron Task plugin.
 * Kept dependency-free so they can be unit-tested in a plain Node process.
 */

/** Per-node result as returned by admin:getTaskResultsByTaskId. */
export type TaskResult = {
  client: string;
  result: string;
  exit_code: number | null;
  finished_at?: string;
};

/** 单次执行结果（统一形状：command 有节点结果，sandbox/action 单条） */
export type ActionResult = {
  client?: string;
  result: string;
  exit_code: number | null;
};

/** One settled execution round. */
export type HistoryEntry = {
  ts: string;
  taskId: string; // crontask task id
  name: string;
  type: TaskType;
  command: string; // 实际执行的命令/method 描述
  nodes?: string[];       // command 类型：目标节点
  execTaskId?: string;    // command 类型：系统 task_id
  timedOut: boolean;
  ok?: boolean;           // 是否成功（sandbox/action 简单判定）
  detail?: string;        // sandbox/action：单条结果摘要
  results: ActionResult[];
};

/** A user-defined cron task. */
/** 执行目标类型 */
export type TaskType = "command" | "sandbox" | "action";

export type Task = {
  id: string;
  name: string;
  cron: string;
  /** 执行目标: command(远程节点) | sandbox(server隔离环境) | action(Komari功能) */
  type: TaskType;
  /** command: 远程命令 + 目标节点 */
  command: string;
  nodes: string[];
  /** sandbox: server 本机沙箱命令 + 联网开关 */
  sandboxCommand: string;
  sandboxNetwork: boolean;
  /** sandbox: 隔离不可用时 true=报错（严格，默认）/ false=降级直接执行（宽松） */
  sandboxStrict: boolean;
  /** action: Komari 系统 RPC 方法 + 参数 */
  actionMethod: string;
  actionParams: string; // JSON 字符串
  timeout: number;
  notify: boolean;
  enabled: boolean;
  createdAt: string;
};

export const TIMEOUT_MIN = 1;
export const TIMEOUT_MAX = 3600;

/** Fixes compact "@every1m" into "@every 1m". */
export function normalizeCronExpression(expression: string): string {
  const trimmed = expression.trim();
  const compactEvery = trimmed.match(/^@every(\S+)$/i);
  return compactEvery ? `@every ${compactEvery[1]}` : trimmed;
}

/** Reads a string value with a fallback; trims surrounding whitespace. */
export function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : fallback;
}

/** Reads a boolean value with a fallback. */
export function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Reads a numeric value, clamped to [TIMEOUT_MIN, TIMEOUT_MAX]. */
export function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(TIMEOUT_MAX, Math.max(TIMEOUT_MIN, Math.round(n)));
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids.map((s) => s.trim()).filter((s) => s !== ""))];
}

/** Reads a node id list, deduplicated and trimmed. Accepts array or JSON string. */
export function asNodeIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return dedupe(value.filter((v): v is string => typeof v === "string" && v.trim() !== ""));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === "[]") return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return dedupe(parsed.filter((v): v is string => typeof v === "string" && v.trim() !== ""));
      }
    } catch {
      return [];
    }
  }
  return [];
}

/** Parses a raw task object from the management API into a Task. */
export function taskFromInput(
  input: Record<string, unknown>,
  now = new Date().toISOString(),
): Task {
  const rawType = String(input.type ?? "command");
  const type: TaskType =
    rawType === "sandbox" || rawType === "action" ? rawType : "command";
  return {
    id: asString(input.id, ""),
    name: asString(input.name, "Untitled task"),
    cron: asString(input.cron, ""),
    type,
    command: asString(input.command, ""),
    nodes: asNodeIds(input.nodes),
    sandboxCommand: asString(input.sandboxCommand, ""),
    sandboxNetwork: asBoolean(input.sandboxNetwork, false),
    sandboxStrict: asBoolean(input.sandboxStrict, true),
    actionMethod: asString(input.actionMethod, ""),
    actionParams: asString(input.actionParams, "{}"),
    timeout: asNumber(input.timeout, 300),
    notify: asBoolean(input.notify, true),
    enabled: asBoolean(input.enabled, true),
    createdAt: asString(input.createdAt, now),
  };
}

/** Validates a task; returns an error message string or null when OK. */
export function validateTask(task: Task): string | null {
  if (task.name === "") return "Task name is required";
  if (task.cron === "") return "Cron expression is required";
  const fields = task.cron.split(/\s+/).length;
  const isEvery = /^@every\b/i.test(normalizeCronExpression(task.cron));
  if (!isEvery && fields < 5) {
    return "Cron must be a 5/6-field expression or @every interval";
  }
  switch (task.type) {
    case "command":
      if (task.command === "") return "Command is required";
      if (task.nodes.length === 0) return "At least one target node is required";
      break;
    case "sandbox":
      if (task.sandboxCommand === "") return "Sandbox command is required";
      break;
    case "action":
      if (task.actionMethod === "") return "Action method is required";
      try { JSON.parse(task.actionParams || "{}"); }
      catch { return "Action params must be valid JSON"; }
      break;
  }
  return null;
}

/** Strips a result blob to a bounded single-line preview. */
export function previewResult(result: string): string {
  const s = String(result ?? "").replace(/\s+/g, " ").trim();
  return s.length > 500 ? s.slice(0, 500) + "…" : s;
}

/** True when the round counts as failed (any non-zero/unset exit or no runs). */
export function isFailure(results: TaskResult[]): boolean {
  if (results.length === 0) return true;
  return results.some(
    (r) => r.exit_code === null || r.exit_code === undefined || r.exit_code !== 0,
  );
}

/** Builds a history entry from a settled round (command type). */
export function buildHistoryEntry(
  task: Task,
  execTaskId: string,
  results: TaskResult[],
  timedOut: boolean,
  now = new Date().toISOString(),
): HistoryEntry {
  return {
    ts: now,
    taskId: task.id,
    name: task.name,
    type: task.type,
    command: task.command,
    nodes: task.nodes,
    execTaskId,
    timedOut,
    results: results.map((r) => ({
      client: r.client,
      result: r.result,
      exit_code: r.exit_code,
    })),
  };
}

/** Builds a single-result history entry (sandbox/action type). */
export function buildSingleHistoryEntry(
  task: Task,
  description: string,
  exitCode: number | null,
  timedOut: boolean,
  ok = exitCode === 0 || exitCode === null,
  now = new Date().toISOString(),
): HistoryEntry {
  return {
    ts: now,
    taskId: task.id,
    name: task.name,
    type: task.type,
    command: description,
    timedOut,
    ok,
    results: [{ result: description, exit_code: exitCode }],
  };
}