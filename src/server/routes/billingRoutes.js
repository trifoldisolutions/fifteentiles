const express = require('express');
const mongoose = require('mongoose');
const User = require('../../../models/User');

function createBillingRoutes({ config, stripe, billingService, authService }) {
  const router = express.Router();

  router.post('/api/billing/top-up-session', async (req, res) => {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe is not configured right now.' });
    }

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Billing is unavailable right now.' });
    }

    if (!req.authUser) {
      return res.status(401).json({ error: 'Please sign in before topping up your balance.' });
    }

    const requestedTtkAmount = billingService.parseTopUpAmountTtk(req.body?.ttkAmount);
    if (requestedTtkAmount === null) {
      return res.status(400).json({ error: 'A valid TTK amount is required.' });
    }

    if (requestedTtkAmount < config.MIN_TOP_UP_TTK || requestedTtkAmount > config.MAX_TOP_UP_TTK) {
      return res.status(400).json({
        error: `Top-ups must be between ${config.MIN_TOP_UP_TTK.toFixed(2)} TTK and ${config.MAX_TOP_UP_TTK.toFixed(2)} TTK.`,
      });
    }

    const ttkMinor = billingService.convertTtkToMinor(requestedTtkAmount);
    const unitAmountCents = billingService.convertTtkToUsdCents(requestedTtkAmount);
    if (unitAmountCents < config.MIN_TOP_UP_USD_CENTS || unitAmountCents > config.MAX_TOP_UP_USD_CENTS) {
      return res.status(400).json({ error: 'That amount is outside the allowed $8 to $500 top-up range.' });
    }

    try {
      const customerId = await billingService.getOrCreateStripeCustomer(req.authUser);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer: customerId,
        success_url: `${config.APP_URL}/?topup=success`,
        cancel_url: `${config.APP_URL}/?topup=cancelled`,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: unitAmountCents,
              product_data: {
                name: '15Tiles wallet top-up',
                description: `${requestedTtkAmount.toFixed(2)} TTK added to your wallet after payment confirmation.`,
              },
            },
          },
        ],
        metadata: {
          purpose: 'wallet_top_up',
          userId: String(req.authUser._id),
          ttkMinor: String(ttkMinor),
          ttkAmount: requestedTtkAmount.toFixed(2),
        },
        payment_intent_data: {
          metadata: {
            purpose: 'wallet_top_up',
            userId: String(req.authUser._id),
            ttkMinor: String(ttkMinor),
            ttkAmount: requestedTtkAmount.toFixed(2),
          },
        },
      });

      if (!session.url) {
        throw new Error('Stripe did not return a checkout URL.');
      }

      return res.json({
        ok: true,
        url: session.url,
        amount: {
          ttk: requestedTtkAmount,
          usd: unitAmountCents / 100,
        },
      });
    } catch (error) {
      console.error('Unable to create Stripe checkout session:', error.message);
      return res.status(500).json({ error: 'Unable to start checkout right now.' });
    }
  });

  router.post('/api/billing/reconcile', async (req, res) => {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe is not configured right now.' });
    }

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Billing is unavailable right now.' });
    }

    if (!req.authUser) {
      return res.status(401).json({ error: 'Please sign in before syncing billing state.' });
    }

    try {
      const reconciliation = await billingService.reconcileUserStripeTopUps(req.authUser);
      const refreshedUser = await User.findById(req.authUser._id);

      return res.json({
        ok: true,
        appliedCount: reconciliation.appliedCount,
        user: authService.sanitizeUser(refreshedUser),
      });
    } catch (error) {
      console.error('Unable to reconcile Stripe top-ups:', error.message);
      return res.status(500).json({ error: 'Unable to sync completed top-ups right now.' });
    }
  });

  return router;
}

module.exports = {
  createBillingRoutes,
};
