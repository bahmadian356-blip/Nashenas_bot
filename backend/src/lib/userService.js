const crypto = require('crypto');
const supabase = require('./supabaseClient');

/**
 * Generates a short, URL-safe, hard-to-guess slug for anonymous links.
 */
function generateSlug(length = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
  const bytes = crypto.randomBytes(length);
  let slug = '';
  for (let i = 0; i < length; i++) {
    slug += alphabet[bytes[i] % alphabet.length];
  }
  return slug;
}

/**
 * Finds a user by telegram_user_id, creating them (with a fresh anonymous
 * link) if they don't exist yet. Also refreshes profile fields that can
 * change over time (username, display name, avatar).
 */
async function getOrCreateUser(telegramUser) {
  const { telegramUserId, telegramUsername, firstName, lastName, photoUrl } = telegramUser;
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || telegramUsername || 'کاربر ناشناس';

  const { data: existing, error: findError } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle();

  if (findError) throw findError;

  if (existing) {
    const { data: updated, error: updateError } = await supabase
      .from('users')
      .update({
        telegram_username: telegramUsername,
        display_name: displayName,
        avatar_url: photoUrl,
      })
      .eq('id', existing.id)
      .select('*')
      .single();

    if (updateError) throw updateError;
    return updated;
  }

  const { data: created, error: createError } = await supabase
    .from('users')
    .insert({
      telegram_user_id: telegramUserId,
      telegram_username: telegramUsername,
      display_name: displayName,
      avatar_url: photoUrl,
    })
    .select('*')
    .single();

  if (createError) throw createError;

  let link = null;
  for (let attempt = 0; attempt < 5 && !link; attempt++) {
    const slug = generateSlug();
    const { data, error } = await supabase
      .from('anonymous_links')
      .insert({ user_id: created.id, slug, is_active: true })
      .select('*')
      .maybeSingle();

    if (!error) link = data;
    else if (error.code !== '23505') throw error;
  }

  if (!link) throw new Error('Could not allocate a unique anonymous link slug');

  return created;
}

async function markOnline(userId) {
  await supabase
    .from('users')
    .update({ is_online: true, last_seen: new Date().toISOString() })
    .eq('id', userId);

  await supabase
    .from('presence')
    .upsert({ user_id: userId, is_online: true, last_ping_at: new Date().toISOString() });
}

async function markOffline(userId) {
  await supabase
    .from('users')
    .update({ is_online: false, last_seen: new Date().toISOString() })
    .eq('id', userId);

  await supabase
    .from('presence')
    .upsert({ user_id: userId, is_online: false, last_ping_at: new Date().toISOString() });
}

module.exports = { getOrCreateUser, markOnline, markOffline, generateSlug };
