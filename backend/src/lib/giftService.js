const crypto = require('crypto');
const supabase = require('./supabaseClient');

async function getAvailableGifts() {
  const { data, error } = await supabase
    .from('gift_catalog')
    .select('id, category, name, description, image_url, animation_url, price_stars')
    .eq('is_available', true)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return data;
}

/**
 * Step 1 of the gift flow: validates the gift + receiver, and creates
 * matching `payments` (pending) + `gift_transactions` (pending) rows.
 * The actual Stars charge happens afterwards via a Telegram invoice —
 * we never trust a price sent from the frontend, we always re-read it
 * from gift_catalog here.
 */
async function createGiftPurchase({ buyerId, giftId, receiverId, message }) {
  const { data: gift, error: giftError } = await supabase
    .from('gift_catalog')
    .select('id, name, price_stars, is_available')
    .eq('id', giftId)
    .maybeSingle();

  if (giftError) throw giftError;
  if (!gift || !gift.is_available) {
    const err = new Error('Gift not found or unavailable');
    err.statusCode = 404;
    throw err;
  }

  const invoicePayload = crypto.randomUUID();

  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .insert({
      user_id: buyerId,
      invoice_payload: invoicePayload,
      amount_stars: gift.price_stars,
      status: 'pending',
    })
    .select('*')
    .single();

  if (paymentError) throw paymentError;

  const { data: transaction, error: txError } = await supabase
    .from('gift_transactions')
    .insert({
      payment_id: payment.id,
      gift_id: gift.id,
      sender_id: buyerId,
      receiver_id: receiverId,
      message: message || null,
      status: 'pending',
    })
    .select('*')
    .single();

  if (txError) throw txError;

  return { payment, transaction, gift };
}

/**
 * Step 2: called from the bot's `successful_payment` handler once
 * Telegram confirms the Stars charge went through. Idempotent — safe to
 * call more than once for the same charge (Telegram can retry updates).
 */
async function finalizeGiftPayment({ invoicePayload, telegramPaymentChargeId, providerPaymentChargeId }) {
  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .select('*')
    .eq('invoice_payload', invoicePayload)
    .maybeSingle();

  if (paymentError) throw paymentError;
  if (!payment) throw new Error(`No payment found for invoice_payload ${invoicePayload}`);

  if (payment.status === 'paid') {
    // Already processed (duplicate webhook/update) — nothing more to do.
    return { alreadyProcessed: true };
  }

  const { error: updatePaymentError } = await supabase
    .from('payments')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      telegram_payment_charge_id: telegramPaymentChargeId,
      provider_payment_charge_id: providerPaymentChargeId || null,
    })
    .eq('id', payment.id);

  if (updatePaymentError) throw updatePaymentError;

  const { data: transaction, error: txError } = await supabase
    .from('gift_transactions')
    .select('*')
    .eq('payment_id', payment.id)
    .maybeSingle();

  if (txError) throw txError;
  if (!transaction) throw new Error(`No gift_transaction found for payment ${payment.id}`);

  await supabase
    .from('gift_transactions')
    .update({ status: 'delivered', delivered_at: new Date().toISOString() })
    .eq('id', transaction.id);

  const { data: userGift, error: userGiftError } = await supabase
    .from('user_gifts')
    .insert({
      gift_transaction_id: transaction.id,
      owner_user_id: transaction.receiver_id,
      gift_id: transaction.gift_id,
      is_new: true,
    })
    .select('*')
    .single();

  if (userGiftError) throw userGiftError;

  return { alreadyProcessed: false, transaction, userGift };
}

module.exports = { getAvailableGifts, createGiftPurchase, finalizeGiftPayment };
