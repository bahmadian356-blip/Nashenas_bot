// =====================================================================
// CONFIG — change this to your deployed backend URL on Render
// =====================================================================
const API_BASE = 'https://YOUR-BACKEND-NAME.onrender.com';

// =====================================================================
// Telegram WebApp setup
// =====================================================================
const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) {
  tg.ready();
  tg.expand();
  applyTelegramTheme();
  tg.onEvent('themeChanged', applyTelegramTheme);
}

function applyTelegramTheme() {
  if (!tg || !tg.themeParams) return;
  const root = document.documentElement;
  const map = {
    bg_color: '--tg-theme-bg-color',
    text_color: '--tg-theme-text-color',
    hint_color: '--tg-theme-hint-color',
    button_color: '--tg-theme-button-color',
    button_text_color: '--tg-theme-button-text-color',
    secondary_bg_color: '--tg-theme-secondary-bg-color',
  };
  for (const [key, cssVar] of Object.entries(map)) {
    if (tg.themeParams[key]) root.style.setProperty(cssVar, tg.themeParams[key]);
  }
}

function getInitData() {
  return tg ? tg.initData : '';
}

// =====================================================================
// API client
// =====================================================================
async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': getInitData(),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* no body */
  }

  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

// =====================================================================
// Toast helper
// =====================================================================
let toastTimer = null;
function showToast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}

// =====================================================================
// Simple hash router
// =====================================================================
const routes = {};
function route(pattern, handler) {
  routes[pattern] = handler;
}

function parseHash() {
  const hash = window.location.hash.replace(/^#/, '') || '/home';
  const [pathPart, queryPart] = hash.split('?');
  const params = new URLSearchParams(queryPart || '');
  return { path: pathPart, params };
}

async function renderRoute() {
  const { path, params } = parseHash();
  updateActiveNav(path);

  for (const pattern of Object.keys(routes)) {
    const match = matchRoute(pattern, path);
    if (match) {
      const app = document.getElementById('app');
      app.innerHTML = '<div class="spinner"></div>';
      try {
        await routes[pattern](match, params);
      } catch (err) {
        app.innerHTML = `<div class="empty-state"><span class="emoji">⚠️</span>${escapeHtml(err.message)}</div>`;
      }
      return;
    }
  }
  document.getElementById('app').innerHTML = '<div class="empty-state">صفحه پیدا نشد</div>';
}

function matchRoute(pattern, path) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

function updateActiveNav(path) {
  const top = '/' + (path.split('/').filter(Boolean)[0] || 'home');
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', '/' + el.dataset.route === top);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'همین الان';
  if (diff < 3600) return `${Math.floor(diff / 60)} دقیقه پیش`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ساعت پیش`;
  return `${Math.floor(diff / 86400)} روز پیش`;
}

function initials(name) {
  return (name || '؟').trim().charAt(0).toUpperCase();
}

// =====================================================================
// Shared: unread badge on bottom nav
// =====================================================================
async function refreshUnreadBadge() {
  try {
    const data = await api('/api/messages/inbox?limit=100');
    const unread = data.messages.filter((m) => !m.read_at).length;
    const badge = document.getElementById('nav-unread-badge');
    if (unread > 0) {
      badge.textContent = unread > 99 ? '99+' : unread;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch (e) {
    /* silent — badge is best-effort */
  }
}

// =====================================================================
// PAGE: Home
// =====================================================================
route('/home', async () => {
  const me = await api('/api/me');
  const [inbox, giftsMy] = await Promise.all([
    api('/api/messages/inbox?limit=5'),
    api('/api/gifts/received').catch(() => ({ gifts: [] })),
  ]);
  const unread = inbox.messages.filter((m) => !m.read_at).length;

  document.getElementById('app').innerHTML = `
    <div class="card row">
      ${me.avatar_url ? `<img class="avatar" src="${me.avatar_url}" />` : `<div class="avatar">${initials(me.display_name)}</div>`}
      <div style="flex:1; overflow:hidden;">
        <div style="font-weight:700; font-size:16px;">${escapeHtml(me.display_name)}</div>
        <div class="muted">${me.is_online ? '🟢 آنلاین' : me.show_last_seen ? 'آخرین بازدید: ' + timeAgo(me.last_seen) : ''}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">🔗 لینک ناشناس شما</div>
      <div class="muted" style="word-break:break-all;">${me.anonymous_link || '—'}</div>
      <div class="btn-grid">
        <button class="btn secondary" id="copy-link-btn">📋 کپی لینک</button>
        <button class="btn secondary" id="share-link-btn">↗️ اشتراک‌گذاری</button>
      </div>
    </div>

    <div class="card">
      <div class="row">
        <div><div style="font-size:22px; font-weight:700;">${unread}</div><div class="muted">پیام جدید</div></div>
        <div><div style="font-size:22px; font-weight:700;">${giftsMy.gifts.length}</div><div class="muted">گیفت دریافتی</div></div>
      </div>
    </div>

    <div class="btn-grid">
      <a class="btn" href="#/messages">💬 پیام‌های من</a>
      <a class="btn secondary" href="#/gifts">🎁 ارسال گیفت</a>
    </div>
  `;

  document.getElementById('copy-link-btn').onclick = () => {
    if (me.anonymous_link) {
      navigator.clipboard.writeText(me.anonymous_link).then(() => showToast('لینک کپی شد ✅'));
    }
  };
  document.getElementById('share-link-btn').onclick = () => {
    if (!me.anonymous_link) return;
    if (tg) {
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(me.anonymous_link)}`);
    } else {
      navigator.share && navigator.share({ url: me.anonymous_link });
    }
  };

  refreshUnreadBadge();
});

// =====================================================================
// PAGE: Messages (inbox / outbox tabs)
// =====================================================================
route('/messages', async (_, params) => {
  const tab = params.get('tab') === 'sent' ? 'sent' : 'inbox';
  const data = tab === 'inbox' ? await api('/api/messages/inbox') : await api('/api/messages/outbox');
  const messages = data.messages;

  const listHtml = messages.length
    ? messages.map((m) => renderMessageItem(m, tab)).join('')
    : `<div class="empty-state"><span class="emoji">📭</span>پیامی وجود ندارد</div>`;

  document.getElementById('app').innerHTML = `
    <div class="page-title">پیام‌ها</div>
    <div class="tabs">
      <div class="tab ${tab === 'inbox' ? 'active' : ''}" id="tab-inbox">دریافتی</div>
      <div class="tab ${tab === 'sent' ? 'active' : ''}" id="tab-sent">ارسالی</div>
    </div>
    <div id="message-list">${listHtml}</div>
  `;

  document.getElementById('tab-inbox').onclick = () => (window.location.hash = '#/messages?tab=inbox');
  document.getElementById('tab-sent').onclick = () => (window.location.hash = '#/messages?tab=sent');

  document.querySelectorAll('[data-action]').forEach((btn) => {
    btn.onclick = () => handleMessageAction(btn.dataset.action, btn.dataset.id, tab);
  });

  refreshUnreadBadge();
});

function renderMessageItem(m, tab) {
  const isInbox = tab === 'inbox';
  return `
    <div class="message-item ${isInbox && !m.read_at ? 'unread' : ''}">
      <div class="message-meta">
        <span>${isInbox ? '📩 پیام ناشناس' : m.users ? 'به: ' + escapeHtml(m.users.display_name) : 'ارسال‌شده'}</span>
        <span>${timeAgo(m.created_at)}</span>
      </div>
      <div class="message-text">${escapeHtml(m.text)}${m.edited_at ? ' <span class="muted">(ویرایش‌شده)</span>' : ''}</div>
      <div class="message-meta">
        <span>${!isInbox ? (m.read_at ? '✓ مشاهده شد' : 'ارسال شد') : ''}</span>
      </div>
      <div class="message-actions">
        ${isInbox && !m.read_at ? `<button class="icon-btn" data-action="read" data-id="${m.id}">👀 خوندم</button>` : ''}
        ${isInbox ? `<button class="icon-btn" data-action="reply" data-id="${m.id}">↩️ پاسخ</button>` : ''}
        ${isInbox ? `<button class="icon-btn" data-action="block" data-id="${m.sender_id}">🚫 بلاک</button>` : ''}
        ${isInbox ? `<button class="icon-btn" data-action="pin" data-id="${m.id}">${m.pinned ? '📌 برداشتن پین' : '📌 پین'}</button>` : ''}
        ${!isInbox ? `<button class="icon-btn" data-action="edit" data-id="${m.id}">✏️ ویرایش</button>` : ''}
        <button class="icon-btn" data-action="delete" data-id="${m.id}">🗑 حذف</button>
        ${isInbox ? `<button class="icon-btn" data-action="report" data-id="${m.id}">⚠️ گزارش</button>` : ''}
      </div>
    </div>
  `;
}

async function handleMessageAction(action, id, tab) {
  try {
    if (action === 'read') {
      await api(`/api/messages/${id}/read`, { method: 'PATCH' });
    } else if (action === 'delete') {
      if (!confirm('حذف شود؟')) return;
      await api(`/api/messages/${id}`, { method: 'DELETE' });
    } else if (action === 'pin') {
      await api(`/api/messages/${id}/pin`, { method: 'PATCH', body: { pinned: true } });
    } else if (action === 'block') {
      if (!confirm('این فرستنده بلاک بشه؟')) return;
      await api('/api/blocks', { method: 'POST', body: { user_id: id } });
    } else if (action === 'reply') {
      const text = prompt('متن پاسخ:');
      if (!text) return;
      await api(`/api/messages/${id}/reply`, { method: 'POST', body: { text } });
    } else if (action === 'edit') {
      const text = prompt('متن جدید پیام:');
      if (!text) return;
      await api(`/api/messages/${id}`, { method: 'PATCH', body: { text } });
    } else if (action === 'report') {
      const reason = prompt('دلیل گزارش (اختیاری):') || '';
      await api(`/api/messages/${id}/report`, { method: 'POST', body: { reason } });
    }
    showToast('انجام شد ✅');
    renderRoute();
  } catch (err) {
    showToast('خطا: ' + err.message);
  }
}

// =====================================================================
// PAGE: Send anonymous message  (#/u/:slug)
// =====================================================================
route('/u/:slug', async (match) => {
  const info = await api(`/api/links/${encodeURIComponent(match.slug)}`);

  if (!info.can_send) {
    const reasonText =
      info.reason === 'blocked'
        ? '❌ شما توسط این کاربر مسدود شده‌اید و امکان ارسال پیام ندارید.'
        : info.reason === 'own_link'
        ? 'این لینک متعلق به خودتونه 🙂'
        : 'این کاربر در حال حاضر پیام ناشناس دریافت نمی‌کند.';

    document.getElementById('app').innerHTML = `
      <div class="card row">
        ${info.avatar_url ? `<img class="avatar" src="${info.avatar_url}" />` : `<div class="avatar">${initials(info.display_name)}</div>`}
        <div style="font-weight:700;">${escapeHtml(info.display_name)}</div>
      </div>
      <div class="empty-state">${reasonText}</div>
    `;
    return;
  }

  document.getElementById('app').innerHTML = `
    <div class="card row">
      ${info.avatar_url ? `<img class="avatar" src="${info.avatar_url}" />` : `<div class="avatar">${initials(info.display_name)}</div>`}
      <div style="font-weight:700;">${escapeHtml(info.display_name)}</div>
    </div>
    <div class="card">
      <div class="card-title">✉️ یک پیام ناشناس بفرست</div>
      <textarea class="input" id="msg-text" rows="5" maxlength="2000" placeholder="پیامت رو اینجا بنویس..."></textarea>
      <div class="btn-grid">
        <button class="btn" id="send-msg-btn">ارسال</button>
      </div>
    </div>
  `;

  document.getElementById('send-msg-btn').onclick = async () => {
    const text = document.getElementById('msg-text').value.trim();
    if (!text) return showToast('پیام نمی‌تواند خالی باشد');
    try {
      await api('/api/messages/send', { method: 'POST', body: { slug: match.slug, text } });
      showToast('پیام ارسال شد ✅');
      document.getElementById('msg-text').value = '';
    } catch (err) {
      showToast('خطا: ' + err.message);
    }
  };
});

// =====================================================================
// PAGE: Gifts (store / received / sent)
// =====================================================================
route('/gifts', async (_, params) => {
  const tab = params.get('tab') || 'store';
  const app = document.getElementById('app');

  const tabsHtml = `
    <div class="page-title">گیفت‌ها</div>
    <div class="tabs">
      <div class="tab ${tab === 'store' ? 'active' : ''}" id="tab-store">🎁 فروشگاه</div>
      <div class="tab ${tab === 'received' ? 'active' : ''}" id="tab-received">دریافتی</div>
      <div class="tab ${tab === 'sent' ? 'active' : ''}" id="tab-sent">ارسالی</div>
    </div>
  `;

  if (tab === 'store') {
    const { gifts } = await api('/api/gifts');
    app.innerHTML =
      tabsHtml +
      `<div class="gift-grid">${gifts
        .map(
          (g) => `
        <div class="gift-card" data-gift-id="${g.id}" data-gift-name="${escapeHtml(g.name)}">
          <span class="gift-emoji">${categoryEmoji(g.category)}</span>
          <div class="gift-name">${escapeHtml(g.name)}</div>
          <div class="gift-price">⭐ ${g.price_stars}</div>
        </div>`
        )
        .join('')}</div>`;

    document.querySelectorAll('.gift-card').forEach((card) => {
      card.onclick = () => openSendGiftFlow(card.dataset.giftId, card.dataset.giftName);
    });
  } else if (tab === 'received') {
    const { gifts } = await api('/api/gifts/received');
    app.innerHTML =
      tabsHtml +
      (gifts.length
        ? `<div class="gift-grid">${gifts
            .map(
              (g) => `
        <div class="gift-card">
          <span class="gift-emoji">${categoryEmoji(g.gift_catalog.category)}</span>
          <div class="gift-name">${escapeHtml(g.gift_catalog.name)}${g.is_new ? ' 🆕' : ''}</div>
          <div class="gift-price">${timeAgo(g.received_at)}</div>
        </div>`
            )
            .join('')}</div>`
        : `<div class="empty-state"><span class="emoji">🎁</span>هنوز گیفتی دریافت نکردید</div>`);
  } else {
    const { gifts } = await api('/api/gifts/sent');
    app.innerHTML =
      tabsHtml +
      (gifts.length
        ? gifts
            .map(
              (g) => `
        <div class="message-item">
          <div class="row">
            <span>${categoryEmoji(g.gift_catalog.category)} ${escapeHtml(g.gift_catalog.name)}</span>
            <span class="muted">${g.status === 'delivered' ? '✅ تحویل شد' : 'در انتظار'}</span>
          </div>
          <div class="muted">به: ${escapeHtml(g.users ? g.users.display_name : '—')} • ${timeAgo(g.created_at)}</div>
        </div>`
            )
            .join('')
        : `<div class="empty-state"><span class="emoji">🎁</span>هنوز گیفتی ارسال نکردید</div>`);
  }

  document.getElementById('tab-store').onclick = () => (window.location.hash = '#/gifts?tab=store');
  document.getElementById('tab-received').onclick = () => (window.location.hash = '#/gifts?tab=received');
  document.getElementById('tab-sent').onclick = () => (window.location.hash = '#/gifts?tab=sent');
});

function categoryEmoji(category) {
  const map = {
    birthday: '🎂',
    heart: '❤️',
    teddy: '🧸',
    flower: '🌹',
    star: '⭐',
    party: '🎉',
    premium: '💎',
  };
  return map[category] || '🎁';
}

async function openSendGiftFlow(giftId, giftName) {
  const slug = prompt(`ارسال «${giftName}» — لینک ناشناس (یا کد) گیرنده رو وارد کن:\nمثال: ABC123`);
  if (!slug) return;
  const message = prompt('پیام همراه گیفت (اختیاری):') || '';

  try {
    const cleanSlug = slug.trim().split('/').pop().replace('#', '');
    const { invoice_link } = await api('/api/gifts/purchase', {
      method: 'POST',
      body: { gift_id: giftId, slug: cleanSlug, message },
    });

    if (tg && tg.openInvoice) {
      tg.openInvoice(invoice_link, (status) => {
        if (status === 'paid') {
          showToast('🎉 پرداخت موفق! گیفت ارسال شد.');
        } else if (status === 'failed') {
          showToast('پرداخت ناموفق بود.');
        }
      });
    } else {
      window.open(invoice_link, '_blank');
    }
  } catch (err) {
    showToast('خطا: ' + err.message);
  }
}

// =====================================================================
// PAGE: Profile
// =====================================================================
route('/profile', async () => {
  const me = await api('/api/me');

  document.getElementById('app').innerHTML = `
    <div class="page-title">پروفایل</div>
    <div class="card row">
      ${me.avatar_url ? `<img class="avatar" src="${me.avatar_url}" />` : `<div class="avatar">${initials(me.display_name)}</div>`}
      <div style="flex:1;">
        <div style="font-weight:700; font-size:16px;">${escapeHtml(me.display_name)}</div>
        ${me.telegram_username ? `<div class="muted">@${escapeHtml(me.telegram_username)}</div>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-title">🔗 لینک ناشناس شما</div>
      <div class="muted" style="word-break:break-all;">${me.anonymous_link || '—'}</div>
      <div class="btn-grid">
        <button class="btn secondary" id="copy-link-btn">📋 کپی</button>
        <button class="btn secondary" id="share-link-btn">↗️ اشتراک‌گذاری</button>
      </div>
      <button class="btn danger" id="regen-link-btn" style="margin-top:10px;">🔄 تغییر لینک</button>
    </div>

    <div class="btn-grid">
      <a class="btn secondary" href="#/blocked">🚫 کاربران بلاک‌شده</a>
      <a class="btn secondary" href="#/settings">⚙️ تنظیمات</a>
    </div>
  `;

  document.getElementById('copy-link-btn').onclick = () => {
    navigator.clipboard.writeText(me.anonymous_link).then(() => showToast('لینک کپی شد ✅'));
  };
  document.getElementById('share-link-btn').onclick = () => {
    if (tg) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(me.anonymous_link)}`);
  };
  document.getElementById('regen-link-btn').onclick = async () => {
    if (!confirm('لینک قبلی از کار می‌افتد و یک لینک جدید ساخته می‌شود. ادامه می‌دهید؟')) return;
    try {
      await api('/api/me/link/regenerate', { method: 'PATCH' });
      showToast('لینک جدید ساخته شد ✅');
      renderRoute();
    } catch (err) {
      showToast('خطا: ' + err.message);
    }
  };
});

// =====================================================================
// PAGE: Settings
// =====================================================================
route('/settings', async () => {
  const me = await api('/api/me');

  document.getElementById('app').innerHTML = `
    <div class="page-title">تنظیمات</div>
    <div class="card">
      <div class="setting-row">
        <span>دریافت پیام ناشناس</span>
        <label class="switch">
          <input type="checkbox" id="s-allow" ${me.allow_anonymous_messages ? 'checked' : ''} />
          <span class="slider"></span>
        </label>
      </div>
      <div class="setting-row">
        <span>نمایش آخرین بازدید</span>
        <label class="switch">
          <input type="checkbox" id="s-lastseen" ${me.show_last_seen ? 'checked' : ''} />
          <span class="slider"></span>
        </label>
      </div>
      <div class="setting-row">
        <span>نمایش وضعیت آنلاین</span>
        <label class="switch">
          <input type="checkbox" id="s-online" ${me.show_online_status ? 'checked' : ''} />
          <span class="slider"></span>
        </label>
      </div>
    </div>
  `;

  const bind = (id, field) => {
    document.getElementById(id).onchange = async (e) => {
      try {
        await api('/api/me/settings', { method: 'PATCH', body: { [field]: e.target.checked } });
        showToast('ذخیره شد ✅');
      } catch (err) {
        showToast('خطا: ' + err.message);
        e.target.checked = !e.target.checked;
      }
    };
  };
  bind('s-allow', 'allow_anonymous_messages');
  bind('s-lastseen', 'show_last_seen');
  bind('s-online', 'show_online_status');
});

// =====================================================================
// PAGE: Blocked users
// =====================================================================
route('/blocked', async () => {
  const { blocks } = await api('/api/blocks');

  document.getElementById('app').innerHTML = `
    <div class="page-title">کاربران بلاک‌شده</div>
    ${
      blocks.length
        ? blocks
            .map(
              (b) => `
      <div class="message-item row">
        <span class="muted">فرستنده ناشناس • ${timeAgo(b.created_at)}</span>
        <button class="icon-btn" data-unblock="${b.blocked_user_id}">✅ آنبلاک</button>
      </div>`
            )
            .join('')
        : `<div class="empty-state"><span class="emoji">🚫</span>کسی رو بلاک نکردید</div>`
    }
  `;

  document.querySelectorAll('[data-unblock]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await api(`/api/blocks/${btn.dataset.unblock}`, { method: 'DELETE' });
        showToast('آنبلاک شد ✅');
        renderRoute();
      } catch (err) {
        showToast('خطا: ' + err.message);
      }
    };
  });
});

// =====================================================================
// Boot
// =====================================================================
window.addEventListener('hashchange', renderRoute);
window.addEventListener('DOMContentLoaded', renderRoute);
