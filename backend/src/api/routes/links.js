const express = require('express');
const supabase = require('../../lib/supabaseClient');
const { isBlocked } = require('../../lib/blockService');

const router = express.Router();

// GET /api/links/:slug
// Called when the Mini App opens someone's anonymous link (`/u/:slug`).
// Requires auth because we need to know WHO is visiting, in order to
// check the block list before letting them see the send-message screen.
router.get('/:slug', async (req, res) => {
  const { slug } = req.params;

  const { data: link, error: linkError } = await supabase
    .from('anonymous_links')
    .select('user_id, is_active')
    .eq('slug', slug)
    .maybeSingle();

  if (linkError) {
    console.error('Failed to load link:', linkError.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  if (!link || !link.is_active) {
    return res.status(404).json({ error: 'This link does not exist or is no longer active' });
  }

  const { data: owner, error: ownerError } = await supabase
    .from('users')
    .select('id, display_name, avatar_url, allow_anonymous_messages')
    .eq('id', link.user_id)
    .maybeSingle();

  if (ownerError || !owner) {
    console.error('Failed to load link owner:', ownerError && ownerError.message);
    return res.status(404).json({ error: 'This link does not exist' });
  }

  // A user can't message themselves through their own link.
  if (owner.id === req.user.id) {
    return res.json({
      display_name: owner.display_name,
      avatar_url: owner.avatar_url,
      can_send: false,
      reason: 'own_link',
    });
  }

  const blocked = await isBlocked(owner.id, req.user.id);
  const canSend = owner.allow_anonymous_messages && !blocked;

  res.json({
    display_name: owner.display_name,
    avatar_url: owner.avatar_url,
    can_send: canSend,
    reason: blocked ? 'blocked' : !owner.allow_anonymous_messages ? 'disabled' : null,
  });
});

module.exports = router;
