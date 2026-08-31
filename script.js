"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __commonJS = (cb, mod) => function __require2() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // node_modules/@komari-monitor/plugin-sdk/src/manifest.js
  var require_manifest = __commonJS({
    "node_modules/@komari-monitor/plugin-sdk/src/manifest.js"(exports, module) {
      "use strict";
      function isObject(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
      }
      function hasText(value) {
        if (typeof value === "string") return value.trim().length > 0;
        if (!isObject(value)) return false;
        return Object.values(value).some((item) => typeof item === "string" && item.trim());
      }
      function isLocalPath(value) {
        if (typeof value !== "string" || !value) return false;
        const normalized = value.replaceAll("\\", "/");
        if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return false;
        return !normalized.split("/").some((part) => part === "..") && normalized !== ".";
      }
      function validateManifest(manifest) {
        const errors = [];
        if (!isObject(manifest)) return ["manifest must be an object"];
        if (!hasText(manifest.name)) errors.push("name is required");
        if (typeof manifest.short !== "string" || !/^[A-Za-z0-9_-]+$/.test(manifest.short) || manifest.short === "default") {
          errors.push("short must contain only letters, digits, '_' and '-', and cannot be 'default'");
        }
        if (manifest.entry !== void 0 && !isLocalPath(manifest.entry)) {
          errors.push("entry must be a relative path inside the plugin directory");
        }
        if (manifest.icon !== void 0 && manifest.icon !== "" && !isLocalPath(manifest.icon)) {
          errors.push("icon must be a relative path inside the plugin directory");
        }
        if (manifest.version !== void 0 && typeof manifest.version !== "string") {
          errors.push("version must be a string");
        }
        if (manifest.komari !== void 0 && typeof manifest.komari !== "string") {
          errors.push("komari must be a string");
        }
        if (manifest.configuration !== void 0) {
          if (!isObject(manifest.configuration) || manifest.configuration.type !== "managed" || !Array.isArray(manifest.configuration.data)) {
            errors.push("configuration must be a managed configuration with a data array");
          } else {
            const itemTypes = /* @__PURE__ */ new Set(["string", "number", "select", "switch", "title", "textbox", "richtext", "nodes", "pingtasks"]);
            manifest.configuration.data.forEach((item, index) => {
              if (!isObject(item)) {
                errors.push(`configuration.data[${index}] must be an object`);
                return;
              }
              if (item.type !== "title" && item.type !== "textbox" && (typeof item.key !== "string" || !item.key.trim())) errors.push(`configuration.data[${index}].key is required`);
              if (!hasText(item.name)) errors.push(`configuration.data[${index}].name is required`);
              if (!itemTypes.has(item.type)) errors.push(`configuration.data[${index}].type is invalid`);
            });
          }
        }
        if (manifest.permissions !== void 0) {
          if (!isObject(manifest.permissions)) {
            errors.push("permissions must be an object");
          } else {
            const booleanKeys = [
              "node",
              "allowSystemRPC",
              "allowRoutes",
              "allowHooks",
              "allowHTMLInject",
              "allowExec",
              "allowListen",
              "allowAllFileAccess"
            ];
            for (const key of booleanKeys) {
              if (manifest.permissions[key] !== void 0 && typeof manifest.permissions[key] !== "boolean") {
                errors.push(`permissions.${key} must be a boolean`);
              }
            }
            for (const key of ["maxHTTPBodyBytes", "maxChildOutputBytes", "timeout"]) {
              if (manifest.permissions[key] !== void 0 && (!Number.isInteger(manifest.permissions[key]) || manifest.permissions[key] < 0)) {
                errors.push(`permissions.${key} must be a non-negative integer`);
              }
            }
          }
        }
        if (manifest.pages !== void 0) {
          if (!Array.isArray(manifest.pages)) {
            errors.push("pages must be an array");
          } else {
            manifest.pages.forEach((page, index) => {
              const prefix = `pages[${index}]`;
              if (!isObject(page)) {
                errors.push(`${prefix} must be an object`);
                return;
              }
              if (!hasText(page.title)) errors.push(`${prefix}.title is required`);
              const type = page.type || "iframe";
              const visibility = page.visibility || "admin";
              if (type !== "iframe" && type !== "redirect") errors.push(`${prefix}.type must be iframe or redirect`);
              if (visibility !== "admin" && visibility !== "public") errors.push(`${prefix}.visibility must be admin or public`);
              if (page.icon && !isLocalPath(page.icon)) errors.push(`${prefix}.icon must be a relative path`);
              if (type === "iframe" && !isLocalPath(page.file)) errors.push(`${prefix}.file must be a relative path`);
              if (type === "redirect" && !isSafeInternalPath(page.url)) errors.push(`${prefix}.url must be a safe internal path`);
            });
          }
        }
        return errors;
      }
      function isSafeInternalPath(value) {
        if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return false;
        if (value.includes("\\") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false;
        return !value.split("/").includes("..");
      }
      function assertValidManifest(manifest) {
        const errors = validateManifest(manifest);
        if (errors.length > 0) throw new Error(errors.join("; "));
        return manifest;
      }
      module.exports = { assertValidManifest, validateManifest };
    }
  });

  // node_modules/@komari-monitor/plugin-sdk/src/rpc.js
  var require_rpc = __commonJS({
    "node_modules/@komari-monitor/plugin-sdk/src/rpc.js"(exports, module) {
      "use strict";
      function createRpcClient(getServer) {
        const methods = (includeInternal = false) => getServer().call("rpc.methods", { internal: includeInternal });
        return {
          call(method, ...params) {
            return getServer().call(method, ...params);
          },
          methods,
          has(method) {
            return methods(true).then((registered) => registered.includes(method));
          },
          help(method) {
            return getServer().call("rpc.help", { method });
          }
        };
      }
      module.exports = { createRpcClient };
    }
  });

  // node_modules/@komari-monitor/plugin-sdk/schema/komari-plugin.schema.json
  var require_komari_plugin_schema = __commonJS({
    "node_modules/@komari-monitor/plugin-sdk/schema/komari-plugin.schema.json"(exports, module) {
      module.exports = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://komari-monitor.github.io/plugin-sdk/komari-plugin.schema.json",
        title: "Komari Plugin Manifest",
        description: "Komari plugin manifest.",
        type: "object",
        required: ["name", "short"],
        properties: {
          $schema: { type: "string", description: "Schema URL used for editor validation." },
          name: { $ref: "#/$defs/localizedText", description: "Display name shown in Komari." },
          short: { type: "string", pattern: "^(?!default$)[A-Za-z0-9_-]+$", description: "Stable plugin identifier used in routes and RPC names." },
          description: { $ref: "#/$defs/localizedText", description: "Human-readable plugin description." },
          author: { $ref: "#/$defs/localizedText", description: "Plugin author or organization." },
          version: { type: "string", description: "Plugin version." },
          url: { type: "string", format: "uri", description: "Project or documentation URL." },
          icon: { type: "string", description: "Icon URL or plugin-relative icon path." },
          komari: { type: "string", description: "Compatible Komari version constraint, such as `>=1.4.0`." },
          entry: { type: "string", default: "script.js", description: "Compiled plugin entry file, relative to the package root." },
          permissions: { $ref: "#/$defs/permissions", description: "Runtime permissions requested by the plugin." },
          configuration: {
            type: "object",
            required: ["type", "data"],
            properties: {
              type: { const: "managed", description: "Use Komari-managed configuration storage." },
              data: { type: "array", items: { $ref: "#/$defs/configurationItem" }, description: "Configuration items shown in the admin UI." }
            },
            additionalProperties: false,
            description: "Optional configuration schema rendered by Komari."
          },
          pages: { type: "array", items: { $ref: "#/$defs/page" }, description: "Admin or public pages contributed by the plugin." }
        },
        additionalProperties: false,
        $defs: {
          localizedText: {
            description: "A string or a language-to-string map.",
            oneOf: [
              { type: "string", minLength: 1 },
              { type: "object", minProperties: 1, additionalProperties: { type: "string" } }
            ]
          },
          permissions: {
            description: "Capabilities that must be approved before enabling the plugin.",
            type: "object",
            properties: {
              node: { type: "boolean", description: "Enable Node.js-compatible modules." },
              allowSystemRPC: { type: "boolean", description: "Allow calls to system RPC methods." },
              allowRoutes: { type: "boolean", description: "Allow HTTP routes and static files." },
              allowHooks: { type: "boolean", description: "Allow request and response hooks." },
              allowHTMLInject: { type: "boolean", description: "Allow HTML head/body injection." },
              allowExec: { type: "boolean", description: "Allow child process execution." },
              allowListen: { type: "boolean", description: "Allow the plugin to listen on a local port." },
              allowAllFileAccess: { type: "boolean", description: "Allow file access outside the plugin directory." },
              maxHTTPBodyBytes: { type: "integer", minimum: 0, description: "Maximum request body size in bytes." },
              maxChildOutputBytes: { type: "integer", minimum: 0, description: "Maximum captured child process output in bytes." },
              timeout: { type: "integer", minimum: 0, description: "Plugin execution timeout in seconds." }
            },
            additionalProperties: false
          },
          page: {
            description: "A page exposed by the plugin.",
            type: "object",
            required: ["title"],
            properties: {
              file: { type: "string", description: "Page file relative to the plugin package." },
              title: { $ref: "#/$defs/localizedText", description: "Page title shown in navigation." },
              icon: { type: "string", description: "Page icon name or URL." },
              type: { enum: ["iframe", "redirect"], description: "Page presentation mode." },
              url: { type: "string", description: "Target URL for redirect pages." },
              visibility: { enum: ["admin", "public"], description: "Whether the page is visible to admins or the public." }
            },
            additionalProperties: false
          },
          configurationItem: {
            description: "One managed configuration field.",
            type: "object",
            required: ["name", "type"],
            properties: {
              key: { type: "string", minLength: 1, description: "Stable configuration key." },
              name: { $ref: "#/$defs/localizedText", description: "Label shown in the configuration UI." },
              type: { enum: ["string", "number", "select", "switch", "title", "textbox", "richtext", "nodes", "pingtasks"], description: "Editor control type." },
              options: { type: "string", description: "Options for select controls." },
              default: { description: "Default value." },
              required: { type: "boolean", description: "Whether a value is required." },
              help: { $ref: "#/$defs/localizedText", description: "Help text shown below the field." }
            },
            allOf: [
              {
                if: { properties: { type: { enum: ["title", "textbox"] } } },
                then: {},
                else: { required: ["key"] }
              }
            ],
            additionalProperties: false
          }
        }
      };
    }
  });

  // node_modules/@komari-monitor/plugin-sdk/src/rpc-catalog.json
  var require_rpc_catalog = __commonJS({
    "node_modules/@komari-monitor/plugin-sdk/src/rpc-catalog.json"(exports, module) {
      module.exports = {
        komari: "1.4.x",
        "rpc.methods": { params: "{ internal?: boolean }", returns: "string[]" },
        "rpc.version": { params: "none", returns: "string" },
        "rpc.ping": { params: "none", returns: "string ('pong')" },
        "rpc.help": { params: "{ method?: string }", returns: "MethodMeta | MethodMeta[]" },
        "common:getNodes": { params: "{ uuid?: string }", returns: "Client | Record<string, Client>" },
        "common:getNodesLatestStatus": { params: "{ uuid?: string, uuids?: string[] }", returns: "Record<string, unknown>" },
        "common:getMe": { params: "none", returns: "CurrentUser" },
        "common:getPublicInfo": { params: "none", returns: "PublicInfo" },
        "common:getVersion": { params: "none", returns: "{ version: string, hash: string }" },
        "common:getNodeRecentStatus": { params: "{ uuid: string }", returns: "{ count: number, records: unknown[] }" },
        "common:getRecords": { params: "RecordQuery", returns: "RecordQueryResponse" },
        "public:getMe": { params: "none", returns: "CurrentUser" },
        "public:getNodesInformation": { params: "none", returns: "Client[]" },
        "public:getPublicSettings": { params: "none", returns: "PublicInfo" },
        "public:getVersion": { params: "none", returns: "{ version: string, hash: string }" },
        "public:getClientRecentRecords": { params: "{ uuid: string }", returns: "unknown" },
        "public:getRecordsByUUID": { params: "{ uuid: string, load_type?: string, hours?: string }", returns: "{ records: unknown[], count: number }" },
        "public:getPingRecords": { params: "{ uuid?: string, task_id?: string | number }", returns: "{ records: unknown[], count: number }" },
        "public:getPublicPingTasks": { params: "none", returns: "PingTask[]" },
        "public:recordVisitorEvent": { params: "{ event: string, action?: string, path?: string, route?: string, target?: string, detail?: object }", returns: "{ status: string }" },
        "public:listMetricDefinitions": { params: "none", returns: "MetricDefinition[]" },
        "public:queryMetrics": { params: "MetricQuery", returns: "MetricSeriesResponse" },
        "public:getPingMetricStats": { params: "PingMetricStatsQuery", returns: "PingMetricStatsResponse" },
        "admin:addClient": { params: "{ name?: string }", returns: "{ uuid: string, token: string }" },
        "admin:editClient": { params: "{ uuid: string, ...fields }", returns: "null" },
        "admin:removeClient": { params: "{ uuid: string }", returns: "null" },
        "admin:getClient": { params: "{ uuid: string }", returns: "Client" },
        "admin:listClients": { params: "none", returns: "Client[]" },
        "admin:getClientToken": { params: "{ uuid: string }", returns: "{ token: string }" },
        "admin:clearRecords": { params: "none", returns: "null" },
        "admin:getTasks": { params: "none", returns: "ExecTask[]" },
        "admin:getTaskById": { params: "{ task_id: string }", returns: "ExecTask" },
        "admin:getTasksByClientId": { params: "{ uuid: string }", returns: "ExecTask[]" },
        "admin:getSpecificTaskResult": { params: "{ task_id: string, uuid: string }", returns: "TaskResult" },
        "admin:getTaskResultsByTaskId": { params: "{ task_id: string }", returns: "TaskResult[]" },
        "admin:exec": { params: "{ command: string, clients: string[] }", returns: "{ task_id: string, clients: string[], queued_clients: string[] }" },
        "admin:addPingTask": { params: "AddPingTaskParams", returns: "{ task_id: number }" },
        "admin:deletePingTask": { params: "{ id: number[] }", returns: "null" },
        "admin:editPingTask": { params: "{ tasks: PingTask[] }", returns: "null" },
        "admin:getAllPingTasks": { params: "none", returns: "PingTask[]" },
        "admin:orderPingTask": { params: "Record<string, number>", returns: "null" },
        "admin:addLoadNotification": { params: "AddLoadNotificationParams", returns: "{ task_id: number }" },
        "admin:deleteLoadNotification": { params: "{ id: number[] }", returns: "null" },
        "admin:editLoadNotification": { params: "{ notifications: LoadNotification[] }", returns: "null" },
        "admin:getAllLoadNotifications": { params: "none", returns: "LoadNotification[]" },
        "admin:listOfflineNotifications": { params: "none", returns: "OfflineNotification[]" },
        "admin:editOfflineNotification": { params: "OfflineNotification[]", returns: "null" },
        "admin:enableOfflineNotification": { params: "string[]", returns: "null" },
        "admin:disableOfflineNotification": { params: "string[]", returns: "null" },
        "admin:listTrafficReportNotifications": { params: "none", returns: "TrafficReportNotification[]" },
        "admin:editTrafficReportNotifications": { params: "TrafficReportNotification[]", returns: "null" },
        "admin:enableTrafficReportNotifications": { params: "string[]", returns: "null" },
        "admin:disableTrafficReportNotifications": { params: "string[]", returns: "null" },
        "admin:sendNotification": { params: "{ event: { event?: any, message?: any, emoji?: any, time?: string, clients?: { uuid: string }[] } }", returns: "null" },
        "admin:getSessions": { params: "none", returns: "{ current: string, data: Session[] }" },
        "admin:deleteSession": { params: "{ session: string }", returns: "null" },
        "admin:deleteAllSessions": { params: "none", returns: "null" },
        "admin:getSettings": { params: "none", returns: "object" },
        "admin:editSettings": { params: "Record<string, unknown>", returns: "null | { restart_required: true, guide_path: string }" },
        "admin:clearAllRecords": { params: "none", returns: "null" },
        "admin:orderClients": { params: "Record<string, number>", returns: "null" },
        "admin:getLogs": { params: "{ limit?: string, page?: string, msg_type?: string }", returns: "{ logs: Log[], total: number }" },
        "admin:testSendMessage": { params: "none", returns: "null" },
        "admin:testGeoip": { params: "{ ip?: string }", returns: "GeoInfo" },
        "admin:listPlugins": { params: "none", returns: "PluginStatus[]" },
        "admin:setPluginEnabled": { params: "{ short: string, enabled: boolean, approved?: boolean }", returns: "null | { requires_approval: true }" },
        "admin:getPluginLogs": { params: "{ short: string }", returns: "{ logs: string }" },
        "admin:deletePlugin": { params: "{ short: string }", returns: "null" },
        "admin:getPluginConfiguration": { params: "{ short: string }", returns: "{ configuration: object, data: object }" },
        "admin:setPluginConfiguration": { params: "{ short: string, data: object }", returns: "null" },
        "admin:getXtermjsSettings": { params: "none", returns: "XtermJSSettings" },
        "admin:setXtermjsSettings": { params: "XtermJSSettings", returns: "XtermJSSettings" },
        "admin:getMessageSenderProvider": { params: "{ provider?: string }", returns: "MessageSenderProvider | MessageSenderProvider[]" },
        "admin:setMessageSenderProvider": { params: "MessageSenderProvider", returns: "{ message: string }" },
        "admin:getOidcProvider": { params: "{ provider?: string }", returns: "OidcProvider | OidcProvider[]" },
        "admin:setOidcProvider": { params: "OidcProvider", returns: "{ message: string }" },
        "admin:getClipboard": { params: "{ id: string }", returns: "Clipboard" },
        "admin:listClipboard": { params: "none", returns: "Clipboard[]" },
        "admin:createClipboard": { params: "Clipboard", returns: "Clipboard" },
        "admin:updateClipboard": { params: "Clipboard", returns: "Clipboard" },
        "admin:deleteClipboard": { params: "{ id: string }", returns: "null" },
        "admin:batchDeleteClipboard": { params: "{ ids: string[] }", returns: "null" },
        "admin:getDatabaseSize": { params: "none", returns: "DatabaseStatus" },
        "admin:vacuumDatabase": { params: "none", returns: "DatabaseMaintenanceResponse" },
        "admin:dbQuery": { params: '{ database?: "main" | "metrics", sql: string, args?: any[], limit?: number }', returns: "DatabaseQueryResult" },
        "admin:dbExec": { params: '{ database?: "main" | "metrics", sql: string, args?: any[] }', returns: "DatabaseExecResult" },
        "admin:dbTables": { params: '{ database?: "main" | "metrics" }', returns: "DatabaseTablesResult" },
        "admin:listMetricDefinitions": { params: "none", returns: "MetricDefinition[]" },
        "admin:updateMetricDefinition": { params: "{ name: string, retention_days: number }", returns: "MetricDefinition" },
        "admin:getMetricMigrationStatus": { params: "none", returns: "MetricMigrationStatus" },
        "admin:startMetricMigration": { params: "{ source_driver?: string, source_dsn?: string }", returns: "{ status: string, message: string }" },
        "admin:cancelMetricMigration": { params: "none", returns: "{ status: string, message: string }" },
        "client:getPingTasks": { params: "none", returns: "PingTask[]" },
        "client:uploadPingResult": { params: "UploadPingResultParams", returns: "{ status: string }" },
        "client:taskResult": { params: "TaskResultParams", returns: "{ status: string, message: string }" }
      };
    }
  });

  // node_modules/@komari-monitor/plugin-sdk/src/index.js
  var require_src = __commonJS({
    "node_modules/@komari-monitor/plugin-sdk/src/index.js"(exports, module) {
      "use strict";
      var { assertValidManifest, validateManifest } = require_manifest();
      var { createRpcClient } = require_rpc();
      var manifestSchema = require_komari_plugin_schema();
      var rpcCatalog = require_rpc_catalog();
      var cachedServer;
      function getServer() {
        if (!cachedServer) {
          cachedServer = __require("server");
        }
        return cachedServer;
      }
      function definePlugin2(definition) {
        if (!definition || typeof definition !== "object") {
          throw new TypeError("definePlugin requires a plugin definition object");
        }
        const load = typeof definition.load === "function" ? definition.load : () => {
        };
        const unload = typeof definition.unload === "function" ? definition.unload : () => {
        };
        globalThis.load = load;
        globalThis.unload = unload;
        return definition;
      }
      function jsonResponse(res, value, statusCode = 200) {
        res.statusCode = statusCode;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(value));
        return res;
      }
      function textResponse(res, value, statusCode = 200, contentType = "text/plain; charset=utf-8") {
        res.statusCode = statusCode;
        res.setHeader("Content-Type", contentType);
        res.end(String(value));
        return res;
      }
      var exportsObject = {
        assertValidManifest,
        definePlugin: definePlugin2,
        jsonResponse,
        manifestSchema,
        rpc: createRpcClient(getServer),
        rpcCatalog,
        textResponse,
        validateManifest
      };
      Object.defineProperty(exportsObject, "server", {
        enumerable: true,
        get: getServer
      });
      module.exports = exportsObject;
    }
  });

  // src/plugin.ts
  var import_plugin_sdk = __toESM(require_src());

  // src/core.ts
  var TIMEOUT_MIN = 1;
  var TIMEOUT_MAX = 3600;
  function normalizeCronExpression(expression) {
    const trimmed = expression.trim();
    const compactEvery = trimmed.match(/^@every(\S+)$/i);
    return compactEvery ? `@every ${compactEvery[1]}` : trimmed;
  }
  function asString(value, fallback) {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
  }
  function asBoolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }
  function asNumber(value, fallback) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(TIMEOUT_MAX, Math.max(TIMEOUT_MIN, Math.round(n)));
  }
  function dedupe(ids) {
    return [...new Set(ids.map((s) => s.trim()).filter((s) => s !== ""))];
  }
  function asNodeIds(value) {
    if (Array.isArray(value)) {
      return dedupe(value.filter((v) => typeof v === "string" && v.trim() !== ""));
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "" || trimmed === "[]") return [];
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return dedupe(parsed.filter((v) => typeof v === "string" && v.trim() !== ""));
        }
      } catch {
        return [];
      }
    }
    return [];
  }
  function taskFromInput(input, now = (/* @__PURE__ */ new Date()).toISOString()) {
    const rawType = String(input.type ?? "command");
    const type = rawType === "sandbox" || rawType === "action" ? rawType : "command";
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
      createdAt: asString(input.createdAt, now)
    };
  }
  function validateTask(task) {
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
        try {
          JSON.parse(task.actionParams || "{}");
        } catch {
          return "Action params must be valid JSON";
        }
        break;
    }
    return null;
  }
  function previewResult(result) {
    const s = String(result ?? "").replace(/\s+/g, " ").trim();
    return s.length > 500 ? s.slice(0, 500) + "\u2026" : s;
  }
  function isFailure(results) {
    if (results.length === 0) return true;
    return results.some(
      (r) => r.exit_code === null || r.exit_code === void 0 || r.exit_code !== 0
    );
  }
  function buildHistoryEntry(task, execTaskId, results, timedOut, now = (/* @__PURE__ */ new Date()).toISOString()) {
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
        exit_code: r.exit_code
      }))
    };
  }
  function buildSingleHistoryEntry(task, description, exitCode, timedOut, ok = exitCode === 0 || exitCode === null, now = (/* @__PURE__ */ new Date()).toISOString()) {
    return {
      ts: now,
      taskId: task.id,
      name: task.name,
      type: task.type,
      command: description,
      timedOut,
      ok,
      results: [{ result: description, exit_code: exitCode }]
    };
  }

  // src/plugin.ts
  var TASKS_FILE = `${__storageDir__}/tasks.json`;
  var HISTORY_FILE = `${__storageDir__}/history.json`;
  var AUDIT_FILE = `${__storageDir__}/audit.json`;
  var HISTORY_LIMIT = 200;
  var AUDIT_LIMIT = 500;
  var POLL_INTERVAL_MS = 2e3;
  var inFlight = /* @__PURE__ */ new Set();
  function readJsonFileSync(path, fallback) {
    try {
      const fs = __require("fs");
      const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
      return parsed;
    } catch {
      return fallback;
    }
  }
  function writeJsonFileSync(path, data) {
    const fs = __require("fs");
    fs.writeFileSync(path, JSON.stringify(data), "utf8");
  }
  function loadTasksSync() {
    return readJsonFileSync(TASKS_FILE, []);
  }
  function loadHistorySync() {
    const items = readJsonFileSync(HISTORY_FILE, []);
    return items.map((it) => ({
      ...it,
      type: it.type ?? "command",
      results: it.results ?? []
    }));
  }
  function loadAuditSync() {
    return readJsonFileSync(AUDIT_FILE, []);
  }
  function appendAuditSync(entry) {
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
  function appendHistorySync(entry) {
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
  function persistTasksSync(tasks) {
    writeJsonFileSync(TASKS_FILE, tasks);
    syncCrons(tasks);
  }
  var registeredCrons = /* @__PURE__ */ new Set();
  function dispatchByExpression(expr) {
    const pending = [];
    for (const task of loadTasksSync()) {
      if (!task.enabled) continue;
      if (normalizeCronExpression(task.cron) !== expr) continue;
      if (!isTaskExecutable(task)) continue;
      pending.push(dispatchTask(task));
    }
    return Promise.all(pending);
  }
  function syncCrons(tasks) {
    for (const task of tasks) {
      if (!task.enabled) continue;
      const expr = normalizeCronExpression(task.cron);
      if (expr === "") continue;
      if (registeredCrons.has(expr)) continue;
      try {
        import_plugin_sdk.server.cron(expr, () => dispatchByExpression(expr));
        registeredCrons.add(expr);
        console.log(`[crontask] scheduled cron ${expr}`);
      } catch (err) {
        console.log(`[crontask] bad cron "${expr}": ${String(err)}`);
      }
    }
  }
  async function nodeInfoMap() {
    const names = /* @__PURE__ */ new Map();
    try {
      const nodes = await import_plugin_sdk.server.call("common:getNodes");
      for (const [uuid, info] of Object.entries(nodes)) {
        names.set(uuid, info);
      }
    } catch {
    }
    return names;
  }
  function isTaskExecutable(t) {
    switch (t.type) {
      case "command":
        return t.command !== "" && t.nodes.length > 0;
      case "sandbox":
        return t.sandboxCommand !== "";
      case "action":
        return t.actionMethod !== "";
      default:
        return false;
    }
  }
  async function notifyFailure(task, message, clients) {
    if (!task.notify) return;
    try {
      await import_plugin_sdk.server.call("admin:sendNotification", {
        event: {
          event: "TaskFailed",
          message,
          emoji: "\u26A0\uFE0F",
          time: (/* @__PURE__ */ new Date()).toISOString(),
          ...clients?.length ? { clients: clients.map((uuid) => ({ uuid })) } : {}
        }
      });
    } catch (e) {
      console.log(`[crontask] notify failed: ${String(e)}`);
    }
  }
  async function dispatchTask(task) {
    if (inFlight.has(task.id)) {
      console.log(`[crontask] task ${task.id} still running, skipping this fire`);
      return;
    }
    inFlight.add(task.id);
    try {
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
  async function dispatchRemoteTask(effective) {
    let taskId;
    try {
      const summary = await import_plugin_sdk.server.call("admin:exec", {
        command: effective.command,
        clients: effective.nodes
      });
      taskId = summary.task_id;
    } catch (err) {
      console.log(`[crontask] task ${effective.id} exec failed: ${String(err)}`);
      await notifyFailure(effective, `[Cron Task] ${effective.name}
Exec failed: ${String(err)}`);
      return;
    }
    const { results, timedOut } = await pollTaskResults(
      taskId,
      effective.nodes,
      effective.timeout
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
  function ensureExecutable(...paths) {
    try {
      const fs = __require("fs");
      for (const p of paths) {
        try {
          fs.chmodSync(p, 493);
        } catch {
        }
      }
    } catch {
    }
  }
  var sandboxProbeCache = null;
  var sandboxProbePending = false;
  function sandboxBins() {
    const sandboxDir = `${__dirname}/sandbox`;
    return {
      bwrapBin: `${sandboxDir}/bin/bwrap`,
      busyboxBin: `${sandboxDir}/bin/busybox`
    };
  }
  async function probeSandboxCapability(force = false) {
    if (sandboxProbeCache && !force) return sandboxProbeCache;
    try {
      const { bwrapBin, busyboxBin } = sandboxBins();
      ensureExecutable(bwrapBin, busyboxBin);
      const r = await spawnCS(
        bwrapBin,
        [
          "--ro-bind",
          "/",
          "/",
          "--dev",
          "/dev",
          "--proc",
          "/proc",
          "--unshare-net",
          "--unshare-pid",
          busyboxBin,
          "true"
        ],
        { env: envSafe(), timeout: 15e3 }
      );
      sandboxProbeCache = r.exitCode === 0 ? { available: true, reason: "", checkedAt: (/* @__PURE__ */ new Date()).toISOString() } : {
        available: false,
        reason: (r.stderr || `bwrap exit ${r.exitCode}`).trim().slice(0, 160),
        checkedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    } catch (err) {
      sandboxProbeCache = {
        available: false,
        reason: String(err).slice(0, 160),
        checkedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    sandboxProbePending = false;
    console.log(
      `[crontask] sandbox probe: available=${sandboxProbeCache.available}${sandboxProbeCache.reason ? ` (${sandboxProbeCache.reason})` : ""}`
    );
    return sandboxProbeCache;
  }
  function startProbeIfNeeded(force) {
    if (sandboxProbePending || sandboxProbeCache && !force) return;
    sandboxProbePending = true;
    void probeSandboxCapability(force).catch(() => {
      sandboxProbePending = false;
    });
  }
  async function dispatchSandboxTask(effective) {
    try {
      const { bwrapBin, busyboxBin } = sandboxBins();
      ensureExecutable(bwrapBin, busyboxBin);
      const cap = await probeSandboxCapability();
      let result;
      let isolated = true;
      if (cap.available) {
        const bwrapArgs = [
          "--ro-bind",
          "/",
          "/",
          "--tmpfs",
          "/tmp",
          "--proc",
          "/proc",
          "--dev",
          "/dev",
          "--unshare-pid",
          "--unshare-ipc",
          "--unshare-uts"
        ];
        bwrapArgs.push(effective.sandboxNetwork ? "--share-net" : "--unshare-net");
        bwrapArgs.unshift("--unshare-user-try");
        result = await spawnCS(
          bwrapBin,
          [...bwrapArgs, busyboxBin, "sh", "-c", effective.sandboxCommand],
          { env: envSafe(), timeout: effective.timeout * 1e3 }
        );
      } else if (effective.sandboxStrict) {
        throw new Error(
          `\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u6C99\u7BB1\u9694\u79BB\uFF08${cap.reason}\uFF09\u3002\u89E3\u6CD5\uFF1A\u4EE5 --security-opt seccomp=unconfined \u6216 --privileged \u8FD0\u884C Komari \u5BB9\u5668\uFF0C\u6216\u5728\u88F8\u673A\u90E8\u7F72\uFF1B\u6216\u5728\u4EFB\u52A1\u4E2D\u6539\u7528\u5BBD\u677E\u6A21\u5F0F\uFF08\u9694\u79BB\u4E0D\u53EF\u7528\u65F6\u76F4\u63A5\u6267\u884C\uFF09`
        );
      } else {
        isolated = false;
        result = await spawnCS(busyboxBin, ["sh", "-c", effective.sandboxCommand], {
          env: envSafe(),
          timeout: effective.timeout * 1e3
        });
      }
      const ok = result.exitCode === 0;
      const prefix = isolated ? "" : "\u26A0\uFE0F \u9694\u79BB\u4E0D\u53EF\u7528\uFF0C\u672C\u6B21\u4E3A\u76F4\u63A5\u6267\u884C\uFF08\u975E\u6C99\u7BB1\uFF09\n";
      const entry = buildSingleHistoryEntry(
        effective,
        ok ? isolated ? "\u6C99\u7BB1\u6267\u884C\u6210\u529F" : "\u6267\u884C\u6210\u529F\uFF08\u5BBD\u677E\u6A21\u5F0F\uFF0C\u65E0\u9694\u79BB\uFF09" : `\u6267\u884C\u5931\u8D25 (exit ${result.exitCode})`,
        result.exitCode,
        false,
        ok,
        (/* @__PURE__ */ new Date()).toISOString()
      );
      entry.detail = (prefix + result.stdout + result.stderr).slice(0, 1e3);
      appendHistorySync(entry);
      if (!ok) {
        await notifyFailure(effective, `[Cron Task] ${effective.name}
\u6C99\u7BB1\u547D\u4EE4\u9000\u51FA\u7801 ${result.exitCode}
${entry.detail}`);
      } else {
        console.log(`[crontask] task ${effective.id} sandbox ok (isolated=${isolated})`);
      }
    } catch (err) {
      await notifyFailure(effective, `[Cron Task] ${effective.name}
\u6C99\u7BB1\u6267\u884C\u5931\u8D25: ${String(err)}`);
      const entry = buildSingleHistoryEntry(effective, `\u6C99\u7BB1\u6267\u884C\u5931\u8D25: ${String(err)}`, -2, false, false, (/* @__PURE__ */ new Date()).toISOString());
      appendHistorySync(entry);
    }
  }
  async function spawnCS(command, args, options) {
    const cp = __require("child_process");
    return await new Promise((resolve, reject) => {
      const child = cp.spawn(command, args, {
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "", stderr = "";
      child.stdout?.on("data", (d) => {
        stdout += String(d ?? "");
      });
      child.stderr?.on("data", (d) => {
        stderr += String(d ?? "");
      });
      const t = options.timeout ? setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
        }
        reject(new Error("sandbox timeout"));
      }, options.timeout) : void 0;
      child.on("error", (e) => {
        if (t) clearTimeout(t);
        reject(e);
      });
      child.on("close", (code) => {
        if (t) clearTimeout(t);
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });
    });
  }
  function envSafe() {
    return {
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      LANG: "C.UTF-8"
    };
  }
  async function dispatchActionTask(effective) {
    const method = effective.actionMethod.trim();
    let params;
    try {
      params = JSON.parse(effective.actionParams || "{}");
    } catch {
      await notifyFailure(effective, `[Cron Task] ${effective.name}
Action \u53C2\u6570\u4E0D\u662F\u5408\u6CD5 JSON`);
      return;
    }
    try {
      const result = await import_plugin_sdk.server.call(method, params);
      const summary = summarizeActionResult(result);
      const entry = buildSingleHistoryEntry(
        effective,
        `\u8C03\u7528 ${method}\uFF1A${summary}`,
        0,
        false,
        true,
        (/* @__PURE__ */ new Date()).toISOString()
      );
      entry.detail = JSON.stringify(result ?? null).slice(0, 1e3);
      appendHistorySync(entry);
      console.log(`[crontask] task ${effective.id} action ${method} ok`);
    } catch (err) {
      const msg = `[Cron Task] ${effective.name}
Action ${method} \u8C03\u7528\u5931\u8D25: ${String(err)}`;
      await notifyFailure(effective, msg);
      const entry = buildSingleHistoryEntry(
        effective,
        `\u8C03\u7528 ${method}\uFF1A\u5931\u8D25 - ${String(err)}`,
        -1,
        false,
        false,
        (/* @__PURE__ */ new Date()).toISOString()
      );
      appendHistorySync(entry);
    }
  }
  function summarizeActionResult(result) {
    if (result === null || result === void 0) return "\u6210\u529F";
    if (typeof result === "string" || typeof result === "number" || typeof result === "boolean") {
      return String(result).slice(0, 200);
    }
    if (Array.isArray(result)) return `${result.length} \u6761\u8BB0\u5F55`;
    if (typeof result === "object") {
      const entries = Object.entries(result);
      const brief = entries.slice(0, 5).map(([k, v]) => {
        if (v === null || v === void 0) return `${k}: null`;
        if (typeof v === "object") return `${k}: ${Array.isArray(v) ? `[${v.length}]` : "{\u2026}"}`;
        return `${k}: ${String(v).slice(0, 60)}`;
      }).join(", ");
      return entries.length > 5 ? brief + ", \u2026" : brief;
    }
    return String(result).slice(0, 200);
  }
  async function pollTaskResults(taskId, expectedClients, timeoutSeconds) {
    const deadline = Date.now() + timeoutSeconds * 1e3;
    const expected = new Set(expectedClients);
    let results = [];
    for (; ; ) {
      try {
        results = await import_plugin_sdk.server.call("admin:getTaskResultsByTaskId", {
          task_id: taskId
        });
      } catch (err) {
        console.log(`[crontask] poll task ${taskId} failed: ${String(err)}`);
      }
      const reported = new Map(results.map((r) => [r.client, r]));
      const done = expected.size > 0 && [...expected].every((uuid) => {
        const row = reported.get(uuid);
        return row !== void 0 && row.exit_code !== null && row.exit_code !== void 0;
      });
      if (done || Date.now() >= deadline) {
        return { results, timedOut: !done };
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
  async function buildFailureMessage(entry) {
    const nodes = await nodeInfoMap();
    const lines = [
      `[Cron Task] ${entry.name}`,
      `Time: ${entry.ts}`,
      `Task: ${entry.execTaskId}`,
      entry.timedOut ? "Status: timed out" : "Status: failed"
    ];
    for (const r of entry.results) {
      const name = (r.client && nodes.get(r.client)?.name) ?? r.client ?? "server";
      lines.push(
        `\u2022 ${name} (exit ${r.exit_code}): ${previewResult(r.result) || "(no output)"}`
      );
    }
    return lines.join("\n");
  }
  function newId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
  function rpcList() {
    return { tasks: loadTasksSync(), nodes: [] };
  }
  function rpcSave(input) {
    const operator = String(input?._operator ?? "admin");
    const task = taskFromInput(input ?? {});
    const error = validateTask(task);
    if (error) return { ok: false, error };
    const tasks = loadTasksSync();
    let action = "create";
    if (task.id === "") {
      task.id = newId();
      task.createdAt = (/* @__PURE__ */ new Date()).toISOString();
      tasks.push(task);
    } else {
      const idx = tasks.findIndex((t) => t.id === task.id);
      if (idx === -1) return { ok: false, error: "Task not found" };
      action = "update";
      tasks[idx] = { ...task, createdAt: tasks[idx].createdAt };
    }
    persistTasksSync(tasks);
    appendAuditSync({
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      action,
      operator,
      taskId: task.id,
      taskName: task.name,
      detail: `${action === "create" ? "\u521B\u5EFA" : "\u66F4\u65B0"}\u4EFB\u52A1 "${task.name}" @ ${task.cron}\uFF0C\u8282\u70B9 ${task.nodes.length} \u4E2A`
    });
    return { ok: true, task };
  }
  function rpcDelete(params) {
    const p = params ?? {};
    const operator = String(p._operator ?? "admin");
    const id = String(p.id ?? "");
    if (!id) return { ok: false, error: "Task id is required" };
    const tasks = loadTasksSync();
    const target = tasks.find((t) => t.id === id);
    if (!target) return { ok: false, error: "Task not found" };
    const next = tasks.filter((t) => t.id !== id);
    persistTasksSync(next);
    appendAuditSync({
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      action: "delete",
      operator,
      taskId: id,
      taskName: target.name,
      detail: `\u5220\u9664\u4EFB\u52A1 "${target.name}"`
    });
    return { ok: true };
  }
  function rpcSetEnabled(params) {
    const p = params ?? {};
    const operator = String(p._operator ?? "admin");
    const id = String(p.id ?? "");
    const enabled = asBoolean(p.enabled, true);
    const tasks = loadTasksSync();
    const task = tasks.find((t) => t.id === id);
    if (!task) return { ok: false, error: "Task not found" };
    task.enabled = enabled;
    persistTasksSync(tasks);
    appendAuditSync({
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      action: enabled ? "enable" : "disable",
      operator,
      taskId: id,
      taskName: task.name,
      detail: `${enabled ? "\u542F\u7528" : "\u505C\u7528"}\u4EFB\u52A1 "${task.name}"`
    });
    return { ok: true };
  }
  function rpcRun(params) {
    const p = params ?? {};
    const operator = String(p._operator ?? "admin");
    const id = String(p.id ?? "");
    const task = loadTasksSync().find((t) => t.id === id);
    if (!task) return { ok: false, error: "Task not found" };
    if (!isTaskExecutable(task)) {
      return { ok: false, error: "Task is not executable" };
    }
    void dispatchTask(task);
    appendAuditSync({
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      action: "run",
      operator,
      taskId: id,
      taskName: task.name,
      detail: `\u624B\u52A8\u89E6\u53D1\u4EFB\u52A1 "${task.name}"`
    });
    return { ok: true };
  }
  function rpcHistory(params) {
    const limit = Math.max(1, Math.min(200, Number(params?.limit ?? 50) || 50));
    const items = loadHistorySync();
    return { history: items.slice(-limit).reverse() };
  }
  function rpcAudit(params) {
    const limit = Math.max(1, Math.min(500, Number(params?.limit ?? 100) || 100));
    const items = loadAuditSync();
    return { audit: items.slice(-limit).reverse() };
  }
  function rpcSandboxStatus(params) {
    const p = params ?? {};
    const force = asBoolean(p.force, false);
    startProbeIfNeeded(force);
    return {
      ...sandboxProbeCache ?? { available: false, reason: "", checkedAt: "" },
      probing: sandboxProbePending
    };
  }
  (0, import_plugin_sdk.definePlugin)({
    async load() {
      const rpcs = [
        ["crontask.list", () => rpcList()],
        ["crontask.save", (p) => rpcSave(p ?? {})],
        ["crontask.delete", (p) => rpcDelete(p)],
        ["crontask.setEnabled", (p) => rpcSetEnabled(p)],
        ["crontask.run", (p) => rpcRun(p)],
        ["crontask.history", (p) => rpcHistory(p)],
        ["crontask.audit", (p) => rpcAudit(p)],
        ["crontask.sandboxStatus", (p) => rpcSandboxStatus(p)]
      ];
      for (const [name, handler] of rpcs) {
        try {
          import_plugin_sdk.server.registerRPC(name, handler);
        } catch (err) {
          console.log(`[crontask] registerRPC ${name} failed: ${String(err)}`);
        }
      }
      const tasks = loadTasksSync();
      syncCrons(tasks);
      const enabled = tasks.filter((t) => t.enabled).length;
      console.log(
        `[crontask] loaded: ${registeredCrons.size} unique schedules for ${enabled}/${tasks.length} enabled tasks`
      );
    }
  });
})();
