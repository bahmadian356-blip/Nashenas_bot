const { Markup } = require('telegraf');
const supabase = require('./supabaseClient');
const env = require('../config/env');

// Lazily required to avoid a require-cycle at module-load time
// (bot.js doesn't depend on notify.js, so this is safe either way,
// but lazy-require keeps the dependency direction obvious).
function getBot() {
  return require('../bot/bot');
}

/**
 * Records an in-app notification row AND pushes a Telegram message to the
 * user (feature #6 / #15). Telegram push failures (e.g. user blocked the
 * bot) are logged but never thrown — a failed push must not break the
 * underlying action (e.g. sending a message should still succeed even if
 * the recipient's bot chat is unreachable).
 */
async function notifyNewMessage(receiverTelegramUserId, receiverUserId) {
  await supabase.from('notifications').insert({
    user_id: receiverUserId,
    type: 'new_message',
    payload: {},
  });

  try {
    const bot = getBot();
    await bot.telegram.sendMessage(
      receiverTelegramUserId,
      '📩 شما یک پیام جدید دارید.\n\nبرای مشاهده پیام /see را ارسال کنید.',
      Markup.inlineKeyboard([
        [Markup.button.webApp('👀 مشاهده پیام', `${env.TELEGRAM_WEBAPP_URL}/messages`)],
      ])
    );
  } catch (err) {
    console.error('Failed to push new-message notification:', err.message);
  }
}

async function notifyMessageSeen(senderTelegramUserId) {
  try {
    const bot = getBot();
    await bot.telegram.sendMessage(senderTelegramUserId, '✓ پیام شما مشاهده شد.');
  } catch (err) {
    console.error('Failed to push seen notification:', err.message);
  }
}

module.exports = { notifyNewMessage, notifyMessageSeen };
