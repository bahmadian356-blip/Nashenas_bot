const express = require('express');
const supabase = require('../../lib/supabaseClient');
const env = require('../../config/env');
const { generateSlug } = require('../../lib/userService');

const router = express.Router();

// GET /api/me — returns the current user's profile + their active anonymous link.
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
    anonymous_link: link ? `${env.TELEGRAM_WEBAPP_URL}/#/u/${link.slug}` : null,
    anonymous_slug: link ? link.slug : null,
  });
});

// PATCH /api/me/settings — update privacy toggles
router.patch('/settings', async (req, res) => {
  const allowed = ['allow_anonymous_messages', 'show_last_seen', 'show_online_status'];
  const updates = {};

  for (const key of allowed) {
    if (typeof req.body[key] === 'boolean') {
      updates[key] = req.body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid settings provided' });
  }

  const { error } = await supabase.from('users').update(updates).eq('id', req.user.id);
  if (error) {
    console.error('settings update failed:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  res.json({ ok: true, updated: updates });
});

// PATCH /api/me/link/regenerate — deactivate the old link, create a new one
router.patch('/link/regenerate', async (req, res) => {
  const { error: deactivateError } = await supabase
    .from('anonymous_links')
    .update({ is_active: false, deactivated_at: new Date().toISOString() })
    .eq('user_id', req.user.id)
    .eq('is_active', true);

  if (deactivateError) {
    console.error('link regenerate: deactivate failed:', deactivateError.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  let newLink = null;
  for (let attempt = 0; attempt < 5 && !newLink; attempt++) {
    const slug = generateSlug();
    const { data, error } = await supabase
      .from('anonymous_links')
      .insert({ user_id: req.user.id, slug, is_active: true })
      .select('slug')
      .maybeSingle();

    if (!error) newLink = data;
    else if (error.code !== '23505') {
      console.error('link regenerate: insert failed:', error.message);
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  if (!newLink) return res.status(500).json({ error: 'Could not generate a new link' });

  res.json({ anonymous_link: `${env.TELEGRAM_WEBAPP_URL}/#/u/${newLink.slug}`, anonymous_slug: newLink.slug });
});

module.exports = router;module.exports = router;
