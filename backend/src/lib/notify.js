const { Markup } = require('telegraf');
const supabase = require('./supabaseClient');

function getBot() {
  return require('../bot/bot');
}

/**
 * Pushes a new anonymous message directly into the receiver's chat with
 * the bot — the message TEXT itself is included, with inline buttons to
 * reply / block / delete right there in Telegram, no Mini App required.
 */
async function notifyNewMessage(receiverTelegramUserId, message) {
  await supabase.from('notifications').insert({
    user_id: message.receiver_id,
    type: 'new_message',
    payload: {},
  });

  try {
    const bot = getBot();
    await bot.telegram.sendMessage(
      receiverTelegramUserId,
      `📩 یک پیام ناشناس جدید دارید:\n\n${message.text}`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('↩️ پاسخ', `r:${message.id}`),
          Markup.button.callback('🚫 بلاک', `b:${message.id}`),
          Markup.button.callback('🗑 حذف', `d:${message.id}`),
        ],
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
