const supabase = require('./supabaseClient');

/**
 * Returns true if `blockerId` has blocked `blockedId`.
 */
async function isBlocked(blockerId, blockedId) {
  const { data, error } = await supabase
    .from('blocks')
    .select('id')
    .eq('blocker_user_id', blockerId)
    .eq('blocked_user_id', blockedId)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

module.exports = { isBlocked };
