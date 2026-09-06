const crypto = require('crypto');
const env = require('../config/env');

// Max age (seconds) we accept for a Mini App initData payload.
// Prevents replay of an old, captured initData string.
const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60; // 24h, Telegram's own recommendation

/**
 * Validates Telegram Mini App `initData` per the official algorithm:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Returns the parsed, verified user object on success, or throws on failure.
 * Callers must NEVER fall back to trusting `initDataUnsafe` from the client.
 */
function validateInitData(initDataRaw) {
  if (!initDataRaw || typeof initDataRaw !== 'string') {
    throw new Error('initData is missing');
  }

  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');
  if (!hash) {
    throw new Error('initData is missing hash');
  }
  params.delete('hash');

  // Build the data-check-string: all remaining fields, sorted by key,
  // joined as "key=value" with newlines.
  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  // secret_key = HMAC_SHA256(bot_token) with key "WebAppData"
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest();

  // computed_hash = HMAC_SHA256(data_check_string) with key secret_key
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const validSignature = crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(hash, 'hex'));
  if (!validSignature) {
    throw new Error('initData signature is invalid');
  }

  const authDate = parseInt(params.get('auth_date') || '0', 10);
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (!authDate || ageSeconds > MAX_INIT_DATA_AGE_SECONDS || ageSeconds < -60) {
    throw new Error('initData has expired');
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new Error('initData is missing user field');
  }

  let user;
  try {
    user = JSON.parse(userRaw);
  } catch (e) {
    throw new Error('initData user field is not valid JSON');
  }

  if (!user || typeof user.id !== 'number') {
    throw new Error('initData user.id is missing or invalid');
  }

  return {
    telegramUserId: user.id,
    telegramUsername: user.username || null,
    firstName: user.first_name || null,
    lastName: user.last_name || null,
    languageCode: user.language_code || null,
    photoUrl: user.photo_url || null,
    authDate,
  };
}

module.exports = { validateInitData };
