# V2RayN 流量面板

> 按站点统计代理流量 · 本月总量 · 实时速率 · 托盘常驻 · 跟着 V2RayN 自动启停
>
> A local traffic dashboard for V2RayN on Windows: per-host proxy traffic, monthly total,
> live rate, tray icon, and automatic start/stop that follows the V2RayN process.
> Zero runtime dependencies (Node 24 built-in `node:sqlite`), everything stays on your machine.

![面板截图](docs/screenshot.png)

## 为什么需要它

Xray 自带的统计 API 只有「入站/出站/用户」维度的字节数，**没有按域名的流量**；
V2RayN 的「统计」和「访问日志」默认也是关闭的。所以"哪个网站用了多少代理流量"这个问题，
靠现成工具答不了。

这个项目在**本机**加一层计数中转来解决：

```
应用 / 浏览器
   │  系统代理 127.0.0.1:10810
   ▼
计数中转（SOCKS5 + HTTP 混合）
   │  按目标域名累计 上行/下行 字节
   ▼
V2RayN 本地入站 127.0.0.1:10808
   │
   ▼
你的代理节点
```

* 中转按连接记录目标 `host:port` 与双向字节数，连接结束写一行明细，同时按「日期 + 域名」聚合。
* 纯 TCP 管道：不解密、不改 UA、不改 TLS 指纹，也不额外连接任何远程地址。
* 面板展示：本月合计、今日、实时速率、近 30 天趋势、站点排行（域名合并 / 主机）、最近连接。

## 功能

- **按站点流量**：域名合并（`googlevideo.com`、`cloudfront.net` 等 CDN 归并）+ 原始主机两种视图
- **月度总量**：本月 / 今日累计，30 天趋势图，CSV 无关的本地 SQLite 存储
- **实时**：SSE 每秒推送速率与活跃连接，新连接实时插入
- **托盘**：蓝底 ¥ 图标，左键开面板，右键看本月流量、开数据目录
- **自动启停**：看护进程盯着 `v2rayN.exe`，V2RayN 起来就开面板并接管系统代理，退出就还原并收工
- **零依赖**：运行时只用 Node 内置模块，前端原生 JS + Canvas，没有构建步骤

## 快速开始

要求：Windows + Node.js ≥ 22.5（`node --version` 查看）+ 已安装并运行的 V2RayN（默认入站 `127.0.0.1:10808`）。

### 方式一：全自动（推荐）

```bat
install-autostart.cmd   :: 注册登录自启（当前用户，不需要管理员）
start-watch.cmd         :: 立即生效，不用重启/注销
```

之后：登录 Windows → 看护在后台待命 → 打开 V2RayN → 面板自动起来并接管系统代理。
面板地址：`http://127.0.0.1:8787`，通知区域会出现托盘图标。

### 方式二：手动

```bat
start.cmd               :: 启动面板并打开浏览器；默认不接管系统代理
```

然后在面板上点 **「接管系统代理」**。

### 方式三：命令行

```powershell
npm start                      # 或 node --disable-warning=ExperimentalWarning src/server.js
$env:TRAFFIC_AUTO_CAPTURE=1    # 启动即接管系统代理
$env:TRAFFIC_OPEN=1            # 启动后自动开浏览器
```

## 托盘图标

| 操作 | 效果 |
|---|---|
| 左键单击 | Edge `--app` 打开面板独立窗口（无地址栏/标签页） |
| 右键 → 打开面板（浏览器） | 默认浏览器打开 |
| 右键 → 状态行 | 本月 / 今日流量 + 连接次数，5 秒刷新 |
| 右键 → 打开数据目录 | 打开 `data/` |
| 右键 → 退出托盘 | 只关图标，统计不受影响，下次登录再出现 |

蓝色 = 监控中，灰色 = 面板未运行。

## 接管系统代理到底改了什么

Windows 有一个全局系统代理设置，存在注册表
`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 的 `ProxyEnable` / `ProxyServer`。
Chrome、Edge、Electron 应用、很多 .NET 程序默认都读它。

* 平时是 **V2RayN** 在写这个值：`127.0.0.1:10808`。
* **接管** = 把它改成 `127.0.0.1:10810`（本面板的中转端口），流量先到面板记账，再转给 V2RayN。
  应用的配置一个都不用动。
* **还原** = 把值写回接管前的原样（通常是 `10808`）。

接管前原值会存进数据库并落到 `data/proxy-original.json`，面板不在时也能用 `restore-proxy.cmd` 还原。
看护模式下，V2RayN 若把代理改回 `10808`，面板每 8 秒检测并重新接管；用户主动还原时不抢。

## 自动启停（看护进程）

`src/watcher.mjs` 每 2 秒检查一次 `v2rayN.exe`：

| 事件 | 动作 |
|---|---|
| V2RayN 启动 | 拉起面板（隐藏窗口），4 秒后接管系统代理 |
| V2RayN 退出 | 先还原系统代理，再关闭面板 |
| 面板被误杀 | 2 秒内重新拉起 |
| 重复启动看护 | 检测到 `data/watcher.pid` 后直接退出 |

`install-autostart.cmd` 在**当前用户的「启动」文件夹**放两个快捷方式（看护 + 托盘），
登录时静默拉起，不写计划任务、不需要管理员。卸载用 `uninstall-autostart.cmd`。

## 数据与隐私

- 所有数据都在本机 `data/traffic.db`（SQLite）：域名、端口、上下行字节数、连接时长。
  **不记录 URL、不记录内容、不上传任何地方**，程序也不发起任何外部网络请求。
- 明细保留 30 天，按日聚合长期保留（`TRAFFIC_RAW_DAYS` 可调）。
- 面板与中转只监听 `127.0.0.1`；但同一台机器上的其它用户/进程可以访问，注意共享电脑场景。

## 统计口径与边界

| 项目 | 说明 |
|---|---|
| 计入 | 经过本面板中转的连接（系统代理指向 10810，或被手动指到 10810 的应用） |
| 不计入 | 直连 `10808` 的应用（Telegram、部分 IDE 手填的 SOCKS）；UDP/QUIC 流量 |
| 起始时间 | 从第一次接管系统代理开始，之前的历史无法回填 |
| 字节含义 | 本地这一跳实际搬运的字节（含 TLS 记录开销），不是运营商/机场的计费口径 |
| 对节点的影响 | 到节点的字节与直连 V2RayN 完全一致，不额外连接远程、不改协议与指纹 |

## 常见问题

**Q：会不会增加被封的风险？**
面板只在本机 `127.0.0.1` 转发字节，不改变发往节点的协议、指纹、SNI，也不额外连接远程地址；
GFW 与机场看到的流量与之前一致。真正的变化是本机多了一层转发开销和一份本地域名记录。

**Q：面板显示「中转 已停止」？**
10810 被占用或启动失败，看控制台错误，或改 `TRAFFIC_RELAY_PORT`。

**Q：显示「V2RayN 未连接」？**
V2RayN 没启动/没连节点，或入站端口不是 10808（改 `TRAFFIC_UPSTREAM_PORT`）。

**Q：接管后上不了网？**
双击 `restore-proxy.cmd`；再确认 V2RayN 本身通：
`curl -x socks5h://127.0.0.1:10808 https://www.gstatic.com/generate_204`

**Q：有连接但没数据？**
浏览器里装了 SwitchyOmega 之类扩展且直连 10808 时不会经过面板；把扩展代理改成 10810 或关掉。

## 目录结构

```
v2rayn-traffic/
├─ start.cmd / start-watch.cmd      手动启动 / 启动看护+托盘
├─ install-autostart.cmd            注册登录自启
├─ uninstall-autostart.cmd          移除自启并停止
├─ restore-proxy.cmd                还原系统代理（不依赖进程）
├─ panel.cmd                        Edge --app 独立窗口
├─ src/
│  ├─ watcher.mjs                   看护：跟着 v2rayN.exe 启停面板
│  ├─ server.js                     HTTP 服务、API、SSE、自动接管与守卫
│  ├─ relay.js                      SOCKS5 / HTTP CONNECT / HTTP 计数中转
│  ├─ store.js                      SQLite 存储与聚合
│  ├─ systemproxy.js                WinINET 代理接管/还原
│  └─ config.js                     端口、路径、保留期
├─ public/                          前端（原生 JS + Canvas，无构建）
├─ scripts/                         托盘、启动项、代理还原
├─ test/                            中转自检、演示数据、CDP 截图工具
└─ data/                            运行时生成，不入库
```

## 开发

```powershell
npm run selftest    # 中转自检：SOCKS5 / HTTP CONNECT / HTTP 三条路径 + 字节计数
node test/seed-demo.mjs data/demo.db   # 造一批演示数据看界面
```

## 许可

[MIT](LICENSE)。仅用于个人网络流量统计，请在遵守当地法律法规与所使用服务条款的前提下使用。
