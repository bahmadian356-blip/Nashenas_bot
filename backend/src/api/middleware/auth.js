const { validateInitData } = require('../../lib/telegramAuth');
const { getOrCreateUser, markOnline } = require('../../lib/userService');

/**
 * Express middleware for all authenticated Mini App API routes.
 *
 * The Mini App must send the raw Telegram `initData` string (exactly as
 * provided by `window.Telegram.WebApp.initData`) in the
 * `X-Telegram-Init-Data` header on every request. We validate it
 * server-side on every single call — we never trust a cached/stored
 * "session" derived from initDataUnsafe, and we never trust a user_id
 * sent in the request body or query string.
 */
async function requireTelegramAuth(req, res, next) {
  try {
    const initData = req.header('X-Telegram-Init-Data');
    const telegramUser = validateInitData(initData);
    const dbUser = await getOrCreateUser(telegramUser);

    req.telegramUser = telegramUser;
    req.user = dbUser; // authoritative internal user row — use req.user.id everywhere

    // Fire-and-forget presence update; don't block the request on it.
    markOnline(dbUser.id).catch((err) => console.error('markOnline failed:', err.message));

    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized', detail: err.message });
  }
}

module.exports = { requireTelegramAuth };
