const express = require('express');
const supabase = require('../../lib/supabaseClient');
const { isBlocked } = require('../../lib/blockService');
const { notifyNewMessage, notifyMessageSeen } = require('../../lib/notify');

const router = express.Router();

function pseudonym(id) {
  return 'ناشناس ' + id.slice(0, 4).toUpperCase();
}

async function fetchMyMessages(myId, limit = 1000) {
  const { data, error } = await supabase
    .from('messages')
    .select(
      'id, sender_id, receiver_id, text, reply_to_message_id, read_at, edited_at, created_at, deleted_at_sender, deleted_at_receiver'
    )
    .or(`sender_id.eq.${myId},receiver_id.eq.${myId}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

function visibleFor(myId, m) {
  if (m.sender_id === myId) return !m.deleted_at_sender;
  if (m.receiver_id === myId) return !m.deleted_at_receiver;
  return false;
}

router.get('/', async (req, res) => {
  try {
    const myId = req.user.id;
    const all = (await fetchMyMessages(myId)).filter((m) => visibleFor(myId, m));

    const groups = new Map();
    for (const m of all) {
      const counterpart = m.sender_id === myId ? m.receiver_id : m.sender_id;
      if (!counterpart) continue;
      if (!groups.has(counterpart)) groups.set(counterpart, []);
      groups.get(counterpart).push(m);
    }

    const conversations = await Promise.all(
      Array.from(groups.entries()).map(async ([counterpartId, msgs]) => {
        msgs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const last = msgs[0];
        const unread = msgs.filter((m) => m.receiver_id === myId && !m.read_at).length;
        const revealed = msgs.some(
          (m) => m.sender_id === myId && m.receiver_id === counterpartId && !m.reply_to_message_id
        );

        const { data: counterpart } = await supabase
          .from('users')
          .select('display_name, avatar_url, is_online, last_seen, show_online_status, show_last_seen')
          .eq('id', counterpartId)
          .maybeSingle();

        return {
          counterpart_id: counterpartId,
          name: revealed && counterpart ? counterpart.display_name : pseudonym(counterpartId),
          avatar_url: revealed && counterpart ? counterpart.avatar_url : null,
          revealed,
          is_online: counterpart && counterpart.show_online_status ? counterpart.is_online : null,
          last_seen: counterpart && counterpart.show_last_seen ? counterpart.last_seen : null,
          last_message: last.text,
          last_message_at: last.created_at,
          unread_count: unread,
        };
      })
    );

    conversations.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
    res.json({ conversations });
  } catch (err) {
    console.error('conversations list failed:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.get('/:counterpartId', async (req, res) => {
  try {
    const myId = req.user.id;
    const counterpartId = req.params.counterpartId;
    const all = (await fetchMyMessages(myId, 1000)).filter(
      (m) => visibleFor(myId, m) && (m.sender_id === counterpartId || m.receiver_id === counterpartId)
    );

    if (all.length === 0) {
      return res.status(404).json({ error: 'مکالمه‌ای پیدا نشد' });
    }

    all.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const revealed = all.some(
      (m) => m.sender_id === myId && m.receiver_id === counterpartId && !m.reply_to_message_id
    );

    const { data: counterpart } = await supabase
      .from('users')
      .select('telegram_user_id, display_name, avatar_url, is_online, last_seen, show_online_status, show_last_seen')
      .eq('id', counterpartId)
      .maybeSingle();

    const unreadIds = all.filter((m) => m.receiver_id === myId && !m.read_at).map((m) => m.id);
    if (unreadIds.length > 0) {
      await supabase
        .from('messages')
        .update({ read_at: new Date().toISOString(), status: 'seen' })
        .in('id', unreadIds);
      if (counterpart) {
        notifyMessageSeen(counterpart.telegram_user_id).catch(() => {});
      }
    }

    res.json({
      counterpart: {
        id: counterpartId,
        name: revealed && counterpart ? counterpart.display_name : pseudonym(counterpartId),
        avatar_url: revealed && counterpart ? counterpart.avatar_url : null,
        revealed,
        is_online: counterpart && counterpart.show_online_status ? counterpart.is_online : null,
        last_seen: counterpart && counterpart.show_last_seen ? counterpart.last_seen : null,
      },
      messages: all.map((m) => ({
        id: m.id,
        text: m.text,
        is_mine: m.sender_id === myId,
        edited_at: m.edited_at,
        read_at: m.read_at,
        created_at: m.created_at,
      })),
    });
  } catch (err) {
    console.error('conversation thread failed:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/:counterpartId/send', async (req, res) => {
  try {
    const myId = req.user.id;
    const counterpartId = req.params.counterpartId;
    const { text } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    if (text.length > 2000) {
      return res.status(400).json({ error: 'Message too long' });
    }

    const all = await fetchMyMessages(myId, 1000);
    const between = all.filter((m) => m.sender_id === counterpartId || m.receiver_id === counterpartId);
    if (between.length === 0) {
      return res.status(404).json({ error: 'مکالمه‌ای شروع نشده — اول باید از طریق لینک ناشناس پیام بدید' });
    }

    if (await isBlocked(counterpartId, myId)) {
      return res.status(403).json({ error: '❌ شما توسط این کاربر مسدود شده‌اید.' });
    }

    const amCold = between.some(
      (m) => m.sender_id === myId && m.receiver_id === counterpartId && !m.reply_to_message_id
    );
    let replyToId = null;
    if (!amCold) {
      const lastFromThem = between
        .filter((m) => m.sender_id === counterpartId && m.receiver_id === myId)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      replyToId = lastFromThem ? lastFromThem.id : null;
    }

    const { data: message, error } = await supabase
      .from('messages')
      .insert({
        sender_id: myId,
        receiver_id: counterpartId,
        text: text.trim(),
        reply_to_message_id: replyToId,
        status: 'sent',
      })
      .select('id, created_at')
      .single();
    if (error) throw error;

    const { data: counterpart } = await supabase
      .from('users')
      .select('telegram_user_id')
      .eq('id', counterpartId)
      .maybeSingle();

    if (counterpart) {
      notifyNewMessage(counterpart.telegram_user_id, {
        id: message.id,
        text: text.trim(),
        receiver_id: counterpartId,
      }).catch((err) => console.error('notifyNewMessage failed:', err.message));
    }

    res.status(201).json({ id: message.id, created_at: message.created_at });
  } catch (err) {
    console.error('conversation send failed:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
