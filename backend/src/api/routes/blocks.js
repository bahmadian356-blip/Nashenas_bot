const express = require('express');
const supabase = require('../../lib/supabaseClient');

const router = express.Router();

// ---------------------------------------------------------------------
// GET /api/blocks — list of users the current user has blocked.
// Note: we deliberately do NOT join/expose display_name or username of
// the blocked user — they reached this user anonymously, and blocking
// them doesn't unmask them. Only the opaque id + when they were blocked.
// ---------------------------------------------------------------------
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('blocks')
    .select('blocked_user_id, created_at')
    .eq('blocker_user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('blocks list: query failed:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  res.json({ blocks: data });
});

// ---------------------------------------------------------------------
// POST /api/blocks  { user_id }
// Blocks a user by their internal id (obtained from a message's
// sender_id field, which the Mini App already has from the inbox).
// ---------------------------------------------------------------------
router.post('/', async (req, res) => {
  const { user_id } = req.body || {};
  if (!user_id || typeof user_id !== 'string') {
    return res.status(400).json({ error: 'user_id is required' });
  }
  if (user_id === req.user.id) {
    return res.status(400).json({ error: 'You cannot block yourself' });
  }

  const { error } = await supabase
    .from('blocks')
    .upsert(
      { blocker_user_id: req.user.id, blocked_user_id: user_id },
      { onConflict: 'blocker_user_id,blocked_user_id', ignoreDuplicates: true }
    );

  if (error) {
    console.error('block: insert failed:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  res.status(201).json({ ok: true });
});

// ---------------------------------------------------------------------
// DELETE /api/blocks/:userId — unblock
// ---------------------------------------------------------------------
router.delete('/:userId', async (req, res) => {
  const { error } = await supabase
    .from('blocks')
    .delete()
    .eq('blocker_user_id', req.user.id)
    .eq('blocked_user_id', req.params.userId);

  if (error) {
    console.error('unblock: delete failed:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  res.json({ ok: true });
});

module.exports = router;
