/*
 * 咕咕云 防火墙自动加白
 * 兼容：Shadowrocket / Surge(iOS+Mac) / Stash / Loon / Quantumult X
 *
 * 接口（来自咕咕云控制台「复制白名单链接」）：
 *   GET https://www.guguyun.com/cany_tencentecs/firewall/whitelist?token=ctecsfw_xxx[@槽位]
 *   → {"status":200,"msg":"当前公网网段已加入白名单",
 *      "data":{"cidr":"x.x.x.0/24","mode":"fifo|fixed","slot":null|N,"removed_cidr":""}}
 * 官方规则：固定槽位链接按系统识别——手机放行 /24，电脑放行 /32；
 *           自动轮换链接为 /32，满额替换最早的随机记录，保留固定槽位。
 * 注意：带 @N 的请求每次都会直接覆盖第 N 个槽。
 *
 * 按网络自动选槽（token 不写 @N 时生效）：
 *   家里 Wi-Fi（home=SSID）→ home_slot（默认 0）
 *   蜂窝                   → cell_slot（默认 1）
 *   其他 Wi-Fi             → wifi_slot（默认 2；未设置 home 时所有 Wi-Fi 都用 home_slot）
 *   macOS 版 Surge         → mac_slot（默认 3）
 *   slot=N                 → 强制所有网络都用槽位 N
 *   token 自带 @N          → 原样使用，不做自动选槽
 *   auto=0                 → 关闭自动选槽（不带 @N 即为 FIFO 轮换 /32）
 *
 * 参数示例：tokens=ctecsfw_aaa&home=MyHomeWiFi
 *
 * token 来源（优先级从高到低）：
 *   1. 模块 argument: tokens=ctecsfw_aaa|ctecsfw_bbb
 *   2. 持久化 key "gugufw_tokens"（QX 等不支持参数的客户端）
 *   3. 下面 INLINE_TOKENS
 */

var INLINE_TOKENS = "";
var VERSION = "1.1.1";

var API = "https://www.guguyun.com/cany_tencentecs/firewall/whitelist?token=";
var TOKEN_PREFIX = "ctecsfw_";
var TOKENS_KEY = "gugufw_tokens";
var STATE_PREFIX = "gugufw_state_";
var SLOTS_PREFIX = "gugufw_slots_";
var SLOT_COUNT = 5;
var RETRY = 3;
// 服务端按 User-Agent 识别系统：手机才放行 /24
var MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/* ---------- 环境兼容 ---------- */
var isQX = typeof $task !== "undefined";
var isSurgeLike = typeof $httpClient !== "undefined";
var envInfo = "";
try { if (typeof $environment !== "undefined") envInfo = JSON.stringify($environment).toLowerCase(); } catch (e) {}
var isLoon = typeof $loon !== "undefined" || envInfo.indexOf("loon") >= 0;
var isMac = false;
try { isMac = typeof $environment !== "undefined" && /mac/i.test(String($environment.system || "")); } catch (e) {}
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
    var headers = { Accept: "application/json" };
    if (!isMac) headers["User-Agent"] = MOBILE_UA;
    var opts = { url: url, timeout: TIMEOUT, headers: headers };
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
function parseArgs() {
  var out = {};
  if (typeof $argument === "undefined" || $argument === null) return out;
  if (typeof $argument === "object") {
    for (var k in $argument) out[k] = String($argument[k]);
    return out;
  }
  var a = String($argument);
  if (/^["'].*["']$/.test(a)) a = a.slice(1, -1);
  if (a.charAt(0) === "{") {
    try { var j = JSON.parse(a); for (var k2 in j) out[k2] = String(j[k2]); return out; } catch (e) {}
  }
  if (a.indexOf("=") < 0) { if (a.indexOf(TOKEN_PREFIX) === 0) out.tokens = a; return out; }
  a.split("&").forEach(function (kv) {
    var i = kv.indexOf("=");
    if (i <= 0) return;
    var key = kv.slice(0, i).trim(), val = kv.slice(i + 1);
    try { val = decodeURIComponent(val); } catch (e) {}
    out[key] = val.trim();
  });
  return out;
}

var ARGS = parseArgs();
function argInt(name, def) {
  var v = ARGS[name];
  if (v === undefined || v === "" || /在此填入/.test(v)) return def;
  var n = parseInt(v, 10);
  return isNaN(n) || n < 0 || n >= SLOT_COUNT ? def : n;
}

var tokens = (ARGS.tokens || sRead(TOKENS_KEY) || INLINE_TOKENS || "")
  .split(/[,|;、\s]+/)
  .map(function (s) { return s.trim(); })
  .filter(function (s) { return s.indexOf(TOKEN_PREFIX) === 0; });

/* ---------- 网络识别 & 选槽 ---------- */
function detectNet() {
  var r = { type: "unknown", ssid: "" };
  try {
    if (typeof $network !== "undefined" && $network) {          // Surge / Shadowrocket / Stash
      var ssid = ($network.wifi && $network.wifi.ssid) || "";
      var iface = String(($network.v4 && $network.v4.primaryInterface) || "");
      r.iface = iface;
      if (ssid) return { type: "wifi", ssid: ssid, iface: iface };
      if ($network["cellular-data"] || /^pdp_ip/.test(iface)) return { type: "cell", ssid: "", iface: iface };
      if (/^en/.test(iface)) return { type: "wifi", ssid: "", iface: iface };   // Wi-Fi 但拿不到 SSID（未授权定位等）
    }
    if (typeof $config !== "undefined" && $config.getConfig) {   // Loon
      var c = JSON.parse($config.getConfig());
      if (c.ssid) return { type: "wifi", ssid: String(c.ssid) };
      return { type: "cell", ssid: "" };
    }
    if (typeof $environment !== "undefined" && $environment && $environment.ssid) {
      return { type: "wifi", ssid: String($environment.ssid) };
    }
  } catch (e) {}
  return r;
}

var NET = detectNet();
var AUTO = ARGS.auto !== "0";
var HOMES = String(ARGS.home || "")
  .split("|").map(function (s) { return s.trim(); })
  .filter(function (s) { return s && !/在此填入/.test(s); });

function pickSlot() {
  if (!AUTO) return { slot: null, why: "自动选槽已关闭" };
  var forced = argInt("slot", -1);
  if (forced >= 0) return { slot: forced, why: "强制槽位" };
  if (isMac) return { slot: argInt("mac_slot", 3), why: "Mac" };
  var homeSlot = argInt("home_slot", 0);
  if (NET.type === "cell") return { slot: argInt("cell_slot", 1), why: "蜂窝" };
  if (NET.type === "wifi") {
    if (!HOMES.length) return { slot: homeSlot, why: "Wi-Fi" + (NET.ssid ? " " + NET.ssid : "") };
    if (NET.ssid && HOMES.indexOf(NET.ssid) >= 0) return { slot: homeSlot, why: "家里 " + NET.ssid };
    return { slot: argInt("wifi_slot", 2), why: "其他 Wi-Fi" + (NET.ssid ? " " + NET.ssid : "") };
  }
  // 识别不了网络时按蜂窝处理：FIFO 只给 /32，手机上没法用
  return { slot: argInt("cell_slot", 1), why: "未识别网络→按蜂窝" + (NET.iface ? "(" + NET.iface + ")" : "") };
}
var PICK = pickSlot();

function buildToken(tok) {
  if (tok.indexOf("@") > 0) return tok;                      // 用户自己指定了槽位
  return PICK.slot === null ? tok : tok + "@" + PICK.slot;
}

/* ---------- 槽位表（显示 5 条） ---------- */
function tokKey(tok) { return tok.split("@")[0].slice(-12); }
function loadSlots(base) {
  try { return JSON.parse(sRead(SLOTS_PREFIX + tokKey(base)) || "{}") || {}; } catch (e) { return {}; }
}
function saveSlots(base, m) { sWrite(JSON.stringify(m), SLOTS_PREFIX + tokKey(base)); }
function stamp() {
  var d = new Date();
  function p(n) { return n < 10 ? "0" + n : "" + n; }
  return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

// 如果服务端响应里带了完整白名单列表，优先用它（兼容常见字段名）
function serverList(d) {
  var keys = ["list", "whitelist", "items", "records", "rules", "slots", "entries"];
  for (var i = 0; i < keys.length; i++) {
    var v = d && d[keys[i]];
    if (Object.prototype.toString.call(v) === "[object Array]" && v.length) return v;
  }
  return null;
}
function fmtServerItem(it) {
  if (typeof it === "string") return it;
  var c = it.cidr || it.ip || it.address || it.value || JSON.stringify(it);
  var s = it.slot !== undefined && it.slot !== null ? "📌" + it.slot + " " : "🔄 ";
  return s + c + (it.mode ? "（" + (it.mode === "fixed" ? "固定" : "轮换") + "）" : "");
}

/* ---------- 主逻辑 ---------- */
function addOne(raw, i) {
  var tok = buildToken(raw);
  // token 只含 [A-Za-z0-9_-]，@槽位 原样拼接（与控制台复制出来的链接一致）
  return get(API + tok).then(function (r) {
    var slot = tok.indexOf("@") > 0 ? tok.split("@")[1] : null;
    var res = { idx: i, base: raw.split("@")[0], slot: slot, ok: false };
    if (r.error) { res.msg = r.error; return res; }
    var j = null;
    try { j = JSON.parse(r.body); } catch (e) {}
    if (!j) { res.msg = "HTTP " + r.status + " 响应异常: " + String(r.body).slice(0, 80); return res; }
    var d = j.data || {};
    res.ok = j.status === 200 && !!d.cidr;
    res.msg = j.msg || "";
    res.cidr = d.cidr || "";
    if (d.slot !== undefined && d.slot !== null) res.slot = String(d.slot);
    res.mode = d.mode || (res.slot !== null ? "fixed" : "fifo");
    res.removed = d.removed_cidr || "";
    res.list = serverList(d);
    return res;
  });
}

function slotTable(r) {
  if (r.list) return r.list.map(function (it) { return "  " + fmtServerItem(it); }).join("\n");
  var m = loadSlots(r.base), rows = [];
  for (var s = 0; s < SLOT_COUNT; s++) {
    var e = m[s];
    var mark = r.ok && r.mode === "fixed" && String(s) === String(r.slot) ? " ← 本次" : "";
    rows.push("  📌" + s + " " + (e ? e.cidr + "  " + e.note + " " + e.t : "—") + mark);
  }
  return rows.join("\n");
}

function line(r) {
  var head = "#" + (r.idx + 1) + (r.slot !== null ? " 📌" + r.slot : " 🔄") + " ";
  if (!r.ok) return head + "❌ " + r.msg;
  var s = head + "✅ " + r.cidr + (r.mode === "fifo" ? "（轮换）" : "（固定）") +
    (r.removed ? "\n    已挤出 " + r.removed : "");
  if (/\/32$/.test(r.cidr) && !isMac && r.mode === "fixed") s += "\n    ⚠️ 服务端给了 /32，未识别为手机";
  return s + "\n" + slotTable(r);
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
    // 先更新本地槽位表，再生成通知内容
    rs.forEach(function (r) {
      if (!r.ok || r.mode !== "fixed" || r.slot === null) return;
      var m = loadSlots(r.base);
      m[r.slot] = { cidr: r.cidr, note: PICK.why, t: stamp() };
      saveSlots(r.base, m);
    });
    var ok = rs.filter(function (r) { return r.ok; }).length;
    var cidr = (rs.filter(function (r) { return r.cidr; })[0] || {}).cidr || "?";
    var title = "咕咕云加白 v" + VERSION + " " + ok + "/" + rs.length + " · " + cidr + " · " + PICK.why;
    var content = rs.map(line).join("\n");
    var changed = false;
    rs.forEach(function (r) {
      var st = (r.slot === null ? "f" : r.slot) + "|" + (r.cidr || "?") + "|" + (r.ok ? 1 : 0);
      if (sRead(STATE_PREFIX + r.idx) !== st) { sWrite(st, STATE_PREFIX + r.idx); changed = true; }
      if (r.removed) changed = true;
    });
    // 成功只在网段/槽位变化或有挤出时通知；失败每次都通知
    if (changed || ok < rs.length) notify("咕咕云防火墙加白", title, content);
    done(title, content, ok === rs.length);
  }).catch(function (e) {
    notify("咕咕云防火墙加白", "脚本异常", errText(e));
    done("咕咕云加白：脚本异常", errText(e), false);
  });
}
