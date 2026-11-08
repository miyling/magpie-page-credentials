// magpie-page-credentials 插件入口。
//
// magpie 在 Bun 插件宿主里调用这里的默认导出（入口里每个导出函数都会被当成插件，
// 所以只导出这一个）。它在宿主进程里起本地服务（lib/server.mjs），服务托管看板
// 并把「刷新额度」「使用重置卡」转给 magpie 网关。不声明 provider、不接管任何请求。

import { portOf, start } from "./lib/server.mjs";

const KEY = Symbol.for("magpie-page-credentials.server");

export default async function credentialsPage(_input, options) {
  const opts = options && typeof options === "object" ? options : {};
  const prev = globalThis[KEY];
  // 同一进程里再次加载（选项变了）：端口或网关设置不同就换一个服务
  const sig = JSON.stringify([portOf(opts), opts.gatewayUrl || "", opts.gatewayKey || ""]);
  if (prev && prev.sig === sig) return {};
  if (prev) await prev.server.close().catch(() => {});
  globalThis[KEY] = { sig, server: start(opts) };
  return {};
}
