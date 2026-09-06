const { createClient } = require('@supabase/supabase-js');
const env = require('../config/env');

// This client uses the SERVICE ROLE key, which bypasses Row Level Security.
// It must ONLY ever be used here, on the backend. It must never be sent
// to the Mini App / frontend under any circumstance.
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

module.exports = supabase;
