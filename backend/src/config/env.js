require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    // Fail fast and loud at boot time rather than deep inside a request handler.
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const env = {
  BOT_TOKEN: required('BOT_TOKEN'),
  BACKEND_PUBLIC_URL: required('BACKEND_PUBLIC_URL'),
  TELEGRAM_WEBAPP_URL: required('TELEGRAM_WEBAPP_URL'),

  SUPABASE_URL: required('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: required('SUPABASE_SERVICE_ROLE_KEY'),
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',

  PORT: parseInt(process.env.PORT || '3000', 10),
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  NODE_ENV: process.env.NODE_ENV || 'development',
};

module.exports = env;
