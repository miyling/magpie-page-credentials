// 会话密钥：本地服务每次启动生成一个随机密钥，写进插件页面目录
// page/session/<port>.js。入口页（由 magpie 按页面 token 服务，外站读不到）
// 加载它，再把密钥放在 URL fragment 里跳到本地服务；服务的 /api 只认带这个
// 密钥的请求。
//
// 为什么需要它：本地服务为了让沙箱页（opaque origin）能 fetch，回的是
// Access-Control-Allow-Origin: *；没有密钥的话，用户浏览的任意网站都能
// 读 http://127.0.0.1:<port>/api/state 里的账户邮箱，甚至替用户花掉重置卡。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function newSecret(dir = "", port = 0) {
  if (dir && port) {
    try {
      const raw = fs.readFileSync(path.join(dir, port + ".js"), "utf8");
      const m = /"secret":"([A-Za-z0-9_-]{24,64})"/.exec(raw);
      if (m && m[1]) return m[1];
    } catch {
      /* ignore and generate new */
    }
  }
  return crypto.randomBytes(24).toString("base64url");
}

export function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

// sweep 删掉进程已经不在的会话文件（magpie 的 CLI 命令也会起宿主，
// 它们用的是 magpie 分配的临时端口，退出后留下的文件在这里清掉）。
export function sweep(dir, keepPort) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) {
    const m = /^(\d+)\.js$/.exec(n);
    if (!m || Number(m[1]) === keepPort) continue;
    const f = path.join(dir, n);
    try {
      const pid = Number(/"pid":(\d+)/.exec(fs.readFileSync(f, "utf8"))?.[1]);
      if (!alive(pid)) fs.rmSync(f, { force: true });
    } catch {
      /* 读不了就留着 */
    }
  }
}

// writeSession 原子写入 page/session/<port>.js；失败返回错误信息。
export function writeSession(dir, port, secret) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const body = "window.__credSession=" + JSON.stringify({ port, secret, pid: process.pid, at: Date.now() }) + ";\n";
    const f = path.join(dir, port + ".js");
    const tmp = f + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, body, { mode: 0o644 });
    fs.renameSync(tmp, f);
    return "";
  } catch (e) {
    return String(e?.message || e);
  }
}

export function removeSession(dir, port, secret) {
  const f = path.join(dir, port + ".js");
  try {
    // 只删自己写的那份（端口可能已被另一个宿主接手）
    if (fs.readFileSync(f, "utf8").includes(JSON.stringify(secret))) fs.rmSync(f, { force: true });
  } catch {
    /* 没有就算了 */
  }
}
