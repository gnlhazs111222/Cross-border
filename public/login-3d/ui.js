(() => {
  'use strict';
  let toastTimer, previousFocus, loginBusy = false;
  const $ = id => document.getElementById(id);

  // Keep scene pointer bounds synchronized with the full-viewport layout.
  window.dispatchEvent(new Event('resize'));

  const content = {
    workflow: ['从商品资料，到海外发布。', '资料入库与校验 → 建立候选商品池\n创建上新任务 → 智能选品\n核验商品事实 → 生成本地化内容\n规则审核 → 平台草稿或文件交付\n\n资料库可独立维护；运营人员负责确认边界内容与最终审核。']
  };

  function toast(text) {
    $('toast').textContent = text;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3800);
  }
  function informScene(active) { window.dispatchEvent(new CustomEvent('scene-modal', { detail: active })); }
  function openDialog(dialog) {
    previousFocus = document.activeElement;
    dialog.showModal();
    informScene(true);
    if (dialog.id === 'loginDialog') $('email').focus();
  }
  function openLogin() { openDialog($('loginDialog')); }

  $('start').addEventListener('click', openLogin);
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => {
      informScene(false);
      $('password').value = '';
      $('password').type = 'password';
      $('showPassword').setAttribute('aria-pressed', 'false');
      $('showPassword').setAttribute('aria-label', '显示密码');
      $('showPassword').textContent = '显示';
      previousFocus?.focus();
    });
  });

  $('showPassword').addEventListener('click', () => {
    const show = $('password').type === 'password';
    $('password').type = show ? 'text' : 'password';
    $('showPassword').textContent = show ? '隐藏' : '显示';
    $('showPassword').setAttribute('aria-pressed', String(show));
    $('showPassword').setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
  });

  function setLoginBusy(busy) {
    loginBusy = busy;
    const button = $('loginForm').querySelector('.submit');
    button.disabled = busy;
    button.querySelector('span').textContent = busy ? '正在登录…' : '登录工作台';
  }

  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (loginBusy || !$('loginForm').reportValidity()) return;
    setLoginBusy(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: $('email').value.trim(), password: $('password').value })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error?.message || '登录请求未完成，请稍后重试。');
      $('password').value = '';
      $('loginDialog').close();
      if (window.parent !== window) window.parent.postMessage({ type: 'prismlaunch:login-success' }, window.location.origin);
      toast('登录成功，正在进入工作台。');
    } catch (error) {
      toast(`登录失败：${error instanceof Error ? error.message : '请检查网络后重试。'}`);
    } finally {
      setLoginBusy(false);
    }
  });

  document.querySelectorAll('[data-info]').forEach(button => button.addEventListener('click', () => {
    const [title, body] = content[button.dataset.info];
    $('infoTitle').textContent = title;
    $('infoBody').textContent = body;
    openDialog($('infoDialog'));
  }));
  $('infoStart').addEventListener('click', () => { $('infoDialog').close(); setTimeout(openLogin, 0); });
})();
