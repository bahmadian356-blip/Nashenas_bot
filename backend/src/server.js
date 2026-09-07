const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const env = require('./config/env');
const bot = require('./bot/bot');
const { requireTelegramAuth } = require('./api/middleware/auth');
const meRoutes = require('./api/routes/me');
const linksRoutes = require('./api/routes/links');
const messagesRoutes = require('./api/routes/messages');
const blocksRoutes = require('./api/routes/blocks');
const giftsRoutes = require('./api/routes/gifts');
const conversationsRoutes = require('./api/routes/conversations');

const app = express();
app.set('trust proxy', 1);

const WEBHOOK_PATH = `/telegraf/${env.BOT_TOKEN}`;
app.use(bot.webhookCallback(WEBHOOK_PATH));

app.use(express.json());

app.use(
  cors({
    origin: env.ALLOWED_ORIGINS.length > 0 ? env.ALLOWED_ORIGINS : false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Telegram-Init-Data'],
  })
);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.use('/api/me', requireTelegramAuth, meRoutes);
app.use('/api/links', requireTelegramAuth, linksRoutes);
app.use('/api/messages', requireTelegramAuth, messagesRoutes);
app.use('/api/blocks', requireTelegramAuth, blocksRoutes);
app.use('/api/gifts', requireTelegramAuth, giftsRoutes);
app.use('/api/conversations', requireTelegramAuth, conversationsRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

const { ensureBotUsername } = require('./lib/botInfo');

async function setupWebhook() {
  const webhookUrl = `${env.BACKEND_PUBLIC_URL}${WEBHOOK_PATH}`;
  await bot.telegram.setWebhook(webhookUrl);
  console.log(`Telegram webhook set to ${webhookUrl}`);
  const username = await ensureBotUsername(bot);
  console.log(`Bot username cached: @${username}`);
}

app.listen(env.PORT, async () => {
  console.log(`Server listening on port ${env.PORT}`);
  try {
    await setupWebhook();
  } catch (err) {
    console.error('Failed to set Telegram webhook:', err.message);
  }
});
