const express = require('express');
const path = require('path');
const config = require('./config');
const { createSessionService } = require('./services/session');
const { createAuthService } = require('./services/auth');
const { createBillingService } = require('./services/billing');
const { rankMaps } = require('./services/maps');
const { createEnsureAnonymousSession } = require('./middleware/ensureAnonymousSession');
const { createWebhookRoutes } = require('./routes/webhookRoutes');
const { createPageRoutes } = require('./routes/pageRoutes');
const { createMapRoutes } = require('./routes/mapRoutes');
const { createAuthRoutes } = require('./routes/authRoutes');
const { createBillingRoutes } = require('./routes/billingRoutes');
const { createSessionRoutes } = require('./routes/sessionRoutes');
const User = require('../../models/User');

function createApp() {
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
  app.set('views', path.join(__dirname, '..', '..', 'views'));

  app.use(createWebhookRoutes({
    stripe: config.stripe,
    stripeWebhookSecret: config.STRIPE_WEBHOOK_SECRET,
    fulfillWalletTopUpSession: billingService.fulfillWalletTopUpSession,
  }));

  app.use(express.json());
  app.use(createEnsureAnonymousSession({
    config,
    sessionService,
  }));
  app.use(express.static(path.join(__dirname, '..', '..', 'public'), { index: false }));

  app.use(createPageRoutes());
  app.use(createMapRoutes({ rankMaps, config, authService, User }));
  app.use(createAuthRoutes({ authService, sessionService, config }));
  app.use(createBillingRoutes({
    config,
    stripe: config.stripe,
    billingService,
    authService,
  }));
  app.use(createSessionRoutes());

  return app;
}

module.exports = {
  createApp,
};
