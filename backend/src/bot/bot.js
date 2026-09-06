const { Telegraf, Markup } = require('telegraf');
const env = require('../config/env');
const { getOrCreateUser } = require('../lib/userService');
const { finalizeGiftPayment } = require('../lib/giftService');
const supabase = require('../lib/supabaseClient');

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
  await ctx.reply('برای دیدن پیام‌های خوندنشده، Mini App رو باز کن:', openAppButton('/messages'));
});

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

// ---------------------------------------------------------------------
// Telegram Stars payment flow (feature #16-19)
// ---------------------------------------------------------------------

// Telegram asks us to approve every checkout before charging the user.
// We just confirm the payload corresponds to a payment we actually created.
bot.on('pre_checkout_query', async (ctx) => {
  try {
    const payload = ctx.preCheckoutQuery.invoice_payload;
    const { data: payment, error } = await supabase
      .from('payments')
      .select('id, status, amount_stars')
      .eq('invoice_payload', payload)
      .maybeSingle();

    if (error) throw error;

    const valid =
      payment && payment.status === 'pending' && payment.amount_stars === ctx.preCheckoutQuery.total_amount;

    await ctx.answerPreCheckoutQuery(!!valid, valid ? undefined : 'این پرداخت دیگر معتبر نیست.');
  } catch (err) {
    console.error('pre_checkout_query error:', err.message);
    await ctx.answerPreCheckoutQuery(false, 'خطایی رخ داد، لطفاً دوباره تلاش کنید.');
  }
});

// Telegram confirms the Stars charge succeeded — this is the source of
// truth that actually grants the gift. Never grant a gift anywhere else.
bot.on('message', async (ctx, next) => {
  const successfulPayment = ctx.message && ctx.message.successful_payment;
  if (!successfulPayment) return next();

  try {
    const { transaction, alreadyProcessed } = await finalizeGiftPayment({
      invoicePayload: successfulPayment.invoice_payload,
      telegramPaymentChargeId: successfulPayment.telegram_payment_charge_id,
      providerPaymentChargeId: successfulPayment.provider_payment_charge_id,
    });

    if (alreadyProcessed) return;

    await ctx.reply('✅ پرداخت با موفقیت انجام شد.\n\n🎁 Gift شما با موفقیت به پروفایل کاربر ارسال شد.');

    const { data: receiver } = await supabase
      .from('users')
      .select('telegram_user_id')
      .eq('id', transaction.receiver_id)
      .maybeSingle();

    if (receiver) {
      await ctx.telegram.sendMessage(
        receiver.telegram_user_id,
        '🎁 یک هدیه‌ی جدید و ناشناس دریافت کردید! برای دیدنش Mini App رو باز کن.',
        Markup.inlineKeyboard([[Markup.button.webApp('🎁 مشاهده هدیه', `${env.TELEGRAM_WEBAPP_URL}/gifts`)]])
      );
    }
  } catch (err) {
    console.error('successful_payment handling failed:', err.message);
  }
});

bot.catch((err, ctx) => {
  console.error(`Telegraf error for update ${ctx.update.update_id}:`, err);
});

module.exports = bot;
