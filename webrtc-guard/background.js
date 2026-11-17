/**
 * WebRTC Leak Guard
 *
 * 代理环境里，浏览器 WebRTC 会用直连 UDP 发 STUN 请求，把真实公网 IP 暴露给网站。
 * Chromium 的扩展隐私 API 可以把这个行为改成「只允许经由代理的 UDP/TCP」：
 *   chrome.privacy.network.webRTCIPHandlingPolicy = 'disable_non_proxied_udp'
 *
 * 设置保存在浏览器 profile 里，装一次就长期生效（浏览器重启后依然有效）。
 */

const POLICY = 'disable_non_proxied_udp';

async function applyPolicy() {
  try {
    const before = await chrome.privacy.network.webRTCIPHandlingPolicy.get({});
    if (before.value !== POLICY) {
      await chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: POLICY });
    }
    const after = await chrome.privacy.network.webRTCIPHandlingPolicy.get({});
    await chrome.storage.local.set({ value: after.value, appliedAt: Date.now() });
    console.log(`[webrtc-guard] policy=${after.value} (was ${before.value})`);
  } catch (err) {
    await chrome.storage.local.set({ error: String(err) });
    console.error('[webrtc-guard] failed', err);
  }
}

chrome.runtime.onInstalled.addListener(applyPolicy);
chrome.runtime.onStartup.addListener(applyPolicy);
applyPolicy();
