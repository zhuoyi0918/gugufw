# 咕咕云 防火墙自动加白

自动把本机当前公网出口 IP 所在的 /24 网段加入咕咕云防火墙白名单。家里 Wi-Fi、蜂窝、其他 Wi-Fi 各占一个固定槽位，互不覆盖；换网络后自动重新加白，不用再去控制台手动点。

## 一键安装链接

```
https://github.com/zhuoyi0918/gugufw/releases/latest/download/gugu-firewall-whitelist.srmodule
```

> 链接始终指向最新版本，发新版后无需更换。

## 安装步骤（Shadowrocket）

1. 在 iPhone 上复制上面的链接。
2. 打开 Shadowrocket → **配置** → **模块** → 右上角 **＋** → 粘贴链接 → **下载**。
3. 在模块列表里 **长按「咕咕云 防火墙自动加白」→ 编辑纯文本**，把两处 `tokens=在此填入ctecsfw_token` 换成你自己的 token，两处 `home=在此填入家里WiFi名` 换成家里 Wi-Fi 名，保存。
4. 确认模块已勾选启用。
5. 测试：**配置 → 脚本 → 点 `gugu-fw-cron` 运行**，通知显示 ✅ 和网段即成功。

> 下载失败一般是当前网络连不上 GitHub，先开代理再下载即可。

## token 怎么填

token 在咕咕云控制台「复制白名单链接」里，取 `token=` 后面那一段（以 `ctecsfw_` 开头）。**不要自己加 `@N`**，脚本会按当前网络自动选槽位。

推荐写法：

```
tokens=ctecsfw_aaa&home=家里WiFi名
```

### 按网络自动选槽

咕咕云规则：固定槽位链接按系统识别，**手机放行 /24，电脑放行 /32**；自动轮换链接为 /32。蜂窝网络（CGNAT）下加白看到的 IP 和实际连接的 IP 常常不是同一个，只有 /24 才能覆盖，所以手机必须用固定槽位。

但带 `@N` 的请求每次都会**直接覆盖第 N 个槽**，同一个槽位在 Wi-Fi 和蜂窝之间来回切换会互相顶掉。脚本因此按网络分别使用不同槽位：

| 当前网络 | 槽位 | 参数（可改） |
|---|---|---|
| 家里 Wi-Fi（SSID 与 `home` 一致） | `@0` | `home_slot=0` |
| 蜂窝 | `@1` | `cell_slot=1` |
| 其他 Wi-Fi | `@2` | `wifi_slot=2` |
| macOS 版 Surge | `@3` | `mac_slot=3` |

- `home` 可填多个，用 `|` 分隔：`home=HomeWiFi|HomeWiFi-5G`。不填 `home` 时所有 Wi-Fi 都用 `@0`。
- `slot=N`：强制所有网络都用槽位 N。
- `auto=0`：关闭自动选槽（不带 `@N` 即为 FIFO 轮换，/32）。
- token 自己带了 `@N` 时原样使用，不做自动选槽。
- 多台机器：`tokens=ctecsfw_aaa|ctecsfw_bbb`，每台机器都按上面规则选槽。
- 脚本请求时使用 iPhone User-Agent，保证服务端识别为手机、放行 /24。如果通知里出现「⚠️ 服务端给了 /32」，说明识别失败。

### 通知里的槽位表

每次加白后，通知会列出 5 个槽位当前记录的网段、对应网络和更新时间，「← 本次」标出这次写入的槽。

> 咕咕云接口只返回本次加白的网段，所以槽位表是本设备自己记下来的：别的设备或控制台手动写入的条目显示不了；如果以后接口返回完整列表，脚本会自动改用服务端的列表。

## 工作原理

- **定时**：每 10 分钟执行一次。
- **网络切换**：网络变化时立即执行。
- **强制直连**：加白请求（`www.guguyun.com`）走 DIRECT，保证服务端看到的是你的真实出口 IP，而不是代理节点的 IP。
- **安静通知**：只有网段变化、有旧网段被挤出、或加白失败时才弹通知。
- **自动重试**：网络错误 / 5xx / 异常响应最多重试 3 次；token 无效等明确错误不重试。

## 常见问题

**更新模块后不加白了？**
在 Shadowrocket 里更新模块会覆盖你编辑过的纯文本，更新后需要重新填一次 token。

**提示「未配置 token」？**
token 没填或没保存，按上面第 3 步重新编辑。

**家里 Wi-Fi 被当成「其他 Wi-Fi」？**
小火箭需要定位权限才能读到 Wi-Fi 名（SSID）。到 iOS 设置 → Shadowrocket → 位置 打开权限；或者 `home` 填错了，核对一下大小写。

**蜂窝下显示加白成功但连不上？**
确认通知里是 `/24` 而不是 `/32`。/32 只放行单个 IP，蜂窝 CGNAT 下加白看到的 IP 和实际连接的 IP 经常最后一位不同。

**通知显示 ❌？**
看后面的错误信息：token 无效请到控制台重新复制；网络失败一般是当前网络无法访问咕咕云，换个网络或稍后会自动重试。

## 其他客户端

脚本本身兼容 Surge / Stash / Loon / Quantumult X，可自行引用：

```
https://github.com/zhuoyi0918/gugufw/releases/latest/download/gugu-firewall-whitelist.js
```

参考模块里的 `[Rule]` 和 `[Script]` 配置即可。Quantumult X 等不支持 argument 的客户端，可把 token 写入持久化 key `gugufw_tokens`。

## 文件说明

| 文件 | 说明 |
|---|---|
| `gugu-firewall-whitelist.srmodule` | Shadowrocket 模块 |
| `scripts/gugu-firewall-whitelist.js` | 加白脚本 |
