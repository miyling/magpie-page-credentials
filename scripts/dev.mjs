// 本地预览：不经过 magpie 插件宿主，直接起服务并打印带会话密钥的地址。
//   node scripts/dev.mjs [port] [gatewayUrl]
// 例：node scripts/dev.mjs 4397 http://127.0.0.1:3425
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { start } from "../lib/server.mjs";

const port = Number(process.argv[2]) || 4397;
const gatewayUrl = process.argv[3] || "";
const srv = start({ port, gatewayUrl, gatewayKey: process.env.CRED_GATEWAY_KEY || "" }, (m) => console.error("[dev] " + m));
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "page", "session", port + ".js");

const wait = setInterval(() => {
  if (!srv.state.listening || !fs.existsSync(file)) return;
  clearInterval(wait);
  const secret = /"secret":"([^"]+)"/.exec(fs.readFileSync(file, "utf8"))[1];
  console.log(`http://127.0.0.1:${port}/#s=${encodeURIComponent(secret)}`);
}, 100);
setInterval(() => {}, 1 << 30);
process.on("SIGINT", () => srv.close().then(() => process.exit(0)));
process.on("SIGTERM", () => srv.close().then(() => process.exit(0)));
