const { Telegraf, Markup } = require('telegraf');
const env = require('../config/env');
const { getOrCreateUser } = require('../lib/userService');
const { finalizeGiftPayment } = require('../lib/giftService');
const { isBlocked } = require('../lib/blockService');
const { notifyNewMessage } = require('../lib/notify');
const { ensureBotUsername } = require('../lib/botInfo');
const supabase = require('../lib/supabaseClient');

const bot = new Telegraf(env.BOT_TOKEN);

const MAX_MESSAGE_LENGTH = 2000;

// In-memory "what is this chat currently doing" state, keyed by Telegram
// user id. Good enough for a single-instance free-tier deployment.
const pending = new Map();

function openAppButton(path = '') {
  const url = path ? `${env.TELEGRAM_WEBAPP_URL}/#${path}` : env.TELEGRAM_WEBAPP_URL;
  return Markup.inlineKeyboard([Markup.button.webApp('📱 باز کردن Mini App', url)]);
}

async function buildDeepLink(slug) {
  const username = await ensureBotUsername(bot);
  return `https://t.me/${username}?start=msg_${slug}`;
}

async function getActiveSlug(userId) {
  const { data } = await supabase
    .from('anonymous_links')
    .select('slug')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  return data ? data.slug : null;
}

async function resolveLinkOwner(slug) {
  const { data: link } = await supabase
    .from('anonymous_links')
    .select('user_id, is_active')
    .eq('slug', slug)
    .maybeSingle();

  if (!link || !link.is_active) return null;

  const { data: owner } = await supabase
    .from('users')
    .select('id, telegram_user_id, allow_anonymous_messages')
    .eq('id', link.user_id)
    .maybeSingle();

  return owner || null;
}

bot.start(async (ctx) => {
  const me = await getOrCreateUser({
    telegramUserId: ctx.from.id,
    telegramUsername: ctx.from.username,
    firstName: ctx.from.first_name,
    lastName: ctx.from.last_name,
    photoUrl: null,
  });

  const payload = ctx.startPayload;

  if (payload && payload.startsWith('msg_')) {
    const slug = payload.slice(4);
    const owner = await resolveLinkOwner(slug);

    if (!owner) {
      return ctx.reply('این لینک ناشناس دیگر معتبر نیست.');
    }
    if (owner.id === me.id) {
      return ctx.reply('این لینک متعلق به خودتونه 🙂');
    }
    if (!owner.allow_anonymous_messages) {
      return ctx.reply('این کاربر در حال حاضر پیام ناشناس دریافت نمی‌کند.');
    }
    if (await isBlocked(owner.id, me.id)) {
      return ctx.reply('❌ شما توسط این کاربر مسدود شده‌اید و امکان ارسال پیام ندارید.');
    }

    pending.set(ctx.from.id, { type: 'send', slug });
    return ctx.reply('✉️ پیامت رو بنویس و بفرست — کاملاً ناشناس براش ارسال میشه:');
  }

  const slug = await getActiveSlug(me.id);
  const link = slug ? await buildDeepLink(slug) : null;

  await ctx.reply(
    `👋 سلام!\n\nاینجا می‌تونی یک لینک ناشناس اختصاصی داشته باشی و دیگران بدون اینکه هویتشون معلوم بشه برات پیام بفرستن.\n\n🔗 لینک ناشناس تو:\n${link || '—'}\n\nبرای مدیریت پیام‌ها، تنظیمات و کاربران بلاک‌شده از دکمه‌ی زیر وارد Mini App شو.`,
    openAppButton()
  );
});

bot.command('app', async (ctx) => {
  await ctx.reply('برای باز کردن Mini App دکمه زیر رو بزن:', openAppButton());
});

bot.command('menu', async (ctx) => {
  await ctx.reply(
    'منوی اصلی:',
    Markup.inlineKeyboard([
      [Markup.button.webApp('💬 پیام‌های من', `${env.TELEGRAM_WEBAPP_URL}/#/messages`)],
      [Markup.button.webApp('🎁 ارسال گیفت', `${env.TELEGRAM_WEBAPP_URL}/#/gifts`)],
      [Markup.button.webApp('👤 پروفایل', `${env.TELEGRAM_WEBAPP_URL}/#/profile`)],
      [Markup.button.webApp('🚫 بلاک‌شده‌ها', `${env.TELEGRAM_WEBAPP_URL}/#/blocked`)],
      [Markup.button.webApp('⚙️ تنظیمات', `${env.TELEGRAM_WEBAPP_URL}/#/settings`)],
    ])
  );
});

async function sendAnonymousMessage(fromUserId, slug, text) {
  const owner = await resolveLinkOwner(slug);
  if (!owner) throw new Error('این لینک دیگر معتبر نیست.');
  if (!owner.allow_anonymous_messages) throw new Error('این کاربر پیام ناشناس دریافت نمی‌کند.');
  if (await isBlocked(owner.id, fromUserId)) throw new Error('❌ شما توسط این کاربر مسدود شده‌اید.');

  const { data: message, error } = await supabase
    .from('messages')
    .insert({ sender_id: fromUserId, receiver_id: owner.id, text, status: 'sent' })
    .select('id')
    .single();
  if (error) throw error;

  notifyNewMessage(owner.telegram_user_id, { id: message.id, text, receiver_id: owner.id }).catch((err) =>
    console.error('notifyNewMessage failed:', err.message)
  );
}

async function sendReply(fromUserId, originalMessageId, text) {
  const { data: original, error } = await supabase
    .from('messages')
    .select('*')
    .eq('id', originalMessageId)
    .maybeSingle();
  if (error) throw error;
  if (!original || original.receiver_id !== fromUserId) throw new Error('این پیام پیدا نشد.');
  if (!original.sender_id) throw new Error('فرستنده‌ی اصلی دیگر در دسترس نیست.');
  if (await isBlocked(original.sender_id, fromUserId)) throw new Error('شما توسط این کاربر بلاک شده‌اید.');

  const { data: reply, error: insertError } = await supabase
    .from('messages')
    .insert({
      sender_id: fromUserId,
      receiver_id: original.sender_id,
      text,
      reply_to_message_id: original.id,
      status: 'sent',
    })
    .select('id')
    .single();
  if (insertError) throw insertError;

  const { data: replyReceiver } = await supabase
    .from('users')
    .select('telegram_user_id')
    .eq('id', original.sender_id)
    .maybeSingle();

  if (replyReceiver) {
    notifyNewMessage(replyReceiver.telegram_user_id, {
      id: reply.id,
      text,
      receiver_id: original.sender_id,
    }).catch((err) => console.error('notifyNewMessage (reply) failed:', err.message));
  }
}

bot.action(/^r:(.+)$/, async (ctx) => {
  const messageId = ctx.match[1];
  pending.set(ctx.from.id, { type: 'reply', messageId });
  await ctx.answerCbQuery();
  await ctx.reply('✏️ پاسخت رو بنویس:');
});

bot.action(/^b:(.+)$/, async (ctx) => {
  const messageId = ctx.match[1];
  try {
    const me = await getOrCreateUser({ telegramUserId: ctx.from.id, telegramUsername: ctx.from.username });
    const { data: message } = await supabase.from('messages').select('sender_id').eq('id', messageId).maybeSingle();

    if (message && message.sender_id) {
      await supabase
        .from('blocks')
        .upsert(
          { blocker_user_id: me.id, blocked_user_id: message.sender_id },
          { onConflict: 'blocker_user_id,blocked_user_id', ignoreDuplicates: true }
        );
    }
    await ctx.answerCbQuery('فرستنده بلاک شد ✅');
  } catch (err) {
    console.error('block action failed:', err.message);
    await ctx.answerCbQuery('خطایی رخ داد');
  }
});

bot.action(/^d:(.+)$/, async (ctx) => {
  const messageId = ctx.match[1];
  try {
    await supabase
      .from('messages')
      .update({ deleted_at_receiver: new Date().toISOString() })
      .eq('id', messageId);
    await ctx.answerCbQuery('حذف شد ✅');
    await ctx.editMessageText('🗑 این پیام حذف شد.');
  } catch (err) {
    console.error('delete action failed:', err.message);
    await ctx.answerCbQuery('خطایی رخ داد');
  }
});

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

bot.on('message', async (ctx, next) => {
  const successfulPayment = ctx.message && ctx.message.successful_payment;
  if (successfulPayment) {
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
          Markup.inlineKeyboard([[Markup.button.webApp('🎁 مشاهده هدیه', `${env.TELEGRAM_WEBAPP_URL}/#/gifts`)]])
        );
      }
    } catch (err) {
      console.error('successful_payment handling failed:', err.message);
    }
    return;
  }

  const text = ctx.message && ctx.message.text;
  if (!text || text.startsWith('/')) return next();

  const state = pending.get(ctx.from.id);
  if (!state) return next();

  if (text.length > MAX_MESSAGE_LENGTH) {
    return ctx.reply(`پیام خیلی طولانیه (حداکثر ${MAX_MESSAGE_LENGTH} کاراکتر).`);
  }

  try {
    const me = await getOrCreateUser({ telegramUserId: ctx.from.id, telegramUsername: ctx.from.username });

    if (state.type === 'send') {
      await sendAnonymousMessage(me.id, state.slug, text);
      await ctx.reply('✅ پیامت ناشناس ارسال شد.');
    } else if (state.type === 'reply') {
      await sendReply(me.id, state.messageId, text);
      await ctx.reply('✅ پاسخت ارسال شد.');
    }
  } catch (err) {
    await ctx.reply(`⚠️ ${err.message}`);
  } finally {
    pending.delete(ctx.from.id);
  }
});

bot.catch((err, ctx) => {
  console.error(`Telegraf error for update ${ctx.update.update_id}:`, err);
});

module.exports = bot;
