function createBillingService({ config, stripe, User }) {
  function parseTopUpAmountTtk(value) {
    const normalized = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
    if (!Number.isFinite(normalized)) {
      return null;
    }

    const ttkMinor = Math.round(normalized * config.TTK_MINOR_SCALE);
    if (ttkMinor <= 0) {
      return null;
    }

    return ttkMinor / config.TTK_MINOR_SCALE;
  }

  function convertTtkToMinor(ttkAmount) {
    return Math.round(ttkAmount * config.TTK_MINOR_SCALE);
  }

  function convertTtkToUsdCents(ttkAmount) {
    return Math.round(ttkAmount * config.TTK_USD_RATE * 100);
  }

  async function getOrCreateStripeCustomer(user) {
    if (!stripe) {
      throw new Error('Stripe is not configured.');
    }

    if (user.stripeCustomerId) {
      return user.stripeCustomerId;
    }

    const customer = await stripe.customers.create({
      email: user.email,
      name: user.displayName || user.email,
      metadata: {
        userId: String(user._id),
      },
    });

    user.stripeCustomerId = customer.id;
    await user.save();
    return customer.id;
  }

  async function fulfillWalletTopUpSession(session) {
    const purpose = session?.metadata?.purpose;
    const userId = session?.metadata?.userId;
    const ttkMinor = Number(session?.metadata?.ttkMinor || 0);
    const sessionId = session?.id;
    const stripeCustomerId = typeof session?.customer === 'string' ? session.customer : null;

    if (purpose !== 'wallet_top_up' || !userId || !sessionId || !Number.isInteger(ttkMinor) || ttkMinor <= 0) {
      return false;
    }

    const update = {
      $inc: {
        walletBalanceTtkMinor: ttkMinor,
      },
      $push: {
        processedStripeCheckoutSessionIds: sessionId,
      },
      $set: {
        lastActiveAt: new Date(),
      },
    };

    if (stripeCustomerId) {
      update.$set.stripeCustomerId = stripeCustomerId;
    }

    const result = await User.updateOne(
      {
        _id: userId,
        type: 'account',
        processedStripeCheckoutSessionIds: { $ne: sessionId },
      },
      update
    );

    return result.modifiedCount > 0;
  }

  async function reconcileUserStripeTopUps(user) {
    if (!stripe || !user) {
      return { appliedCount: 0 };
    }

    const customerId = user.stripeCustomerId || await getOrCreateStripeCustomer(user);
    const sessions = await stripe.checkout.sessions.list({
      customer: customerId,
      limit: 25,
    });

    let appliedCount = 0;
    for (const session of sessions.data) {
      const isEligible = session?.payment_status === 'paid'
        && session?.status === 'complete'
        && session?.metadata?.purpose === 'wallet_top_up'
        && session?.metadata?.userId === String(user._id);

      if (!isEligible) {
        continue;
      }

      if (await fulfillWalletTopUpSession(session)) {
        appliedCount += 1;
      }
    }

    return { appliedCount };
  }

  return {
    parseTopUpAmountTtk,
    convertTtkToMinor,
    convertTtkToUsdCents,
    getOrCreateStripeCustomer,
    fulfillWalletTopUpSession,
    reconcileUserStripeTopUps,
  };
}

module.exports = {
  createBillingService,
};
