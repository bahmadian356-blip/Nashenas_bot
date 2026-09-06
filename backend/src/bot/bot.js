const { Telegraf, Markup } = require('telegraf');
const env = require('../config/env');
const { getOrCreateUser } = require('../lib/userService');

const bot = new Telegraf(env.BOT_TOKEN);

// Helper: builds the "Open Mini App" button, reused across messages.
function openAppButton(path = '') {
  const url = path ? `${env.TELEGRAM_WEBAPP_URL}${path}` : env.TELEGRAM_WEBAPP_URL;
  return Markup.inlineKeyboard([Markup.button.webApp('📱 باز کردن Mini App', url)]);
}

bot.start(async (ctx) => {
  const telegramUser = {
    telegramUserId: ctx.from.id,
    telegramUsername: ctx.from.username,
    firstName: ctx.from.first_name,
    lastName: ctx.from.last_name,
    photoUrl: null,
  };

  await getOrCreateUser(telegramUser);

  await ctx.reply(
    'به پیام‌رسان ناشناس خوش اومدی! 👋\n\nاز اینجا می‌تونی لینک ناشناس اختصاصی خودت رو بسازی، پیام دریافت کنی و گیفت بفرستی.',
    openAppButton()
  );
});

bot.command('app', async (ctx) => {
  await ctx.reply('برای باز کردن Mini App دکمه زیر رو بزن:', openAppButton());
});

bot.command('see', async (ctx) => {
  // Placeholder for now — wired up to real unread messages in a later step.
  await ctx.reply('برای دیدن پیام‌های خوندنشده، Mini App رو باز کن:', openAppButton('/messages'));
});

// Main menu, mirrors feature #27 of the spec.
bot.command('menu', async (ctx) => {
  await ctx.reply(
    'منوی اصلی:',
    Markup.inlineKeyboard([
      [Markup.button.webApp('💬 پیام‌های من', `${env.TELEGRAM_WEBAPP_URL}/messages`)],
      [Markup.button.webApp('🎁 ارسال گیفت', `${env.TELEGRAM_WEBAPP_URL}/gifts`)],
      [Markup.button.webApp('🔗 لینک ناشناس من', `${env.TELEGRAM_WEBAPP_URL}/profile`)],
      [Markup.button.webApp('👤 پروفایل', `${env.TELEGRAM_WEBAPP_URL}/profile`)],
      [Markup.button.webApp('🚫 بلاک‌شده‌ها', `${env.TELEGRAM_WEBAPP_URL}/blocked`)],
      [Markup.button.webApp('⚙️ تنظیمات', `${env.TELEGRAM_WEBAPP_URL}/settings`)],
    ])
  );
});

bot.catch((err, ctx) => {
  console.error(`Telegraf error for update ${ctx.update.update_id}:`, err);
});

module.exports = bot;
