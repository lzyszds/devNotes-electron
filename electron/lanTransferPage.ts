/**
 * 局域网中转台的手机端页面。由电脑端服务直接返回，没有任何外部资源。
 *
 * 兼容性目标：iOS 9+ Safari、Android 4.4+ 系统 WebView（Chromium 37+）。
 * - JS 只用 ES5：var、function、字符串拼接，不用箭头函数、const、模板字符串、Promise、fetch。
 * - 网络请求全部走 XMLHttpRequest，DOM 只用 ES5 时代就有的 API（不用 remove()、classList 之外的新接口）。
 * - CSS 不用变量（var）、flex 的 gap、inset、aspect-ratio；动画和变换加 -webkit- 前缀；
 *   安全区用 env() 时前面必须先写一条不带 env 的兜底声明。
 * - 深色模式用 prefers-color-scheme，旧浏览器不认识时自动落回浅色。
 */
export const LAN_TRANSFER_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>局域网互传</title>
<style>
  * { -webkit-box-sizing: border-box; box-sizing: border-box; -webkit-tap-highlight-color: rgba(0,0,0,0); }
  html, body { margin: 0; min-height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", Arial, sans-serif;
    font-size: 15px;
    line-height: 1.5;
    color: #0f172a;
    background-color: #f1f7f8;
    background-image: -webkit-radial-gradient(50% 0%, ellipse closest-side, rgba(20,184,166,0.22), rgba(20,184,166,0));
    background-image: radial-gradient(ellipse at 50% -10%, rgba(20,184,166,0.22), rgba(20,184,166,0) 60%);
    padding: 0 16px 28px;
    padding-bottom: 28px;
    padding-bottom: calc(env(safe-area-inset-bottom) + 28px);
    min-height: 100%;
  }
  .wrap { max-width: 540px; margin: 0 auto; }

  header { text-align: center; padding: 26px 0 16px; }
  .logo {
    width: 56px; height: 56px; margin: 0 auto 12px; border-radius: 18px;
    background: #0f8a9b; background-image: -webkit-linear-gradient(135deg, #0f8a9b, #14b8a6); background-image: linear-gradient(135deg, #0f8a9b, #14b8a6);
    box-shadow: 0 10px 30px -8px rgba(15,138,155,0.55);
    -webkit-animation: pop 0.6s cubic-bezier(.2,.9,.3,1.2) both; animation: pop 0.6s cubic-bezier(.2,.9,.3,1.2) both;
  }
  .logo svg { display: block; margin: 14px auto 0; width: 27px; height: 27px; color: #fff; }
  h1 { font-size: 21px; margin: 0; letter-spacing: -0.2px; }
  header p { margin: 5px 0 0; color: #64748b; font-size: 13px; }

  /* 分段切换：两个等宽按钮，用 float 布局，旧浏览器也稳 */
  .seg { margin: 18px 0 14px; padding: 4px; border-radius: 14px; background: rgba(15,23,42,0.06); overflow: hidden; }
  .seg button {
    float: left; width: 50%; margin: 0; padding: 9px 0; border: 0; border-radius: 10px;
    font: inherit; font-size: 14px; font-weight: 600; color: #64748b; background: transparent; cursor: pointer;
    -webkit-appearance: none; appearance: none;
  }
  .seg button.on { background: #ffffff; color: #0f8a9b; box-shadow: 0 1px 3px rgba(15,23,42,0.08); }
  .dot { display: inline-block; width: 6px; height: 6px; margin-left: 6px; border-radius: 50%; background: #14b8a6; vertical-align: middle; }
  .dot.off { display: none; }

  .card {
    background: #ffffff; border: 1px solid rgba(15,23,42,0.08); border-radius: 18px; padding: 16px;
    box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 12px 32px -18px rgba(15,23,42,0.25);
  }
  .card + .card { margin-top: 12px; }
  .pane.off { display: none; }

  .pick {
    position: relative; display: block; width: 100%; padding: 24px 14px; text-align: center;
    border: 1.5px dashed rgba(15,138,155,0.45); border-radius: 14px;
    background: #f0fbfa; color: #0f8a9b; font-weight: 600; cursor: pointer; overflow: hidden;
  }
  .pick small { display: block; margin-top: 6px; color: #64748b; font-weight: 400; font-size: 12.5px; }
  .pick input { position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }

  textarea {
    display: block; width: 100%; min-height: 96px; padding: 10px 12px; margin: 0;
    border: 1px solid rgba(15,23,42,0.08); border-radius: 12px; background: #f1f7f8;
    font: inherit; font-size: 15px; color: #0f172a; outline: none; resize: vertical;
    -webkit-appearance: none; appearance: none;
  }
  .btn {
    display: block; width: 100%; margin: 10px 0 0; padding: 11px; border: 0; border-radius: 12px;
    background: #0f8a9b; background-image: -webkit-linear-gradient(135deg, #0f8a9b, #14b8a6); background-image: linear-gradient(135deg, #0f8a9b, #14b8a6);
    color: #fff; font: inherit; font-size: 14.5px; font-weight: 600; cursor: pointer;
    -webkit-appearance: none; appearance: none;
  }
  .btn[disabled] { opacity: 0.45; }

  .head { margin: 18px 4px 8px; font-size: 13px; color: #64748b; overflow: hidden; }
  .head .l { float: left; }
  .head .r { float: right; }
  .head:first-child { margin-top: 0; }
  .count { padding: 2px 9px; border-radius: 999px; background: rgba(15,138,155,0.12); color: #0f8a9b; font-size: 12px; font-weight: 600; }

  ul { list-style: none; margin: 0; padding: 0; }
  li {
    padding: 11px 12px; margin-top: 9px; border: 1px solid rgba(15,23,42,0.08); border-radius: 15px; background: #ffffff;
    -webkit-animation: rise 0.35s ease-out both; animation: rise 0.35s ease-out both;
  }
  li:first-child { margin-top: 0; }
  .row { overflow: hidden; }
  .meta { overflow: hidden; }
  .name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { margin-top: 2px; color: #64748b; font-size: 12px; }
  .txt { margin-top: 6px; font-size: 13.5px; white-space: pre-wrap; word-wrap: break-word; word-break: break-all; max-height: 120px; overflow: auto; }
  .act {
    float: right; margin-left: 10px; padding: 6px 11px; border: 0; border-radius: 9px;
    background: rgba(15,138,155,0.1); color: #0f8a9b; font: inherit; font-size: 12.5px; font-weight: 600;
    text-decoration: none; cursor: pointer; -webkit-appearance: none; appearance: none;
  }
  .act.done { background: rgba(5,150,105,0.14); color: #059669; }
  .state { float: right; margin-left: 10px; font-size: 12px; font-weight: 600; }
  .state.ok { color: #059669; }
  .state.err { color: #e11d48; }
  .state.busy { color: #0f8a9b; }
  .bar { height: 4px; margin-top: 7px; border-radius: 4px; background: rgba(100,116,139,0.18); overflow: hidden; }
  .bar i { display: block; height: 100%; width: 0; background: #14b8a6; -webkit-transition: width 0.15s linear; transition: width 0.15s linear; }
  .retry { float: right; margin-left: 8px; padding: 4px 6px; border: 0; background: none; color: #e11d48; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  .empty { padding: 26px 0; text-align: center; color: #64748b; font-size: 13px; }
  footer { margin-top: 22px; text-align: center; color: #64748b; font-size: 12px; line-height: 1.7; }

  .toast {
    position: fixed; left: 50%; bottom: 24px; margin-left: -110px; width: 220px; padding: 10px 16px;
    border-radius: 999px; background: #0f172a; color: #f1f7f8; font-size: 13.5px; font-weight: 600; text-align: center;
    box-shadow: 0 10px 30px -10px rgba(0,0,0,0.4); opacity: 0; visibility: hidden;
    -webkit-transition: opacity 0.25s ease, visibility 0.25s; transition: opacity 0.25s ease, visibility 0.25s;
  }
  .toast.show { opacity: 1; visibility: visible; }

  @-webkit-keyframes rise { from { opacity: 0; -webkit-transform: translateY(10px); } to { opacity: 1; -webkit-transform: none; } }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  @-webkit-keyframes pop { from { opacity: 0; -webkit-transform: scale(0.6); } to { opacity: 1; -webkit-transform: scale(1); } }
  @keyframes pop { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }

  @media (prefers-color-scheme: dark) {
    body { color: #f1f5f9; background-color: #0b1119; }
    .card, li { background: #141b26; border-color: rgba(255,255,255,0.08); }
    .seg { background: rgba(255,255,255,0.07); }
    .seg button.on { background: #141b26; color: #14b8a6; }
    .pick { background: rgba(20,184,166,0.06); }
    textarea { background: #0b1119; border-color: rgba(255,255,255,0.08); color: #f1f5f9; }
    .head, header p, .sub, .empty, footer { color: #94a3b8; }
    .txt, .name { color: #f1f5f9; }
    .act { color: #14b8a6; }
  }
  @media (prefers-reduced-motion: reduce) {
    li, .logo { -webkit-animation: none; animation: none; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="logo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h11l-3-3"/><path d="M17 17H6l3 3"/></svg>
    </div>
    <h1>局域网互传</h1>
    <p>手机和电脑之间，文件、图片、文字都能传</p>
  </header>

  <div class="seg">
    <button id="tab-send" class="on" type="button">发给电脑</button>
    <button id="tab-recv" type="button">从电脑获取<span class="dot off" id="recv-dot"></span></button>
  </div>

  <!-- 发给电脑 -->
  <div id="pane-send" class="pane">
    <div class="card">
      <label class="pick">
        <span>选择文件或图片</span>
        <small>可以多选，选完自动发送</small>
        <input id="file" type="file" multiple />
      </label>
    </div>
    <div class="card">
      <textarea id="text" placeholder="粘贴验证码、链接、Token 或一段文字…"></textarea>
      <button id="send-text" class="btn" type="button" disabled="disabled">发送文字到电脑</button>
    </div>

    <div id="sent-section" class="off">
      <div class="head"><span class="l">本次发送</span><span class="r count" id="sent-count">0</span></div>
      <ul id="sent-list"></ul>
    </div>
  </div>

  <!-- 从电脑获取 -->
  <div id="pane-recv" class="pane off">
    <div class="head"><span class="l">电脑发来的</span><span class="r count" id="recv-count">0</span></div>
    <ul id="recv-list"></ul>
    <p class="empty" id="recv-empty">电脑端添加文件或文字后，会出现在这里</p>
  </div>

  <footer>
    仅在同一 Wi-Fi 下可用<br />
    关闭电脑端的「局域网互传」后，此页面会失效
  </footer>
</div>
<div class="toast" id="toast"></div>

<script>
(function () {
  var base = location.pathname.replace(/\\/+$/, '');
  var MAX = 200 * 1024 * 1024;
  var toastTimer = null;
  var sentCount = 0;
  var seenRecv = {};
  var recvReady = false;

  function $(id) { return document.getElementById(id); }

  function show(node, visible) {
    if (visible) { node.className = node.className.replace(/\\boff\\b/g, '').replace(/\\s+$/, ''); }
    else if (node.className.indexOf('off') < 0) { node.className += ' off'; }
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.appendChild(document.createTextNode(String(text)));
    return node;
  }

  function fmt(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  function toast(text) {
    var node = $('toast');
    node.innerHTML = '';
    node.appendChild(document.createTextNode(text));
    node.className = 'toast show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.className = 'toast'; }, 1800);
  }

  function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  /* 所有请求都走 XMLHttpRequest，兼容没有 fetch / Promise 的旧浏览器 */
  function request(method, url, body, headers, onProgress, onDone) {
    var xhr;
    try { xhr = new XMLHttpRequest(); } catch (e) { onDone(false, 0, ''); return; }
    xhr.open(method, url, true);
    if (headers) {
      for (var key in headers) {
        if (headers.hasOwnProperty(key)) xhr.setRequestHeader(key, headers[key]);
      }
    }
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var ok = xhr.status >= 200 && xhr.status < 300;
      onDone(ok, xhr.status, xhr.responseText || '');
    };
    xhr.send(body);
  }

  /* 复制：优先 Clipboard API，旧浏览器退回 execCommand（iOS 需要特殊选区处理） */
  function copyText(text, done) {
    function fallback() {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'absolute';
      area.style.top = '0';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      var ok = false;
      if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        area.contentEditable = 'true';
        area.readOnly = true;
        var range = document.createRange();
        range.selectNodeContents(area);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        area.setSelectionRange(0, text.length);
      } else {
        area.select();
      }
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(area);
      done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
        return;
      } catch (e) {
        // 老环境没有 clipboard 对象，走下面的兜底
      }
    }
    fallback();
  }

  /* ---------- 标签 ---------- */
  function setTab(sendSide) {
    $('tab-send').className = sendSide ? 'on' : '';
    $('tab-recv').className = sendSide ? '' : 'on';
    show($('pane-send'), sendSide);
    show($('pane-recv'), !sendSide);
    if (!sendSide) show($('recv-dot'), false);
  }
  $('tab-send').onclick = function () { setTab(true); };
  $('tab-recv').onclick = function () { setTab(false); };

  /* ---------- 发给电脑 ---------- */
  function addSent(name, sub) {
    var li = el('li');
    var row = el('div', 'row');
    var meta = el('div', 'meta');
    var nameNode = el('div', 'name', name);
    var subNode = el('div', 'sub', sub);
    var bar = el('div', 'bar');
    var fill = el('i');
    bar.appendChild(fill);
    meta.appendChild(nameNode);
    meta.appendChild(subNode);
    meta.appendChild(bar);
    var state = el('div', 'state busy', '发送中');
    row.appendChild(state);
    row.appendChild(meta);
    li.appendChild(row);
    var list = $('sent-list');
    list.insertBefore(li, list.firstChild);
    show($('sent-section'), true);
    sentCount += 1;
    $('sent-count').innerHTML = '';
    $('sent-count').appendChild(document.createTextNode(String(sentCount)));
    return { li: li, meta: meta, sub: subNode, fill: fill, state: state };
  }

  function setState(item, kind, text) {
    item.state.className = 'state ' + kind;
    item.state.innerHTML = '';
    item.state.appendChild(document.createTextNode(text));
  }

  function failSent(item, message, retry) {
    setState(item, 'err', '失败');
    item.sub.innerHTML = '';
    item.sub.appendChild(document.createTextNode(message));
    item.fill.style.width = '0';
    if (retry) {
      var btn = el('button', 'retry', '重试');
      btn.type = 'button';
      btn.onclick = function () {
        item.meta.removeChild(btn);
        setState(item, 'busy', '发送中');
        item.sub.innerHTML = '';
        item.sub.appendChild(document.createTextNode('重新发送…'));
        retry();
      };
      item.meta.appendChild(btn);
    }
  }

  function sendFile(file, item) {
    request(
      'POST',
      base + '/upload',
      file,
      {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name || 'file')
      },
      function (ratio) { item.fill.style.width = Math.round(ratio * 100) + '%'; },
      function (ok, status) {
        if (ok) {
          item.fill.style.width = '100%';
          item.sub.innerHTML = '';
          item.sub.appendChild(document.createTextNode('已到电脑 · ' + fmt(file.size)));
          setState(item, 'ok', '已发送');
          vibrate(18);
        } else {
          failSent(item, status === 413 ? '文件超过 200 MB' : '网络断开，请确认同一 Wi-Fi', function () { sendFile(file, item); });
        }
      }
    );
  }

  $('file').onchange = function () {
    var files = [];
    var list = this.files || [];
    for (var i = 0; i < list.length; i += 1) files.push(list[i]);
    this.value = '';
    for (var j = 0; j < files.length; j += 1) {
      (function (file) {
        var item = addSent(file.name || '文件', fmt(file.size) + ' · 发送中');
        if (file.size > MAX) {
          failSent(item, '文件超过 200 MB', null);
          return;
        }
        sendFile(file, item);
      })(files[j]);
    }
  };

  function updateTextButton() {
    $('send-text').disabled = !$('text').value.replace(/^\\s+|\\s+$/g, '');
  }
  $('text').oninput = updateTextButton;
  $('text').onkeyup = updateTextButton;

  function sendText() {
    var value = $('text').value.replace(/^\\s+|\\s+$/g, '');
    if (!value) return;
    var btn = $('send-text');
    btn.disabled = true;
    var label = value.length > 24 ? value.slice(0, 24) + '…' : value;
    var item = addSent('文字 · ' + label, value.length + ' 字');
    request(
      'POST',
      base + '/text',
      JSON.stringify({ text: value }),
      { 'Content-Type': 'application/json' },
      null,
      function (ok) {
        if (ok) {
          setState(item, 'ok', '已发送');
          item.sub.innerHTML = '';
          item.sub.appendChild(document.createTextNode('已到电脑 · ' + value.length + ' 字'));
          $('text').value = '';
          vibrate(18);
          toast('已发送到电脑');
        } else {
          failSent(item, '网络断开，请确认同一 Wi-Fi', function () { sendText(); });
        }
        updateTextButton();
      }
    );
  }
  $('send-text').onclick = sendText;

  /* ---------- 从电脑获取 ---------- */
  function renderRecv(list) {
    var ul = $('recv-list');
    ul.innerHTML = '';
    $('recv-count').innerHTML = '';
    $('recv-count').appendChild(document.createTextNode(String(list.length)));
    show($('recv-empty'), list.length === 0);
    for (var i = 0; i < list.length; i += 1) {
      (function (item) {
        var li = el('li');
        var row = el('div', 'row');
        var meta = el('div', 'meta');
        if (item.kind === 'file') {
          meta.appendChild(el('div', 'name', item.name));
          meta.appendChild(el('div', 'sub', fmt(item.size)));
          var link = el('a', 'act', '下载');
          link.href = base + '/download/' + item.id;
          link.setAttribute('download', item.name);
          row.appendChild(link);
        } else {
          var preview = item.text.length > 30 ? item.text.slice(0, 30) + '…' : item.text;
          meta.appendChild(el('div', 'name', preview));
          meta.appendChild(el('div', 'sub', item.text.length + ' 字'));
          var copy = el('button', 'act', '复制');
          copy.type = 'button';
          copy.onclick = function () {
            copyText(item.text, function (ok) {
              if (ok) {
                copy.innerHTML = '';
                copy.appendChild(document.createTextNode('已复制'));
                copy.className = 'act done';
                setTimeout(function () {
                  copy.innerHTML = '';
                  copy.appendChild(document.createTextNode('复制'));
                  copy.className = 'act';
                }, 1300);
              } else {
                toast('复制失败，请长按文字手动复制');
              }
            });
          };
          row.appendChild(copy);
          var full = el('div', 'txt', item.text);
          row.appendChild(meta);
          li.appendChild(row);
          li.appendChild(full);
          ul.appendChild(li);
          return;
        }
        row.appendChild(meta);
        li.appendChild(row);
        ul.appendChild(li);
      })(list[i]);
    }
  }

  function poll() {
    request('GET', base + '/state?_=' + new Date().getTime(), null, null, null, function (ok, status, text) {
      if (!ok) return;
      var data;
      try { data = JSON.parse(text); } catch (e) { return; }
      var list = data.outbox || [];
      var fresh = false;
      for (var i = 0; i < list.length; i += 1) {
        if (!seenRecv[list[i].id]) {
          seenRecv[list[i].id] = true;
          if (recvReady) fresh = true;
        }
      }
      recvReady = true;
      renderRecv(list);
      if (fresh && $('pane-recv').className.indexOf('off') >= 0) {
        show($('recv-dot'), true);
        toast('电脑发来了新内容');
        vibrate([20, 40, 20]);
      }
    });
  }
  poll();
  setInterval(poll, 2000);
})();
</script>
</body>
</html>
`
