// 入口页：等 magpie 握手 → 读会话密钥 → 跳到插件的本地服务。
// 沙箱里没有网络：会话文件用 <script> 从本页目录加载（script-src 允许）。
(function () {
  "use strict";

  var DEFAULT_PORT = 4396;
  var $ = function (id) { return document.getElementById(id); };
  var tries = 0;
  var port = DEFAULT_PORT;
  var opts = {};

  function say(text, stuck) {
    $("msg").textContent = text;
    $("actions").hidden = !stuck;
    $("help").hidden = !stuck;
  }

  function validPort(v) {
    var n = Number(v);
    return n >= 1024 && n <= 65535 && Math.floor(n) === n ? n : 0;
  }

  function loadSession(done) {
    window.__credSession = null;
    var s = document.createElement("script");
    s.src = "session/" + port + ".js?t=" + Date.now();
    s.onload = function () { s.remove(); done(window.__credSession); };
    s.onerror = function () { s.remove(); done(null); };
    document.head.appendChild(s);
  }

  function target(sess) {
    var base = (window.magpie && magpie.service) || ("http://127.0.0.1:" + port + "/");
    var t = magpie.theme || {};
    var hash = "s=" + encodeURIComponent(sess.secret) +
      "&l=" + encodeURIComponent(location.href.split("#")[0]) +
      "&d=" + (t.dark ? 1 : 0);
    return base.split("#")[0] + "#" + hash;
  }

  function go() {
    tries++;
    loadSession(function (sess) {
      if (!sess || !sess.secret) {
        // 宿主刚启动时服务还没写会话文件：magpie 打开页面时最多等宿主 7 秒
        if (tries < 12) {
          say(tries < 3 ? "正在连接插件服务…" : "插件服务正在启动…（第 " + tries + " 次）");
          setTimeout(go, 1500);
          return;
        }
        say("插件服务没有启动。", true);
        return;
      }
      say("正在打开看板…");
      location.replace(target(sess));
      // 桌面窗口里，跳到拒绝连接的地址时 WebKit 会停在本页且不报错
      setTimeout(function () {
        say("看板没有打开：本地服务 127.0.0.1:" + port + " 没有回应。", true);
      }, 6000);
    });
  }

  $("retry").onclick = function () { tries = 0; say("正在连接插件服务…"); go(); };
  $("restart").onclick = function () {
    var b = $("restart");
    b.disabled = true;
    say("正在重启插件宿主…");
    var o = {};
    for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    o._restartedAt = Date.now();
    magpie.options.set(o).then(function () {
      setTimeout(function () { b.disabled = false; tries = 0; go(); }, 2500);
    }, function (e) {
      b.disabled = false;
      say("重启失败：" + (e && e.message || e), true);
    });
  };

  magpie.ready.then(function () {
    return magpie.options.get().then(function (o) { opts = o || {}; }, function () { opts = {}; });
  }).then(function () {
    port = validPort(opts.port) || DEFAULT_PORT;
    $("port").textContent = String(port);
    go();
  });
})();
