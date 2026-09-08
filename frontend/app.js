// =====================================================================
// CONFIG — change this to your deployed backend URL on Render
// =====================================================================
const API_BASE = 'https://nashenas-bot-2.onrender.com';

// =====================================================================
// Telegram WebApp setup
// =====================================================================
const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) {
  tg.ready();
  tg.expand();
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

let chatPollTimer = null;
let chatLastSignature = null;

async function renderRoute() {
  const { path, params } = parseHash();
  updateActiveNav(path);

  if (!path.startsWith('/chat/')) {
    document.body.classList.remove('chat-open');
    clearInterval(chatPollTimer);
  }

  for (const pattern of Object.keys(routes)) {
    const match = matchRoute(pattern, path);
    if (match) {
      const app = document.getElementById('app');
      app.innerHTML = '<div class="spinner"></div>';
      app.classList.remove('fade-replay');
      void app.offsetWidth;
      app.classList.add('fade-replay');
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
    const data = await api('/api/conversations');
    const unread = data.conversations.reduce((sum, c) => sum + c.unread_count, 0);
    const badge = document.getElementById('nav-unread-badge');
    if (unread > 0) {
      badge.textContent = unread > 99 ? '99+' : unread;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch (e) {
    /* silent */
  }
}

// =====================================================================
// PAGE: Home
// =====================================================================
route('/home', async () => {
  const me = await api('/api/me');
  const [convos, giftsMy] = await Promise.all([
    api('/api/conversations'),
    api('/api/gifts/received').catch(() => ({ gifts: [] })),
  ]);
  const unread = convos.conversations.reduce((sum, c) => sum + c.unread_count, 0);

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
// PAGE: Conversations list (like a chat list)
// =====================================================================
route('/messages', async () => {
  document.body.classList.remove('chat-open');
  const { conversations } = await api('/api/conversations');

  const listHtml = conversations.length
    ? conversations
        .map(
          (c) => `
        <a class="conv-item" href="#/chat/${c.counterpart_id}">
          ${
            c.avatar_url
              ? `<img class="avatar" src="${c.avatar_url}" />`
              : `<div class="avatar">${c.revealed ? initials(c.name) : '❔'}</div>`
          }
          <div style="flex:1; min-width:0;">
            <div class="row">
              <span style="font-weight:700;">${escapeHtml(c.name)}</span>
              <span class="muted">${timeAgo(c.last_message_at)}</span>
            </div>
            <div class="muted" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(c.last_message)}</div>
          </div>
          ${c.unread_count > 0 ? `<span class="badge" style="position:static;">${c.unread_count}</span>` : ''}
        </a>`
        )
        .join('')
    : `<div class="empty-state"><span class="emoji">💬</span>هنوز هیچ مکالمه‌ای نداری</div>`;

  document.getElementById('app').innerHTML = `
    <div class="page-title">پیام‌ها</div>
    ${listHtml}
  `;

  refreshUnreadBadge();
});

// =====================================================================
// PAGE: Chat thread (real conversation view)
// =====================================================================
route('/chat/:id', async (match) => {
  document.body.classList.add('chat-open');
  clearInterval(chatPollTimer);
  chatLastSignature = null;

  await loadChatThread(match.id, false);
  chatPollTimer = setInterval(() => loadChatThread(match.id, true), 4000);
});

async function loadChatThread(counterpartId, silent) {
  let data;
  try {
    data = await api(`/api/conversations/${counterpartId}`);
  } catch (err) {
    if (!silent) {
      document.getElementById('app').innerHTML = `<div class="empty-state"><span class="emoji">⚠️</span>${escapeHtml(err.message)}</div>`;
    }
    return;
  }

  const { counterpart, messages } = data;

  const signature = messages.map((m) => `${m.id}:${m.text}:${m.edited_at || ''}:${m.read_at || ''}`).join('|');

  if (silent && signature === chatLastSignature) {
    return;
  }
  chatLastSignature = signature;

  const app = document.getElementById('app');
  const existingScroll = document.getElementById('chat-scroll');
  const existingInput = document.getElementById('chat-input');

  const wasNearBottom = !existingScroll || isNearBottom(existingScroll);
  const preservedText = existingInput ? existingInput.value : '';
  const hadFocus = existingInput === document.activeElement;

  if (silent && existingScroll) {
    existingScroll.innerHTML = messages.map(renderBubble).join('');
    if (wasNearBottom) existingScroll.scrollTop = existingScroll.scrollHeight;
    return;
  }

  const statusLine = counterpart.is_online
    ? '🟢 آنلاین'
    : counterpart.last_seen
    ? 'آخرین بازدید: ' + timeAgo(counterpart.last_seen)
    : '';

  app.innerHTML = `
    <div class="chat-header">
      <a href="#/messages" class="back-link">◀ بازگشت</a>
      <div class="row" style="margin-top:6px;">
        ${
          counterpart.avatar_url
            ? `<img class="avatar" src="${counterpart.avatar_url}" />`
            : `<div class="avatar">${counterpart.revealed ? initials(counterpart.name) : '❔'}</div>`
        }
        <div style="flex:1;">
          <div style="font-weight:700;">${escapeHtml(counterpart.name)}</div>
          <div class="muted">${statusLine}</div>
        </div>
      </div>
    </div>

    <div id="chat-scroll" class="chat-scroll">
      ${messages.map(renderBubble).join('')}
    </div>

    <div class="composer">
      <textarea class="input" id="chat-input" rows="1" placeholder="پیامت رو بنویس...">${escapeHtml(preservedText)}</textarea>
      <button class="btn small" id="chat-send-btn">ارسال</button>
    </div>
  `;

  const scrollEl = document.getElementById('chat-scroll');
  if (wasNearBottom) scrollEl.scrollTop = scrollEl.scrollHeight;

  const inputEl = document.getElementById('chat-input');
  if (hadFocus) inputEl.focus();

  document.getElementById('chat-send-btn').onclick = () => sendChatMessage(counterpartId);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage(counterpartId);
    }
  });
}

function isNearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
}

function renderBubble(m) {
  return `
    <div class="bubble-row ${m.is_mine ? 'mine' : 'theirs'}">
      <div class="bubble">
        <div class="bubble-text">${escapeHtml(m.text)}</div>
        <div class="bubble-meta">
          ${m.edited_at ? '<span>ویرایش‌شده</span>' : ''}
          <span>${new Date(m.created_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</span>
          ${m.is_mine ? `<span>${m.read_at ? '✓✓' : '✓'}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

async function sendChatMessage(counterpartId) {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.disabled = true;
  try {
    await api(`/api/conversations/${counterpartId}/send`, { method: 'POST', body: { text } });
    await loadChatThread(counterpartId);
  } catch (err) {
    showToast('خطا: ' + err.message);
  } finally {
    input.disabled = false;
    input.focus();
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
