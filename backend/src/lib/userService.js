const crypto = require('crypto');
const supabase = require('./supabaseClient');

/**
 * Generates a short, URL-safe, hard-to-guess slug for anonymous links.
 * 8 chars of base32-ish alphabet -> ~40 bits of entropy, plenty for this use case.
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
    // Keep profile fields fresh on every login.
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

  // New user: create the row, then create their first anonymous link.
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

  // Retry a coup
