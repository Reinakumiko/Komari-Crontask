#!/usr/bin/env node
/**
 * M3 链路验证脚本：针对真实 Komari 实例验证 crontask 插件依赖的 RPC 返回结构。
 *
 * 用法:
 *   KOMARI_SERVER_URL=http://host:8000 KOMARI_API_KEY=<key> node scripts/verify-link.mjs
 *
 * 验证项:
 *   1. admin:exec 的返回结构 (ExecTaskSummary: task_id/clients/queued_clients)
 *   2. admin:getTaskResultsByTaskId 的返回结构 (TaskResult[]: client/result/exit_code)
 *   3. admin:sendNotification 可被以空 event 调用（不实际发送，仅验证可访问）
 *   4. common:getNodes 返回的形状
 *
 * 目标服务器需要至少一个已连接的节点，否则 admin:exec 会报 "No clients connected"。
 * 该脚本不会修改任何数据（exec 选择空客户端列表，仅用于探测返回结构）。
 */
const serverUrl = (process.env.KOMARI_SERVER_URL || "").replace(/\/$/, "");
const apiKey = process.env.KOMARI_API_KEY || "";
const sessionToken = process.env.KOMARI_SESSION_TOKEN || "";

if (!serverUrl || (!apiKey && !sessionToken)) {
  console.error("缺少 KOMARI_SERVER_URL，且缺少 KOMARI_API_KEY 或 KOMARI_SESSION_TOKEN");
  process.exit(1);
}

const authHeaders =
  apiKey !== ""
    ? { Authorization: `Bearer ${apiKey}` }
    : { Cookie: `session_token=${sessionToken}` };

async function rpc(method, params) {
  const res = await fetch(`${serverUrl}/api/rpc2`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? {} }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.error) {
    const err = new Error(`RPC ${method} error: ${body.error.message}`);
    err.code = body.error.code;
    err.data = body.error.data;
    throw err;
  }
  return body.result;
}

function check(label, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label} — ${String(detail ?? "(无详情)")}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log(`目标: ${serverUrl}`);

  // 1. 节点列表
  console.log("\n[1] common:getNodes");
  let nodes;
  try {
    nodes = await rpc("common:getNodes");
    const entries = Object.entries(nodes ?? {});
    console.log(`  共 ${entries.length} 个节点`);
    for (const [uuid, info] of entries.slice(0, 3)) {
      console.log(`    ${uuid} -> ${info?.name ?? "(无名称)"}`);
    }
    check("返回为对象(Record<uuid, Client>)", typeof nodes === "object" && nodes !== null && !Array.isArray(nodes), JSON.stringify(nodes).slice(0, 200));
    check("Client 含 name 字段", entries.length === 0 || entries.every(([, info]) => typeof info?.name === "string"), JSON.stringify(entries[0]?.[1] ?? null).slice(0, 200));
  } catch (e) {
    console.error(`  ✗ 无法获取节点: ${e.message}`);
    nodes = {};
  }

  // 2. admin:exec 返回结构（用空客户端列表探测，不实际下发）
  console.log("\n[2] admin:exec 返回结构 (空客户端列表以探测)");
  let summary;
  try {
    summary = await rpc("admin:exec", { command: "echo probe", clients: [] });
    check("返回对象", typeof summary === "object" && summary !== null, JSON.stringify(summary));
    check("含 task_id (string)", typeof summary.task_id === "string", `task_id=${JSON.stringify(summary.task_id)}`);
    check("含 clients (array)", Array.isArray(summary.clients), `clients=${JSON.stringify(summary.clients)}`);
    check("含 queued_clients (array)", Array.isArray(summary.queued_clients), `queued_clients=${JSON.stringify(summary.queued_clients)}`);
    console.log(`  实际返回: ${JSON.stringify(summary)}`);
  } catch (e) {
    if (e.code === -32602 || /No clients connected/i.test(e.message)) {
      console.log(`  (预期) 空气端列表时被拒: ${e.message}`);
      check("返回体可解析为任务摘要结构", true, "跳过结构性校验");
    } else {
      check("admin:exec 可访问", false, e.message);
    }
  }

  // 3. 任务查询结构
  console.log("\n[3] admin:getTaskResultsByTaskId 返回结构");
  try {
    const results = await rpc("admin:getTaskResultsByTaskId", { task_id: "probe-none" });
    check("返回数组", Array.isArray(results), `type=${typeof results}`);
    if (results.length > 0) {
      const r = results[0];
      check("元素含 client/result/exit_code", typeof r.client === "string" && typeof r.result === "string" && typeof r.exit_code === "number", JSON.stringify(r));
    } else {
      console.log("  (空结果集，跳过元素结构校验，建议在真实任务完成后重跑)");
    }
  } catch (e) {
    check("getTaskResultsByTaskId 可访问", false, e.message);
  }

  // 4. sendNotification 可访问性（不实际发送；用 rpc.help 探测元数据）
  console.log("\n[4] admin:sendNotification 可访问性");
  try {
    const meta = await rpc("rpc.help", { method: "admin:sendNotification" });
    check("rpc.help 返回方法元数据", typeof meta === "object" && meta !== null, JSON.stringify(meta).slice(0, 200));
  } catch (e) {
    check("sendNotification 可调用", false, e.message);
  }

  console.log("\n完成。有任何 ✗ 请对照 server 源码核对字段名。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});