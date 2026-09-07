let cachedUsername = null;

/**
 * Fetches (once) and caches the bot's own @username via Telegram's getMe.
 * Needed to build `https://t.me/<username>?start=...` deep links.
 */
async function ensureBotUsername(bot) {
  if (!cachedUsername) {
    const me = await bot.telegram.getMe();
    cachedUsername = me.username;
  }
  return cachedUsername;
}

function getCachedUsername() {
  return cachedUsername;
}

module.exports = { ensureBotUsername, getCachedUsername };
