/* X 粉丝数显示 —— 页面上下文脚本（MAIN world）
 * 只被动读取 X 网页自己已经拿到的数据，提取公开的
 * screen_name / followers_count / friends_count，经 postMessage 交给内容脚本。
 * 数据来源：
 *   1) X 自己发出的 GraphQL 请求的响应（fetch / XHR，被动 clone 读取）；
 *   2) 新版 X 网页（2026 年 x-web，TanStack Start + Relay）首屏服务端渲染时
 *      内联在 HTML 里的 self.$R 流式数据（首屏数据不再走 fetch）。
 * 兼容两种用户对象结构：
 *   旧：legacy.followers_count / legacy.friends_count / legacy.screen_name
 *   新：relationship_counts.followers / relationship_counts.following / core.screen_name
 * 不发起任何新请求，不读 cookie / token / storage。
 */
(function () {
  'use strict';
  if (window.__xfcInjected) return;
  window.__xfcInjected = true;

  var MAX_DEPTH = 64;
  var MAX_NODES = 300000;      // 单次遍历节点上限，防止异常大对象卡页面
  var MAX_SEEN = 5000;
  var seen = new Map();        // id -> "followers|following"
  var all = new Map();         // id -> user，内容脚本晚到时补发

  function remember(id, sig) {
    if (seen.get(id) === sig) return false;
    seen.delete(id);
    seen.set(id, sig);
    if (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value);
    return true;
  }

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : undefined; }

  // 从一个对象里读出 {screen, followers, following}；不是用户节点返回 null
  function readUser(o) {
    var legacy = o.legacy && typeof o.legacy === 'object' ? o.legacy : null;
    var rc = o.relationship_counts && typeof o.relationship_counts === 'object' ? o.relationship_counts : null;
    var followers = rc ? num(rc.followers) : undefined;
    if (followers === undefined && legacy) followers = num(legacy.followers_count);
    if (followers === undefined && o.__typename === 'User') followers = num(o.followers_count);
    if (followers === undefined) return null;
    var screen = (o.core && typeof o.core.screen_name === 'string' && o.core.screen_name) ||
      (legacy && typeof legacy.screen_name === 'string' && legacy.screen_name) ||
      (o.__typename === 'User' && typeof o.screen_name === 'string' && o.screen_name) || '';
    if (!screen) return null;
    var following = rc ? num(rc.following) : undefined;
    if (following === undefined && legacy) following = num(legacy.friends_count);
    if (following === undefined) following = -1;
    return { screen: screen, followers: followers, following: following };
  }

  // 迭代式遍历 + visited 集合：新版 SSR 数据（seroval）是带共享引用、可能有环的对象图
  function collectUsers(root) {
    var out = [];
    var visited = new WeakSet();
    var stack = [root, 0];
    var n = 0;
    while (stack.length && n < MAX_NODES) {
      var depth = stack.pop();
      var node = stack.pop();
      if (!node || typeof node !== 'object' || depth > MAX_DEPTH || visited.has(node)) continue;
      visited.add(node);
      n++;
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) {
          var it = node[i];
          if (it && typeof it === 'object') stack.push(it, depth + 1);
        }
        continue;
      }
      var u;
      try { u = readUser(node); } catch (e) { u = null; }
      if (u) {
        var id = String(node.rest_id || (node.legacy && node.legacy.id_str) || u.screen);
        if (remember(id, u.followers + '|' + u.following)) {
          var rec = { screen_name: u.screen, followers_count: u.followers, friends_count: u.following };
          all.delete(id); all.set(id, rec);
          if (all.size > MAX_SEEN) all.delete(all.keys().next().value);
          out.push(rec);
        }
      }
      var keys;
      try { keys = Object.keys(node); } catch (e) { continue; }
      for (var k = 0; k < keys.length; k++) {
        var v;
        try { v = node[keys[k]]; } catch (e) { continue; }
        if (v && typeof v === 'object') stack.push(v, depth + 1);
      }
    }
    return out;
  }

  function post(users) {
    if (users.length) window.postMessage({ __x_fans_count__: true, users: users }, location.origin);
  }

  function handleJson(json) {
    try { post(collectUsers(json)); } catch (e) { /* 忽略解析异常 */ }
  }

  // 响应文本：普通 JSON；或流式/多段（multipart、NDJSON）时逐段解析
  function handleText(text) {
    if (typeof text !== 'string' || !text) return;
    try { handleJson(JSON.parse(text)); return; } catch (e) { /* 不是单个 JSON */ }
    var parts = text.split(/\r?\n/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p.charAt(0) !== '{' && p.charAt(0) !== '[') continue;
      try { handleJson(JSON.parse(p)); } catch (e) { /* ignore */ }
    }
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.__x_fans_ready__ !== true) return;
    if (all.size) post(Array.from(all.values()));
  });

  // ---- 新版首屏：捕获 self.$R（seroval 流式水合数据）的引用 ----
  // 页面脚本形如 (self.$R=self.$R||{})["tsr"]=[]; ... $R[51]={...GraphQL 响应...}
  // 水合结束后页面会 delete self.$R.tsr，所以在赋值时就把数组引用留下来。
  var ssrArrays = [];
  function keepArray(v) {
    if (Array.isArray(v) && ssrArrays.indexOf(v) === -1) ssrArrays.push(v);
  }
  function wrapRObject(obj) {
    if (!obj || typeof obj !== 'object' || obj.__xfcWrapped) return obj;
    try {
      Object.defineProperty(obj, '__xfcWrapped', { value: true });
      var tsrVal = obj.tsr;
      keepArray(tsrVal);
      Object.defineProperty(obj, 'tsr', {
        configurable: true, enumerable: true,
        get: function () { return tsrVal; },
        set: function (v) { tsrVal = v; keepArray(v); }
      });
    } catch (e) { /* ignore */ }
    return obj;
  }
  try {
    var rVal = window.$R;
    if (rVal) wrapRObject(rVal);
    Object.defineProperty(window, '$R', {
      configurable: true, enumerable: false,
      get: function () { return rVal; },
      set: function (v) { rVal = wrapRObject(v); }
    });
  } catch (e) { /* ignore */ }

  function scanSsr() {
    try {
      if (window.$R && typeof window.$R === 'object') {
        for (var k in window.$R) {
          if (Object.prototype.hasOwnProperty.call(window.$R, k)) keepArray(window.$R[k]);
        }
      }
      for (var i = 0; i < ssrArrays.length; i++) post(collectUsers(ssrArrays[i]));
    } catch (e) { /* ignore */ }
  }
  document.addEventListener('x-web:bootstrap-data', function () { setTimeout(scanSsr, 0); });
  document.addEventListener('DOMContentLoaded', scanSsr);
  window.addEventListener('load', scanSsr);
  [1000, 3000, 6000, 10000].forEach(function (t) { setTimeout(scanSsr, t); });

  function toUrl(input) {
    if (typeof input === 'string') return input;
    if (!input) return '';
    if (typeof input.url === 'string') return input.url;          // Request
    if (typeof input.href === 'string') return input.href;        // URL 对象
    return '';
  }

  function isGraphql(url) {
    return typeof url === 'string' && url.indexOf('/graphql/') !== -1;
  }

  function isTextual(res) {
    var ct = res.headers && res.headers.get && res.headers.get('content-type');
    return !ct || /json|multipart|text\//.test(ct);
  }

  // ---- 包装 fetch ----
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function () {
      var p = origFetch.apply(this, arguments);
      try {
        if (isGraphql(toUrl(arguments[0]))) {
          p.then(function (res) {
            if (res && res.ok && isTextual(res)) {
              res.clone().text().then(handleText, function () {});
            }
          }, function () {});
        }
      } catch (e) { /* ignore */ }
      return p;
    };
  }

  // ---- 包装 XHR（兜底），只给 GraphQL 请求挂监听 ----
  var XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHR) {
    var origOpen = XHR.open;
    var origSend = XHR.send;
    XHR.open = function (method, url) {
      try { this.__xfcUrl = toUrl(url); } catch (e) { this.__xfcUrl = ''; }
      return origOpen.apply(this, arguments);
    };
    XHR.send = function () {
      if (isGraphql(this.__xfcUrl)) {   // 只给 GraphQL 请求挂监听
        var xhr = this;
        xhr.addEventListener('loadend', function () {
          try {
            if (xhr.readyState !== 4) return;
            if (!(xhr.status >= 200 && xhr.status < 300)) return;
            // open 时 URL 判断失败时，用 responseURL 兜底确认是 GraphQL
            if (!isGraphql(xhr.__xfcUrl) && !isGraphql(xhr.responseURL || '')) return;
            var rt = xhr.responseType;
            if (rt === 'json') handleJson(xhr.response);
            else if (rt === '' || rt === 'text') handleText(xhr.responseText);
            else if (rt === 'arraybuffer' && xhr.response) {
              handleText(new TextDecoder().decode(xhr.response));
            }
          } catch (e) { /* ignore */ }
        });
      }
      return origSend.apply(this, arguments);
    };
  }
})();
