const express = require('express');

function createWebhookRoutes({ stripe, stripeWebhookSecret, fulfillWalletTopUpSession }) {
  const router = express.Router();

  router.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe || !stripeWebhookSecret) {
      return res.status(503).send('Stripe webhook is not configured.');
    }

    const signature = req.headers['stripe-signature'];
    if (!signature) {
      return res.status(400).send('Missing Stripe signature.');
    }

    try {
      const event = stripe.webhooks.constructEvent(req.body, signature, stripeWebhookSecret);

      if (event.type === 'checkout.session.completed') {
        await fulfillWalletTopUpSession(event.data.object);
      }

      return res.json({ received: true });
    } catch (error) {
      console.error('Stripe webhook failed:', error.message);
      return res.status(400).send(`Webhook error: ${error.message}`);
    }
  });

  return router;
}

module.exports = {
  createWebhookRoutes,
};
