const { Markup } = require('telegraf');
const supabase = require('./supabaseClient');

function getBot() {
  return require('../bot/bot');
}

async function notifyNewMessage(receiverTelegramUserId, message) {
  await supabase.from('notifications').insert({
    user_id: message.receiver_id,
    type: 'new_message',
    payload: {},
  });

  try {
    const bot = getBot();
    const sent = await bot.telegram.sendMessage(
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

    await supabase.from('messages').update({ telegram_message_id: sent.message_id }).eq('id', message.id);
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

async function editDeliveredMessage(receiverTelegramUserId, telegramMessageId, messageId, newText) {
  if (!telegramMessageId) return;
  try {
    const bot = getBot();
    await bot.telegram.editMessageText(
      receiverTelegramUserId,
      telegramMessageId,
      undefined,
      `📩 یک پیام ناشناس (ویرایش‌شده):\n\n${newText}`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('↩️ پاسخ', `r:${messageId}`),
          Markup.button.callback('🚫 بلاک', `b:${messageId}`),
          Markup.button.callback('🗑 حذف', `d:${messageId}`),
        ],
      ])
    );
  } catch (err) {
    console.error('Failed to edit delivered message:', err.message);
  }
}

async function deleteDeliveredMessage(receiverTelegramUserId, telegramMessageId) {
  if (!telegramMessageId) return;
  try {
    const bot = getBot();
    await bot.telegram.deleteMessage(receiverTelegramUserId, telegramMessageId);
  } catch (err) {
    console.error('Failed to delete delivered message:', err.message);
  }
}

module.exports = { notifyNewMessage, notifyMessageSeen, editDeliveredMessage, deleteDeliveredMessage };
