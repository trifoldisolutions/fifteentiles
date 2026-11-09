require('dotenv').config();

const express = require('express');
const path = require('path');
const config = require('./config');
const { connectToDatabase } = require('./config/database');
const { createSessionService } = require('./services/session');
const { createAuthService } = require('./services/auth');
const { createBillingService } = require('./services/billing');
const { rankMaps } = require('./services/maps');
const { createEnsureAnonymousSession } = require('./middleware/ensureAnonymousSession');
const { createWebhookRoutes } = require('./routes/webhooks');
const { createPageRoutes } = require('./routes/public');
const { createApiRoutes } = require('./routes/api');
const User = require('./models/User');

const { PORT, MONGODB_URI } = config;

const app = express();
const sessionService = createSessionService(config);
sessionService.config = config;
const authService = createAuthService(config);
const billingService = createBillingService({
  config,
  stripe: config.stripe,
  User,
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Stripe signs the raw request body, so the webhook goes before express.json()
const webhooks = {
  name: 'Webhooks',
  mount: '/api',
  router: createWebhookRoutes({
    stripe: config.stripe,
    stripeWebhookSecret: config.STRIPE_WEBHOOK_SECRET,
    fulfillWalletTopUpSession: billingService.fulfillWalletTopUpSession,
  }),
};
app.use(webhooks.mount, webhooks.router);

app.use(express.json());
app.use(createEnsureAnonymousSession({
  config,
  sessionService,
}));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Facades
const facades = [
  { name: 'Public', mount: '/', router: createPageRoutes() },
  {
    name: 'API',
    mount: '/api',
    router: createApiRoutes({
      rankMaps,
      config,
      stripe: config.stripe,
      authService,
      sessionService,
      billingService,
    }),
  },
];

facades.forEach(({ mount, router }) => app.use(mount, router));

connectToDatabase(MONGODB_URI);
app.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log(`Server is running on ${base}\n`);
  [webhooks, ...facades].forEach(({ name, mount, router }) => {
    console.log(`[${name}]`);
    (router.routes || []).forEach(({ method, path: p, label }) => {
      const full = (mount === '/' ? '' : mount) + (p === '/' && mount !== '/' ? '' : p);
      console.log(`  ${method.padEnd(6)} ${base}${full || '/'} — ${label}`);
    });
  });
  console.log('');
});
