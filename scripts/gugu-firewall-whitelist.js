/*
 * 咕咕云 防火墙自动加白
 * 兼容：Shadowrocket / Surge(iOS+Mac) / Stash / Loon / Quantumult X
 *
 * 接口（来自咕咕云控制台「复制白名单链接」）：
 *   GET https://www.guguyun.com/cany_tencentecs/firewall/whitelist?token=ctecsfw_xxx[@槽位]
 *   → {"status":200,"msg":"当前公网网段已加入白名单",
 *      "data":{"cidr":"x.x.x.0/24","mode":"fifo|fixed","slot":null|N,"removed_cidr":""}}
 * 服务端按请求来源 IP 的 /24 网段加白；不带 @N 为 FIFO 自动轮换（满 5 条挤掉最旧），
 * 带 @N 钉在固定槽位 N（不被轮换淘汰）。
 *
 * token 来源（优先级从高到低）：
 *   1. 模块 argument: tokens=ctecsfw_aaa|ctecsfw_bbb@0
 *   2. 持久化 key "gugufw_tokens"（QX 等不支持参数的客户端）
 *   3. 下面 INLINE_TOKENS
 */

var INLINE_TOKENS = "";

var API = "https://www.guguyun.com/cany_tencentecs/firewall/whitelist?token=";
var TOKEN_PREFIX = "ctecsfw_";
var TOKENS_KEY = "gugufw_tokens";
var STATE_PREFIX = "gugufw_state_";
var RETRY = 3;

/* ---------- 环境兼容 ---------- */
var isQX = typeof $task !== "undefined";
var isSurgeLike = typeof $httpClient !== "undefined";
var envInfo = "";
try { if (typeof $environment !== "undefined") envInfo = JSON.stringify($environment).toLowerCase(); } catch (e) {}
var isLoon = typeof $loon !== "undefined" || envInfo.indexOf("loon") >= 0;
// timeout 单位：Surge/Shadowrocket/Stash 为秒，Loon/QX 为毫秒
var TIMEOUT = isLoon || isQX ? 15000 : 15;

function sRead(k) {
  if (isQX) return $prefs.valueForKey(k);
  if (typeof $persistentStore !== "undefined") return $persistentStore.read(k);
  return null;
}
function sWrite(v, k) {
  if (isQX) return $prefs.setValueForKey(v, k);
  if (typeof $persistentStore !== "undefined") return $persistentStore.write(v, k);
}
function notify(t, s, b) {
  if (isQX) $notify(t, s, b);
  else if (typeof $notification !== "undefined") $notification.post(t, s, b);
}
function errText(e) {
  var t = e == null ? "" : typeof e === "object" ? String(e.message || e.error || "") : String(e);
  return t && t !== "null" ? t : "网络请求失败（超时/握手失败/被拦截）";
}

function getOnce(url) {
  return new Promise(function (resolve) {
    var opts = { url: url, timeout: TIMEOUT, headers: { Accept: "application/json" } };
    if (isQX) {
      opts.method = "GET";
      $task.fetch(opts).then(
        function (r) { resolve({ status: r.statusCode, body: r.body }); },
        function (e) { resolve({ error: errText(e && e.error || e) }); }
      );
    } else if (isSurgeLike) {
      // Shadowrocket 的 $httpClient 是 ObjC 桥接对象，必须直接调用，不能解引用
      $httpClient.get(opts, function (e, resp, body) {
        if (e) resolve({ error: errText(e) });
        else resolve({ status: resp && (resp.status || resp.statusCode), body: body });
      });
    } else resolve({ error: "不支持的客户端" });
  });
}

function wait(ms) {
  return new Promise(function (r) { typeof setTimeout === "function" ? setTimeout(r, ms) : r(); });
}

// 网络错误 / 5xx / 非 JSON 响应 重试；规范 JSON 错误（如 token 无效）不重试
function get(url, n) {
  n = n || 1;
  return getOnce(url).then(function (r) {
    var retry = !!r.error || r.status >= 500;
    if (!retry) { try { JSON.parse(r.body); } catch (e) { retry = true; } }
    if (!retry || n >= RETRY) return r;
    return wait(1500 * n).then(function () { return get(url, n + 1); });
  });
}

/* ---------- 参数 ---------- */
function argTokens() {
  if (typeof $argument === "undefined" || $argument === null) return "";
  if (typeof $argument === "object") return String($argument.tokens || "");
  var a = String($argument);
  if (/^["'].*["']$/.test(a)) a = a.slice(1, -1);
  if (a.charAt(0) === "{") { try { return String(JSON.parse(a).tokens || ""); } catch (e) {} }
  var m = a.match(/(?:^|&)tokens=([^&]*)/);
  if (m) return decodeURIComponent(m[1]);
  return a.indexOf(TOKEN_PREFIX) === 0 ? a : "";
}

var tokens = (argTokens() || sRead(TOKENS_KEY) || INLINE_TOKENS || "")
  .split(/[,|;、\s]+/)
  .map(function (s) { return s.trim(); })
  .filter(function (s) { return s.indexOf(TOKEN_PREFIX) === 0; });

/* ---------- 主逻辑 ---------- */
function addOne(tok, i) {
  // token 只含 [A-Za-z0-9_-]，@槽位 原样拼接（与控制台复制出来的链接一致）
  return get(API + tok).then(function (r) {
    var slot = tok.indexOf("@") > 0 ? tok.split("@")[1] : null;
    var res = { idx: i, slot: slot, ok: false };
    if (r.error) { res.msg = r.error; return res; }
    var j = null;
    try { j = JSON.parse(r.body); } catch (e) {}
    if (!j) { res.msg = "HTTP " + r.status + " 响应异常: " + String(r.body).slice(0, 80); return res; }
    var d = j.data || {};
    res.ok = j.status === 200 && !!d.cidr;
    res.msg = j.msg || "";
    res.cidr = d.cidr || "";
    res.mode = d.mode || (slot !== null ? "fixed" : "fifo");
    res.removed = d.removed_cidr || "";
    return res;
  });
}

function line(r) {
  var head = "#" + (r.idx + 1) + (r.slot !== null ? " 📌" + r.slot : "") + " ";
  if (!r.ok) return head + "❌ " + r.msg;
  return head + "✅ " + r.cidr + (r.mode === "fifo" ? "（轮换）" : "（固定）") +
    (r.removed ? "\n    已挤出 " + r.removed : "");
}

function done(title, content, ok) {
  if (isQX) return $done();
  $done({
    title: title, content: content,
    icon: ok ? "checkmark.shield" : "exclamationmark.shield",
    "icon-color": ok ? "#34C759" : "#FF3B30",
  });
}

if (!tokens.length) {
  notify("咕咕云加白", "未配置 token", "在模块 argument 里填入 tokens=ctecsfw_xxx（多个用 | 分割）");
  done("咕咕云加白：未配置 token", "填入 ctecsfw_ token", false);
} else {
  Promise.all(tokens.map(addOne)).then(function (rs) {
    var ok = rs.filter(function (r) { return r.ok; }).length;
    var cidr = (rs.filter(function (r) { return r.cidr; })[0] || {}).cidr || "?";
    var title = "咕咕云加白 " + ok + "/" + rs.length + " · " + cidr;
    var content = rs.map(line).join("\n");
    var changed = false;
    rs.forEach(function (r) {
      var st = (r.cidr || "?") + "|" + (r.ok ? 1 : 0);
      if (sRead(STATE_PREFIX + r.idx) !== st) { sWrite(st, STATE_PREFIX + r.idx); changed = true; }
      if (r.removed) changed = true;
    });
    // 成功只在网段变化/有挤出时通知；失败每次都通知
    if (changed || ok < rs.length) notify("咕咕云防火墙加白", title, content);
    done(title, content, ok === rs.length);
  }).catch(function (e) {
    notify("咕咕云防火墙加白", "脚本异常", errText(e));
    done("咕咕云加白：脚本异常", errText(e), false);
  });
}
