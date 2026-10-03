# 咕咕云 防火墙自动加白

自动把本机当前公网出口 IP 所在的 /24 网段加入咕咕云防火墙白名单。换网络（Wi-Fi ↔ 蜂窝、换地方）后会自动重新加白，不用再去控制台手动点。

## 一键安装链接

```
https://github.com/zhuoyi0918/gugufw/releases/latest/download/gugu-firewall-whitelist.srmodule
```

> 链接始终指向最新版本，发新版后无需更换。

## 安装步骤（Shadowrocket）

1. 在 iPhone 上复制上面的链接。
2. 打开 Shadowrocket → **配置** → **模块** → 右上角 **＋** → 粘贴链接 → **下载**。
3. 在模块列表里 **长按「咕咕云 防火墙自动加白」→ 编辑纯文本**，把两处 `tokens=在此填入ctecsfw_token` 换成你自己的 token，保存。
4. 确认模块已勾选启用。
5. 测试：**配置 → 脚本 → 点 `gugu-fw-cron` 运行**，通知显示 ✅ 和网段即成功。

> 下载失败一般是当前网络连不上 GitHub，先开代理再下载即可。

## token 怎么填

token 在咕咕云控制台「复制白名单链接」里，取 `token=` 后面那一段（以 `ctecsfw_` 开头）。

| 场景 | 写法 |
|---|---|
| 单台机器 | `tokens=ctecsfw_aaa` |
| 多台机器（用 `\|` 分隔） | `tokens=ctecsfw_aaa\|ctecsfw_bbb` |
| 钉在固定槽位，不被轮换挤掉 | `tokens=ctecsfw_aaa@0`（槽位 `@0` ~ `@4`） |

- 不带 `@N`：FIFO 自动轮换，白名单满 5 条时挤掉最旧的一条。
- 带 `@N`：固定占用第 N 个槽位，适合家里、公司等常用网络。

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
