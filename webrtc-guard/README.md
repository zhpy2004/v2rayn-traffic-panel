# WebRTC 泄露防护

代理环境下（系统代理 = HTTP 代理）浏览器仍然会用**直连 UDP** 给 STUN 服务器发探测包，
于是把真实公网 IP 暴露给网站。这跟代理软件本身无关，是 WebRTC 的设计决定的。

Chromium 内核（Edge / Chrome）提供一个扩展隐私 API：

```js
chrome.privacy.network.webRTCIPHandlingPolicy = 'disable_non_proxied_udp'
```

设置后 WebRTC 不再使用非代理 UDP，真实 IP 不会出现在 ICE 候选里。
设置会写进浏览器 profile，**装一次长期生效**，之后卸载扩展也保留。

## 用法

```bat
install.cmd        :: 复制扩展到固定目录，并打开扩展页面 / 目录
```

然后在浏览器里：

1. 打开「开发人员模式」
2. 点「加载解压缩的扩展」
3. 选择 `%LOCALAPPDATA%\WebRTC-Leak-Guard`

验证：

```bat
check.cmd          :: 打开自检页
install.cmd -Verify :: 直接读浏览器 profile 确认设置已写入
```

## 说明

- 这个 Edge/Chrome 版本已经**删掉了** `WebRtcIPHandlingPolicy` 组策略和
  `--force-webrtc-ip-handling-policy` 启动参数（二进制里搜不到），所以只能走扩展。
- 副作用：浏览器里的 WebRTC 视频/语音通话会走代理 TCP，可能变慢或不可用；
  不用来开会的浏览器可以放心装。
- 想系统级（包括其它 UDP 应用）全部走代理，应该在 V2RayN 里开 TUN 模式（需要管理员权限）。
