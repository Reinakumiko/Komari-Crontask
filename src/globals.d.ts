/**
 * Ambient globals injected by the Komari goja host runtime.
 *
 * The plugin SDK already declares `__storageDir__` and `require` globally
 * (see @komari-monitor/plugin-sdk/src/index.d.ts). This file covers the
 * remaining standard globals the plugin source uses, so typecheck runs
 * without pulling in @types/node (whose global `require` clashes with the
 * SDK's host-declared one).
 */

declare function setTimeout(
  handler: (...args: unknown[]) => void,
  timeout?: number,
  ...args: unknown[]
): unknown;

declare function clearTimeout(handle: unknown): void;
/** 插件目录（jsruntime 注入，指向 data/plugin/<short>）。 */
declare const __dirname: string;
