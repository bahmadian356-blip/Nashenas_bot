const express = require('express');
const supabase = require('../../lib/supabaseClient');
const { getAvailableGifts, createGiftPurchase } = require('../../lib/giftService');

const router = express.Router();

// Lazy require to avoid a require-cycle with bot.js at module-load time.
function getBot() {
  return require('../../bot/bot');
}

// ---------------------------------------------------------------------
// GET /api/gifts — the gift store catalog
// ---------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const gifts = await getAvailableGifts();
    res.json({ gifts });
  } catch (err) {
    console.error('gifts list failed:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------
// POST /api/gifts/purchase  { gift_id, slug, message }
// Creates the pending payment + gift_transaction, then returns a
// Telegram Stars invoice link for the Mini App to open via
// Telegram.WebApp.openInvoice(link).
// ---------------------------------------------------------------------
router.post('/purchase', async (req, res) => {
  const { gift_id, slug, message } = req.body || {};

  if (!gift_id || typeof gift_id !== 'string') {
    return res.status(400).json({ error: 'gift_id is required' });
  }
  if (!slug || typeof slug !== 'string') {
    return res.status(400).json({ error: 'slug is required' });
  }
  if (message && message.length > 300) {
    return res.status(400).json({ error: 'message too long (max 300 chars)' });
  }

  const { data: link, error: linkError } = await supabase
    .from('anonymous_links')
    .select('user_id, is_active')
    .eq('slug', slug)
    .maybeSingle();

  if (linkError) {
    console.error('gift purchase: failed to load link:', linkError.message);
    return res.status(500).json({ error: 'Internal error' });
  }
  if (!link || !link.is_active) {
    return res.status(404).json({ error: 'Recipient link not found' });
  }
  if (link.user_id === req.user.id) {
    return res.status(400).json({ error: 'You cannot send a gift to yourself' });
  }

  try {
    const { payment, gift } = await createGiftPurchase({
      buyerId: req.user.id,
      giftId: gift_id,
      receiverId: link.user_id,
      message,
    });

    const bot = getBot();
    const invoiceLink = await bot.telegram.createInvoiceLink({
      title: gift.name,
      description: `ارسال هدیه «${gift.name}» به صورت ناشناس`,
      payload: payment.invoice_payload,
      currency: 'XTR', // Telegram Stars
      prices: [{ label: gift.name, amount: gift.price_stars }],
    });

    res.status(201).json({ invoice_link: invoiceLink, payment_id: payment.id });
  } catch (err) {
    console.error('gift purchase failed:', err.message);
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal error' });
  }
});

// ---------------------------------------------------------------------
// GET /api/gifts/received — gifts the current user has received.
// Sender stays anonymous here too (feature #20: "فرستنده به صورت Anonymous").
// ---------------------------------------------------------------------
router.get('/received', async (req, res) => {
  const { data, error } = await supabase
    .from('user_gifts')
    .select(
      'id, is_new, received_at, gift_catalog:gift_id (name, category, image_url, animation_url), gift_transactions:gift_transaction_id (message)'
    )
    .eq('owner_user_id', req.user.id)
    .order('received_at', { ascending: false });

  if (error) {
    console.error('gifts received failed:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  res.json({ gifts: data });
});

// ---------------------------------------------------------------------
// GET /api/gifts/sent — gifts the current user has purchased/sent.
// ---------------------------------------------------------------------
router.get('/sent', async (req, res) => {
  const { data, error } = await supabase
    .from('gift_transactions')
    .select(
      'id, status, message, created_at, delivered_at, gift_catalog:gift_id (name, category, image_url), users:receiver_id (display_name, avatar_url)'
    )
    .eq('sender_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('gifts sent failed:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  res.json({ gifts: data });
});

// ---------------------------------------------------------------------
// PATCH /api/gifts/received/:id/seen — clears the "new" badge on a gift
// ---------------------------------------------------------------------
router.patch('/received/:id/seen', async (req, res) => {
  const { error } = await supabase
    .from('user_gifts')
    .update({ is_new: false })
    .eq('id', req.params.id)
    .eq('owner_user_id', req.user.id);

  if (error) {
    console.error('mark gift seen failed:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  res.json({ ok: true });
});

module.exports = router;
