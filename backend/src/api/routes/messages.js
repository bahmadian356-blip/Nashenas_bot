const express = require('express');
const rateLimit = require('express-rate-limit');
const supabase = require('../../lib/supabaseClient');
const { isBlocked } = require('../../lib/blockService');
const { notifyNewMessage, notifyMessageSeen } = require('../../lib/notify');

const router = express.Router();

// Stricter limiter just for sending — the global API limiter (server.js)
// already covers general abuse, this specifically curbs message spam.
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'شما بیش از حد مجاز پیام ارسال کرده‌اید، کمی صبر کنید.' },
});

const MAX_MESSAGE_LENGTH = 2000;

// ---------------------------------------------------------------------
// POST /api/messages/send  { slug, text }
// Sends an anonymous message to the owner of the given link slug.
// ---------------------------------------------------------------------
router.post('/send', sendLimiter, async (req, res) => {
  const { slug, text } = req.body || {};

  if (!slug || typeof slug !== 'string') {
    return res.status(400).json({ error: 'slug is required' });
  }
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` });
  }

  const { data: link, error: linkError } = await supabase
    .from('anonymous_links')
    .select('user_id, is_active')
    .eq('slug', slug)
    .maybeSingle();

  if (linkError) {
    console.error('send: failed to load link:', linkError.message);
    return res.status(500).json({ error: 'Internal error' });
  }
  if (!link || !link.is_active) {
    return res.status(404).json({ error: 'This link does not exist or is no longer active' });
  }

  const receiverId = link.user_id;
  if (receiverId === req.user.id) {
    return res.status(400).json({ error: 'You cannot send a message to your own link' });
  }

  const { data: receiver, error: receiverError } = await supabase
    .from('users')
    .select('id, telegram_user_id, allow_anonymous_messages')
    .eq('id', receiverId)
    .maybeSingle();

  if (receiverError || !receiver) {
    return res.status(404).json({ error: 'Recipient not found' });
  }
  if (!receiver.allow_anonymous_messages) {
    return res.status(403).json({ error: 'This user is not accepting anonymous messages right now' });
  }

  const blocked = await isBlocked(receiverId, req.user.id);
  if (blocked) {
    return res.status(403).json({ error: '❌ شما توسط این کاربر مسدود شده‌اید و امکان ارسال پیام ندارید.' });
  }

  const { data: message, error: insertError } = await supabase
    .from('messages')
    .insert({
      sender_id: req.user.id,
      receiver_id: receiverId,
      text: text.trim(),
      status: 'sent',
    })
    .select('id, created_at')
    .single();

  if (insertError) {
    console.error('send: failed to insert message:', insertError.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  notifyNewMessage(receiver.telegram_user_id, receiverId).catch((err) =>
    console.error('notifyNewMessage failed:', err.message)
  );

  res.status(201).json({ id: message.id, created_at: message.created_at });
});

// ---------------------------------------------------------------------
// GET /api/messages/inbox?limit=&before=
// Messages received by the current user. Sender identity is NEVER
// included beyond the opaque internal id (needed for block/reply
// actions) — no telegram_username, display_name, or avatar of the sender.
// ---------------------------------------------------------------------
router.get('/inbox', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
  let query = supabase
    .from('messages')
    .select('id, sender_id, text, reply_to_message_id, status, read_at, edited_at, pinned, created_at')
    .eq('receiver_id', req.user.id)
    .is('deleted_at_receiver', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (req.query.before) {
    query = query.lt('created_at', req.query.before);
  }

  const { data, error } = await query;
  if (error) {
    console.error('inbox: query failed:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  res.json({ messages: data });
});

// ---------------------------------------------------------------------
// GET /api/messages/outbox?limit=&before=
// Messages the current user has sent. Since the sender deliberately
// chose the recipient's link, showing the recipient's public info here
// is fine (it's not the anonymity boundary — only sender->receiver is).
// ---------------------------------------------------------------------
router.get('/outbox', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
  let query = supabase
    .from('messages')
    .select(
      'id, receiver_id, text, status, read_at, edited_at, created_at, users:receiver_id (display_name, avatar_url)'
    )
    .eq('sender_id', req.user.id)
    .is('deleted_at_sender', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (req.query.before) {
    query = query.lt('created_at', req.query.before);
  }

  const { data, error } = await query;
  if (error) {
    console.error('outbox: query failed:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  res.json({ messages: data });
});

// Helper: loads a message and ensures the current user is either the
// sender or the receiver of it. Returns null (and has already responded)
// if not found / not authorized.
async function loadOwnedMessage(req, res, messageId) {
  const { data: message, error } = await supabase
    .from('messages')
    .select('*')
    .eq('id', messageId)
    .maybeSingle();

  if (error) {
    console.error('loadOwnedMessage: query failed:', error.message);
    res.status(500).json({ error: 'Internal error' });
    return null;
  }
  if (!message) {
    res.status(404).json({ error: 'Message not found' });
    return null;
  }
  if (message.sender_id !== req.user.id && message.receiver_id !== req.user.id) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return message;
}

// ---------------------------------------------------------------------
// PATCH /api/messages/:id/read — receiver marks a message as seen
// ---------------------------------------------------------------------
router.patch('/:id/read', async (req, res) => {
  const message = await loadOwnedMessage(req, res, req.params.id);
  if (!message) return;

  if (message.receiver_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the receiver can mark a message as read' });
  }
  if (message.read_at) {
    return res.json({ ok: true }); // already read, idempotent
  }

  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString(), status: 'seen' })
    .eq('id', message.id);

  if (error) {
    console.error('mark read failed:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  if (message.sender_id) {
    const { data: sender } = await supabase
      .from('users')
      .select('telegram_user_id')
      .eq('id', message.sender_id)
      .maybeSingle();
    if (sender) {
      notifyMessageSeen(sender.telegram_user_id).catch((err) =>
        console.error('notifyMessageSeen failed:', err.message)
      );
    }
  }

  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// POST /api/messages/:id/reply  { text }
// Only the receiver of the original message may reply — this creates a
// brand-new message with sender/receiver swapped, linked via
// reply_to_message_id. The original sender remains anonymous to the
// (new) receiver just like any other message.
// ---------------------------------------------------------------------
router.post('/:id/reply', async (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` });
  }

  const original = await loadOwnedMessage(req, res, req.params.id);
  if (!original) return;

  if (original.receiver_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the receiver can reply to this message' });
  }
  if (!original.sender_id) {
    return res.status(400).json({ error: 'The original sender is no longer available' });
  }

  const blocked = await isBlocked(original.sender_id, req.user.id);
  if (blocked) {
    return res.status(403).json({ error: 'You cannot reply — the recipient has blocked you' });
  }

  const { data: newMessage, error } = await supabase
    .from('messages')
    .insert({
      sender_id: req.user.id,
      receiver_id: original.sender_id,
      text: text.trim(),
      reply_to_message_id: original.id,
      status: 'sent',
    })
    .select('id, created_at')
    .single();

  if (error) {
    console.error('reply: insert failed:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  const { data: replyReceiver } = await supabase
    .from('users')
    .select('telegram_user_id')
    .eq('id', original.sender_id)
    .maybeSingle();

  if (replyReceiver) {
    notifyNewMessage(replyReceiver.telegram_user_id, original.sender_id).catch((err) =>
      console.error('notifyNewMessage (reply) failed:', err.message)
    );
  }

  res.status(201).json({ id: newMessage.id, created_at: newMessage.created_at });
});

// ---------------------------------------------------------------------
// PATCH /api/messages/:id  { text } — sender edits their own message
// ---------------------------------------------------------------------
router.patch('/:id', async (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` });
  }

  const message = await loadOwnedMessage(req, res, req.params.id);
  if (!message) return;

  if (message.sender_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the sender can edit this message' });
  }
  if (message.deleted_at_sender) {
    return res.status(400).json({ error: 'Cannot edit a deleted message' });
  }

  const { error } = await supabase
    .from('messages')
    .update({ text: text.trim(), edited_at: new Date().toISOString() })
    .eq('id', message.id);

  if (error) {
    console.error('edit: update failed:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// DELETE /api/messages/:id — soft delete, scoped to whichever side
// (sender/receiver) the current user is on.
// ---------------------------------------------------------------------
router.delete('/:id', async (req, res) => {
  const message = await loadOwnedMessage(req, res, req.params.id);
  if (!message) return;

  const field = message.sender_id === req.user.id ? 'deleted_at_sender' : 'deleted_at_receiver';

  const { error } = await supabase
    .from('messages')
    .update({ [field]: new Date().toISOString() })
    .eq('id', message.id);

  if (error) {
    console.error('delete: update failed:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// PATCH /api/messages/:id/pin — receiver pins/unpins a message in their inbox
// ---------------------------------------------------------------------
router.patch('/:id/pin', async (req, res) => {
  const { pinned } = req.body || {};
  const message = await loadOwnedMessage(req, res, req.params.id);
  if (!message) return;

  if (message.receiver_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the receiver can pin this message' });
  }

  const { error } = await supabase
    .from('messages')
    .update({ pinned: !!pinned })
    .eq('id', message.id);

  if (error) {
    console.error('pin: update failed:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// POST /api/messages/:id/report  { reason }
// ---------------------------------------------------------------------
router.post('/:id/report', async (req, res) => {
  const { reason } = req.body || {};
  const message = await loadOwnedMessage(req, res, req.params.id);
  if (!message) return;

  const { error: reportError } = await supabase
    .from('message_reports')
    .insert({ message_id: message.id, reported_by: req.user.id, reason: reason || null });

  if (reportError) {
    console.error('report: insert failed:', reportError.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  await supabase.from('messages').update({ reported: true }).eq('id', message.id);

  res.json({ ok: true });
});

module.exports = router;
