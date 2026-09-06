const { Markup } = require('telegraf');
const supabase = require('./supabaseClient');
const env = require('../config/env');

function getBot() {
  return require('../bot/bot');
}

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
        [Markup.button.webApp('👀 مشاهده پیام', `${env.TELEGRAM_WEBAPP_URL}/#/messages`)],
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
