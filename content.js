/* X 粉丝数显示 —— 内容脚本（ISOLATED world）
 * 接收 inject.js 提取的 {screen_name, followers_count, friends_count}，
 * 在用户名下方插入「粉丝 X万」。只用 textContent 写入，不使用 innerHTML。
 * 支持关注/粉丝/认证粉丝/点赞转帖人/推荐关注等用户列表。
 */
(function () {
  'use strict';

  var MAX_CACHE = 5000;
  var BADGE_CLASS = 'xfc-badge';
  var SCREEN_ATTR = 'data-xfc-screen';
  // 旧版 X（data-testid）与 2026 新版 x-web（无 data-testid，纯 Tailwind class）都支持
  var ROOT_SEL = 'article, div[data-testid="UserCell"], button[data-testid="UserCell"], ' +
    'div[data-testid="HoverCard"], [role="dialog"], li, [data-href], [role="listitem"]';
  var NAME_SEL = 'div[data-testid="User-Name"]';

  var fans = new Map(); // screen_name(小写) -> {f: followers, g: following}

  var RESERVED = {
    home: 1, explore: 1, notifications: 1, messages: 1, bookmarks: 1,
    lists: 1, communities: 1, premium: 1, verified: 1, jobs: 1,
    i: 1, search: 1, settings: 1, compose: 1, tos: 1, privacy: 1,
    about: 1, login: 1, signup: 1, logout: 1, download: 1, share: 1,
    hashtag: 1, intent: 1, grok: 1
  };

  function isZh() {
    var lang = (document.documentElement.getAttribute('lang') || navigator.language || '').toLowerCase();
    return lang.indexOf('zh') === 0;
  }

  function trim1(x) { // 保留 1 位小数并去掉 .0
    var s = x.toFixed(1);
    return s.slice(-2) === '.0' ? s.slice(0, -2) : s;
  }

  // 中文：9,999 / 1.2万 / 3.4亿；其他语言：9,999 / 12K / 1.2M / 3.4B
  function formatCount(n, zh) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0) return '';
    if (zh) {
      if (n < 1e4) return n.toLocaleString('en-US');
      var w = n / 1e4;
      if (Number(w.toFixed(1)) < 1e4) return trim1(w) + '万'; // 防止出现 "10000万"
      return trim1(n / 1e8) + '亿';
    }
    if (n < 1e4) return n.toLocaleString('en-US');
    if (n < 1e6 && Number((n / 1e3).toFixed(1)) < 1e3) return trim1(n / 1e3) + 'K';
    if (n < 1e9 && Number((n / 1e6).toFixed(1)) < 1e3) return trim1(n / 1e6) + 'M';
    return trim1(n / 1e9) + 'B';
  }

  function renderBadge(badge, screen) {
    var d = fans.get(screen);
    if (!d) return;
    var zh = isZh();
    var text = (zh ? '粉丝 ' : '') + formatCount(d.f, zh) + (zh ? '' : ' followers');
    if (badge.textContent !== text) badge.textContent = text;
    var tip = d.f.toLocaleString('en-US') + (zh ? ' 位粉丝' : ' followers');
    if (d.g >= 0) {
      tip += zh ? '\n正在关注 ' : '\nFollowing ';
      tip += d.g.toLocaleString('en-US');
      if (d.g > 0) tip += (zh ? '\n粉丝/关注比 ' : '\nRatio ') + (d.f / d.g).toFixed(2);
    }
    if (badge.title !== tip) badge.title = tip;
  }

  function validUser(u) {
    return u && typeof u.screen_name === 'string' &&
      /^[A-Za-z0-9_]{1,15}$/.test(u.screen_name) &&
      Number.isSafeInteger(u.followers_count) && u.followers_count >= 0;
  }

  function setUser(key, rec) {
    fans.delete(key);               // 简单 LRU：重新插入到末尾
    fans.set(key, rec);
    if (fans.size > MAX_CACHE) fans.delete(fans.keys().next().value);
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window || e.origin !== location.origin) return; // 只收本页面消息
    var d = e.data;
    if (!d || d.__x_fans_count__ !== true || !Array.isArray(d.users)) return;
    var changed = false;
    for (var i = 0; i < d.users.length && i < 2000; i++) {
      var u = d.users[i];
      if (!validUser(u)) continue;
      var key = u.screen_name.toLowerCase();
      var g = Number.isSafeInteger(u.friends_count) && u.friends_count >= 0 ? u.friends_count : -1;
      var old = fans.get(key);
      if (!old || old.f !== u.followers_count || old.g !== g) {
        setUser(key, { f: u.followers_count, g: g });
        changed = true;
      }
    }
    if (changed) schedule(document);
  });

  function injectStyle() {
    if (document.getElementById('xfc-style')) return;
    var style = document.createElement('style');
    style.id = 'xfc-style';
    style.textContent =
      '.' + BADGE_CLASS + '{color:rgb(29,155,240)!important;font-size:13px!important;' +
      'line-height:18px!important;margin-top:1px!important;font-weight:400!important;' +
      'font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;' +
      'text-overflow:ellipsis;cursor:default;}' +
      '.' + BADGE_CLASS + '.xfc-inline{display:inline-block!important;margin:0 0 0 6px!important;' +
      'flex-shrink:0!important;line-height:inherit!important;}' +
      '.' + BADGE_CLASS + '.xfc-cell{display:inline-block!important;margin:0 0 0 6px!important;' +
      'padding:0 6px!important;border-radius:4px!important;' +
      'background:rgba(29,155,240,0.12)!important;color:rgb(29,155,240)!important;' +
      'font-size:13px!important;line-height:20px!important;font-weight:500!important;' +
      'white-space:nowrap;flex-shrink:0!important;vertical-align:middle;}' +
      'html.xfc-hidden .' + BADGE_CLASS + '{display:none!important;}';
    (document.head || document.documentElement).appendChild(style);
  }

  function screenOf(box) {
    var links = box.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var m = (links[i].getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})$/);
      if (m && !RESERVED[m[1].toLowerCase()]) return m[1].toLowerCase();
    }
    return null;
  }

  // 处理一个 User-Name 容器：没有徽标就补，有但用户变了（React 复用节点）就更新
  function paintBox(box) {
    if (nearestCell(box)) {          // 列表项里的显示名交给 paintCell，避免重复
      var oldBoxBadge = box.querySelector(':scope > .' + BADGE_CLASS);
      if (oldBoxBadge && !oldBoxBadge.classList.contains('xfc-cell')) oldBoxBadge.remove();
      return;
    }
    var screen = screenOf(box);
    var badge = box.querySelector(':scope > .' + BADGE_CLASS);
    if (!screen || !fans.has(screen)) {
      if (badge) badge.remove();      // 节点被复用成了没有数据的用户，去掉旧徽标
      return;
    }
    if (!badge) {
      badge = document.createElement('div');
      badge.className = BADGE_CLASS;
      box.appendChild(badge);
    }
    box.setAttribute(SCREEN_ATTR, screen);
    renderBadge(badge, screen);
  }

  // ---- 新版 x-web：没有 data-testid="User-Name"。
  // 推文头 / 用户卡片里是「<a href="/h">显示名</a> … <a href="/h"><span>@h</span></a>」，
  // 徽标插在 @handle 链接后面。正文里的 @提及 附近没有同 href 的显示名链接，据此排除。
  var HANDLE_RE = /^\/([A-Za-z0-9_]{1,15})$/;

  function handleOf(a) {
    var m = (a.getAttribute('href') || '').match(HANDLE_RE);
    if (!m || RESERVED[m[1].toLowerCase()]) return null;
    var h = m[1].toLowerCase();
    var t = (a.textContent || '').trim().toLowerCase();
    if (t !== '@' + h) return null;
    if (a.closest(NAME_SEL)) return null;              // 旧版布局交给 paintBox
    var scope = a.parentElement && a.parentElement.parentElement;
    if (!scope) return null;
    var sibs = scope.querySelectorAll('a[href]');
    for (var i = 0; i < sibs.length; i++) {
      var s = sibs[i];
      if (s === a || (s.getAttribute('href') || '').toLowerCase() !== '/' + h) continue;
      var st = (s.textContent || '').trim();
      if (st && st.charAt(0) !== '@') return h;       // 找到同一用户的显示名链接
    }
    return null;
  }

  function paintHandle(a) {
    if (nearestCell(a)) {            // 列表项交给 paintCell，清掉可能插入的非列表徽章
      var nb = a.nextElementSibling;
      if (nb && nb.classList && nb.classList.contains(BADGE_CLASS) &&
          !nb.classList.contains('xfc-cell')) nb.remove();
      return;
    }
    var h = handleOf(a);
    var next = a.nextElementSibling;
    var badge = next && next.classList.contains(BADGE_CLASS) ? next : null;
    if (!h || !fans.has(h)) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = BADGE_CLASS + ' xfc-inline';
      a.insertAdjacentElement('afterend', badge);
    }
    badge.setAttribute(SCREEN_ATTR, h);
    renderBadge(badge, h);
  }

  // ---- 用户列表项（UserCell）识别：关注/粉丝/认证粉丝/点赞转帖人/推荐关注等 ----
  // 旧版列表项 div/button[data-testid="UserCell"]；新版 x-web 列表项 [data-href]；
  // 以及只有头像链接 + 显示名链接的 li / [role="listitem"]。
  // 列表项里没有 data-testid="User-Name"，@handle 与显示名也不在同一祖父节点下，
  // 所以 paintBox / handleOf 匹配不到，需要单独处理并在显示名 + 蓝标后插徽章。
  var CELL_SEL = '[data-testid="UserCell"], [data-href], li, [role="listitem"]';

  function nearestCell(el) {
    var n = el;
    while (n && n.nodeType === 1) {
      if (isCell(n)) return n;
      n = n.parentElement;
    }
    return null;
  }

  function isCell(el) {
    if (!el || el.nodeType !== 1 || !el.matches || !el.matches(CELL_SEL)) return false;
    if (el.closest('article')) return false;                       // 帖子，不是用户列表项
    if (el.querySelector('article')) return false;
    if (el.getAttribute('data-testid') === 'UserCell') {           // 旧版列表项
      // 最内层优先：UserCell 内部还嵌 UserCell 时，外层容器不算
      return !el.querySelector('[data-testid="UserCell"]');
    }
    // 最内层优先：外层 li/容器里若还有更内层的 cell，交给内层处理
    if (el.querySelector('[data-testid="UserCell"]')) return false;
    var nested = el.querySelectorAll('[data-href]');
    for (var i = 0; i < nested.length; i++) {
      var nm = (nested[i].getAttribute('data-href') || '').match(HANDLE_RE);
      if (nm && !RESERVED[nm[1].toLowerCase()]) return false;
    }
    var dh = el.getAttribute('data-href');
    if (dh) {                                                      // 新版 x-web 列表项
      var m = dh.match(HANDLE_RE);
      return !!(m && !RESERVED[m[1].toLowerCase()]);
    }
    // li / [role=listitem]：必须有头像链接，且所有头像链接都指向同一个 handle
    var ah = avatarHandles(el);
    if (!ah.length) return false;                                  // 无头像的 li（导航菜单等）不算
    for (var j = 1; j < ah.length; j++) {
      if (ah[j] !== ah[0]) return false;                           // 包了多个用户的大容器
    }
    return !!cellUser(el);
  }

  // cell 内所有头像链接（含 img / .x-avatar / UserAvatar）指向的 handle
  function avatarHandles(cell) {
    var out = [];
    var links = cell.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (!(a.querySelector('img') || a.querySelector('.x-avatar') ||
            a.querySelector('[data-testid="UserAvatar"]'))) continue;
      var m = (a.getAttribute('href') || '').match(HANDLE_RE);
      if (m && !RESERVED[m[1].toLowerCase()]) out.push(m[1].toLowerCase());
    }
    return out;
  }

  function cellUser(cell) {
    var screen = null;
    // a. 头像容器的 data-testid 后缀
    var av = cell.querySelector('[data-testid^="UserAvatar-Container-"]');
    if (av) {
      var t = av.getAttribute('data-testid') || '';
      var am = t.slice('UserAvatar-Container-'.length).match(/^([A-Za-z0-9_]{1,15})$/);
      if (am && !RESERVED[am[1].toLowerCase()]) screen = am[1].toLowerCase();
    }
    // b. cell 自身 data-href
    if (!screen) {
      var dm = (cell.getAttribute('data-href') || '').match(HANDLE_RE);
      if (dm && !RESERVED[dm[1].toLowerCase()]) screen = dm[1].toLowerCase();
    }
    var links = cell.querySelectorAll('a[href]');
    // c. 头像链接（含 img / .x-avatar / UserAvatar）
    if (!screen) {
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        if (!(a.querySelector('img') || a.querySelector('.x-avatar') ||
              a.querySelector('[data-testid="UserAvatar"]'))) continue;
        var cm = (a.getAttribute('href') || '').match(HANDLE_RE);
        if (cm && !RESERVED[cm[1].toLowerCase()]) { screen = cm[1].toLowerCase(); break; }
      }
    }
    // d. 兜底：DOM 顺序第一个有效 handle 链接
    if (!screen) {
      for (var j = 0; j < links.length; j++) {
        var fm = (links[j].getAttribute('href') || '').match(HANDLE_RE);
        if (fm && !RESERVED[fm[1].toLowerCase()]) { screen = fm[1].toLowerCase(); break; }
      }
    }
    if (!screen) return null;
    // 显示名链接：同 href、有文字、不以 @ 开头、非头像；简介里的 @提及 href 是别人，不受影响
    for (var k = 0; k < links.length; k++) {
      var nl = links[k];
      if ((nl.getAttribute('href') || '').toLowerCase() !== '/' + screen) continue;
      if (nl.querySelector('img')) continue;
      var txt = (nl.textContent || '').trim();
      if (!txt || txt.charAt(0) === '@') continue;
      return { screen: screen, nameLink: nl };
    }
    return null;                                                   // 找不到显示名就不插
  }

  function isRow(el) {
    var cs = getComputedStyle(el);
    return (cs.display === 'flex' || cs.display === 'inline-flex') &&
      cs.flexDirection.indexOf('row') === 0;
  }

  function cellBadges(cell) {
    var found = cell.querySelectorAll('.xfc-cell');
    var out = [];
    for (var i = 0; i < found.length; i++) {
      if (nearestCell(found[i]) === cell) out.push(found[i]);       // 只算属于本 cell 的徽章
    }
    return out;
  }

  function isIconLike(el) {
    if (el.classList && el.classList.contains(BADGE_CLASS)) return false;
    if ((el.textContent || '').trim() !== '') return false;
    return !!(el.querySelector('svg, img') || el.matches('svg, img'));
  }

  // 徽章锚点：旧版名字行（名字+蓝标）在 <a> 内部则 append 到 inner 末尾；
  // 否则紧跟显示名链接，并跳过紧挨着的「纯图标」兄弟（蓝标/机构徽标）
  function badgeAnchor(nameLink) {
    var inner = nameLink.firstElementChild;
    if (inner && isRow(inner) && inner.parentElement === nameLink &&
        !isRow(nameLink.parentElement || nameLink)) {
      return { parent: inner, after: null };
    }
    var ref = nameLink;
    while (ref.nextElementSibling && isIconLike(ref.nextElementSibling)) {
      ref = ref.nextElementSibling;
    }
    return { parent: ref.parentElement, after: ref };
  }

  function paintCell(cell) {
    var existing = cellBadges(cell);
    var u = cellUser(cell);
    if (!u || !fans.has(u.screen)) {
      for (var i = 0; i < existing.length; i++) existing[i].remove();
      return;
    }
    var screen = u.screen;
    var anchor = badgeAnchor(u.nameLink);
    var badge = null;
    for (var j = 0; j < existing.length; j++) {
      var b = existing[j];
      var inPlace = anchor.after
        ? anchor.after.nextElementSibling === b
        : (b.parentElement === anchor.parent && b === anchor.parent.lastElementChild);
      if (!badge && inPlace &&
          (b.getAttribute(SCREEN_ATTR) || '').toLowerCase() === screen) {
        badge = b;                           // 复用已在正确位置、同一用户的徽章
      }
    }
    for (var k = 0; k < existing.length; k++) {
      if (existing[k] !== badge) existing[k].remove();   // 每个 cell 只留一个徽章
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = BADGE_CLASS + ' xfc-inline xfc-cell';
      if (anchor.after) anchor.after.insertAdjacentElement('afterend', badge);
      else if (anchor.parent) anchor.parent.appendChild(badge);
      else u.nameLink.insertAdjacentElement('afterend', badge);
    }
    badge.setAttribute(SCREEN_ATTR, screen);
    renderBadge(badge, screen);
  }

  function paintRoot(root) {
    // 用户列表项（关注/粉丝/认证粉丝/点赞转帖人/推荐关注等）：在显示名 + 蓝标后补徽章
    var cells = root.querySelectorAll ? root.querySelectorAll(CELL_SEL) : [];
    for (var k = 0; k < cells.length; k++) if (isCell(cells[k])) paintCell(cells[k]);
    if (root.matches && root.matches(CELL_SEL) && isCell(root)) paintCell(root);
    // 旧版：一条推文里可能有多个 User-Name（引用推文作者）
    var boxes = root.matches && root.matches(NAME_SEL) ? [root] : root.querySelectorAll(NAME_SEL);
    for (var i = 0; i < boxes.length; i++) paintBox(boxes[i]);
    // 新版
    var links = root.querySelectorAll ? root.querySelectorAll('a[href^="/"]') : [];
    for (var j = 0; j < links.length; j++) paintHandle(links[j]);
    if (root.matches && root.matches('a[href^="/"]')) paintHandle(root);
  }

  // ---- 批处理：把变更攒到下一帧统一处理，避免每次 DOM 变动都同步扫描 ----
  var pending = new Set();
  var scheduled = false;
  var fullScan = false;

  function schedule(node) {
    if (node === document) fullScan = true;
    else pending.add(node);
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(flush);
  }

  function flush() {
    scheduled = false;
    if (fullScan) {
      fullScan = false;
      pending.clear();
      paintRoot(document);
      return;
    }
    var nodes = pending;
    pending = new Set();
    nodes.forEach(function (n) {
      if (!n.isConnected) return;
      var cell = n.nodeType === 1 ? nearestCell(n) : null;
      if (cell) { paintRoot(cell); return; }   // React 只更新 cell 内部子节点时也能补徽章
      var root = n.closest ? n.closest(ROOT_SEL) : null;
      paintRoot(root || n);
    });
  }

  var observer = new MutationObserver(function (mutations) {
    if (!fans.size) return; // 还没有数据时不必处理
    for (var i = 0; i < mutations.length; i++) {
      var mu = mutations[i];
      if (mu.type === 'attributes') {           // React 复用节点只改 href/data-href 时也要重画
        var t = mu.target;
        if (t.nodeType !== 1) continue;
        if (t.classList && t.classList.contains(BADGE_CLASS)) continue; // 忽略徽章自身的属性
        schedule(t);
        continue;
      }
      var added = mu.addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (n.nodeType !== 1) continue;
        if (n.classList && n.classList.contains(BADGE_CLASS)) continue; // 忽略自己插入的徽标
        schedule(n);
      }
    }
  });

  // Alt+Shift+F 临时显示/隐藏徽标（不持久化，不需要 storage 权限）
  document.addEventListener('keydown', function (e) {
    if (e.altKey && e.shiftKey && (e.code === 'KeyF')) {
      document.documentElement.classList.toggle('xfc-hidden');
    }
  }, true);

  // 立即通知页面脚本补发已收集的数据（监听器已注册）
  window.postMessage({ __x_fans_ready__: true }, location.origin);

  function start() {
    injectStyle();
    schedule(document);
    observer.observe(document.body || document.documentElement, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['href', 'data-href']
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
