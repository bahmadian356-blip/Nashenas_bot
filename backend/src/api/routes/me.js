const express = require('express');
const supabase = require('../../lib/supabaseClient');
const env = require('../../config/env');

const router = express.Router();

// GET /api/me — returns the current user's profile + their active anonymous link.
// Auth: requireTelegramAuth middleware (mounted in server.js) already ran,
// so req.user is guaranteed to exist and be the authoritative record.
router.get('/', async (req, res) => {
  const { data: link, error } = await supabase
    .from('anonymous_links')
    .select('slug')
    .eq('user_id', req.user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.error('Failed to load anonymous link:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  res.json({
    id: req.user.id,
    display_name: req.user.display_name,
    telegram_username: req.user.telegram_username,
    avatar_url: req.user.avatar_url,
    is_online: req.user.is_online,
    last_seen: req.user.last_seen,
    show_last_seen: req.user.show_last_seen,
    show_online_status: req.user.show_online_status,
    allow_anonymous_messages: req.user.allow_anonymous_messages,
    anonymous_link: link ? `${env.TELEGRAM_WEBAPP_URL}/u/${link.slug}` : null,
  });
});

module.exports = router;
