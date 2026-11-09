const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Map = require('../models/Map');
const User = require('../models/User');
const defaultMaps = require('../config/defaultMaps');
const { isValidRegionCode } = require('../config/regions');

// Everything under /api (mounted in server.js) except the Stripe webhook, which has its
// own file (routes/webhooks.js). Each section below keeps its own router, mounted in
// order at the end of this file.

// =============================================================================
// Maps: /api/maps
// =============================================================================

function normalizeInteger(value) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) ? numberValue : null;
}

function tileKey(col, row) {
  return `${col},${row}`;
}

function getKeysFromBounds(bounds) {
  const keys = [];
  for (let row = bounds.minRow; row <= bounds.maxRow; row += 1) {
    for (let col = bounds.minCol; col <= bounds.maxCol; col += 1) {
      keys.push(tileKey(col, row));
    }
  }
  return keys;
}

function getRingKeysForBounds(bounds, ringIndex) {
  if (!bounds || ringIndex < 1) {
    return [];
  }

  const outerBounds = {
    minCol: bounds.minCol - ringIndex,
    maxCol: bounds.maxCol + ringIndex,
    minRow: bounds.minRow - ringIndex,
    maxRow: bounds.maxRow + ringIndex,
  };
  const innerBounds = {
    minCol: bounds.minCol - ringIndex + 1,
    maxCol: bounds.maxCol + ringIndex - 1,
    minRow: bounds.minRow - ringIndex + 1,
    maxRow: bounds.maxRow + ringIndex - 1,
  };
  const ringKeys = [];

  for (let row = outerBounds.minRow; row <= outerBounds.maxRow; row += 1) {
    for (let col = outerBounds.minCol; col <= outerBounds.maxCol; col += 1) {
      const isInsideInnerBounds = row >= innerBounds.minRow
        && row <= innerBounds.maxRow
        && col >= innerBounds.minCol
        && col <= innerBounds.maxCol;

      if (!isInsideInnerBounds) {
        ringKeys.push(tileKey(col, row));
      }
    }
  }

  return ringKeys;
}

function getClaimOwnedKeys(claim) {
  const owned = new Set(Array.isArray(claim?.keys) ? claim.keys : []);
  const ringKeys = Array.isArray(claim?.zoningRingKeys) ? claim.zoningRingKeys : [];
  if (ringKeys.length > 0) {
    for (const key of ringKeys) {
      owned.add(key);
    }
    return owned;
  }

  const bounds = claim?.bounds || null;
  const zoningRings = Math.max(0, Math.min(3, normalizeInteger(claim?.zoningRings) ?? 0));
  if (!bounds || zoningRings <= 0) {
    return owned;
  }

  for (let ringIndex = 1; ringIndex <= zoningRings; ringIndex += 1) {
    const fallbackRingKeys = getRingKeysForBounds(bounds, ringIndex);
    for (const key of fallbackRingKeys) {
      owned.add(key);
    }
  }

  return owned;
}

function claimIsAuction(claim) {
  return claim?.status === 'auction';
}

function getOccupiedTileKeys(existingClaims) {
  const occupied = new Set();
  for (const claim of existingClaims || []) {
    const ownedKeys = getClaimOwnedKeys(claim);
    for (const key of ownedKeys) {
      occupied.add(key);
    }
  }
  return occupied;
}

function normalizeClaimPayload(body, user, existingClaims) {
  const rawBounds = body?.bounds || {};
  const minCol = normalizeInteger(rawBounds.minCol);
  const maxCol = normalizeInteger(rawBounds.maxCol);
  const minRow = normalizeInteger(rawBounds.minRow);
  const maxRow = normalizeInteger(rawBounds.maxRow);

  if ([minCol, maxCol, minRow, maxRow].some((value) => value === null)) {
    return { ok: false, error: 'Claim bounds are invalid.' };
  }

  if (minCol > maxCol || minRow > maxRow) {
    return { ok: false, error: 'Claim bounds are invalid.' };
  }

  const xCount = maxCol - minCol + 1;
  const yCount = maxRow - minRow + 1;
  const total = xCount * yCount;
  if (xCount > 10 || yCount > 10 || total > 100) {
    return { ok: false, error: 'Claim ranges can be at most 10 x 10 tiles.' };
  }

  const bounds = { minCol, maxCol, minRow, maxRow };
  const keys = getKeysFromBounds(bounds);
  const occupiedKeys = getOccupiedTileKeys(existingClaims);
  const overlappingBaseKey = keys.find((key) => occupiedKeys.has(key));
  if (overlappingBaseKey) {
    return { ok: false, error: 'Selected range overlaps tiles already claimed by an earlier range.' };
  }

  const zoningRings = Math.max(0, Math.min(3, normalizeInteger(body?.zoningRings) ?? 0));
  const trimmedRingKeys = [];
  for (let ringIndex = 1; ringIndex <= zoningRings; ringIndex += 1) {
    const ringKeys = getRingKeysForBounds(bounds, ringIndex);
    for (const key of ringKeys) {
      if (!occupiedKeys.has(key)) {
        trimmedRingKeys.push(key);
      }
    }
  }

  if (zoningRings > 0 && trimmedRingKeys.length === 0) {
    return { ok: false, error: 'All zoning ring tiles are already claimed by earlier ranges.' };
  }

  const ttkValue = Number.isFinite(Number(body?.ttkValue)) ? Number(body.ttkValue) : 0;
  const ownerName = user?.displayName || user?.email || 'Anonymous user';
  const ownerId = user?._id ? String(user._id) : null;

  return {
    ok: true,
    claim: {
      id: crypto.randomUUID(),
      ownerId,
      ownerName,
      status: 'owned',
      previousOwnerId: null,
      previousOwnerName: null,
      droppedAt: null,
      bounds,
      keys,
      metrics: { xCount, yCount, total },
      zoningRings,
      zoningRingKeys: trimmedRingKeys,
      ttkValue,
      holdersCount: 0,
      claimedAt: new Date(),
    },
  };
}

function createMapRoutes({ rankMaps, config, authService, User }) {
  const router = express.Router();

  function flattenMapForRegion(map, regionCode) {
    const regionData = map.regions?.[regionCode] || null;
    return {
      id: map.id,
      name: map.name,
      intent: map.intent,
      accent: map.accent,
      camera: map.camera,
      tiles: map.tiles || [],
      claimedRanges: regionData?.claimedRanges || [],
    };
  }

  router.get('/maps', async (req, res) => {
    const regionCode = typeof req.query.region === 'string' ? req.query.region.trim().toLowerCase() : 'us';
    const lastMapId = req.sessionUser?.lastMapId || null;

    try {
      if (mongoose.connection.readyState !== 1) {
        return res.json(rankMaps(defaultMaps.map((m) => ({ ...m, claimedRanges: [] })), lastMapId));
      }

      const maps = await Map.find({}, { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 }).lean();
      return res.json(rankMaps(maps.map((m) => flattenMapForRegion(m, regionCode)), lastMapId));
    } catch (error) {
      return res.json(rankMaps(defaultMaps.map((m) => ({ ...m, claimedRanges: [] })), lastMapId));
    }
  });

  router.post('/maps/:mapId/claims', async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Claim persistence is unavailable right now.' });
    }
    if (!req.authUser || req.authUser.type !== 'account') {
      return res.status(401).json({ error: 'Please sign in before claiming a range.' });
    }

    const regionCode = typeof req.body?.region === 'string' ? req.body.region.trim().toLowerCase() : 'us';
    if (!isValidRegionCode(regionCode)) {
      return res.status(400).json({ error: 'Invalid region.' });
    }

    try {
      const map = await Map.findOne({ id: req.params.mapId });
      if (!map) {
        return res.status(404).json({ error: 'Map not found.' });
      }

      const existingClaims = map.regions.has(regionCode)
        ? map.regions.get(regionCode).claimedRanges
        : [];

      const validation = normalizeClaimPayload(req.body, req.authUser, existingClaims);
      if (!validation.ok) {
        return res.status(409).json({ error: validation.error });
      }

      const claimTtkMinor = Math.round(Number(validation.claim.ttkValue || 0) * config.TTK_MINOR_SCALE);
      if (!Number.isInteger(claimTtkMinor) || claimTtkMinor <= 0) {
        return res.status(400).json({ error: 'Claim value is invalid.' });
      }

      const walletDebit = await User.findOneAndUpdate(
        {
          _id: req.authUser._id,
          type: 'account',
          walletBalanceTtkMinor: { $gte: claimTtkMinor },
        },
        {
          $inc: { walletBalanceTtkMinor: -claimTtkMinor },
          $set: { lastActiveAt: new Date() },
        },
        { new: true }
      );
      if (!walletDebit) {
        return res.status(402).json({ error: 'Insufficient wallet balance for this claim.' });
      }

      if (!map.regions.has(regionCode)) {
        map.regions.set(regionCode, { claimedRanges: [] });
      }
      map.regions.get(regionCode).claimedRanges.push(validation.claim);
      map.markModified('regions');

      try {
        await map.save();
      } catch (saveError) {
        await User.updateOne(
          { _id: req.authUser._id, type: 'account' },
          { $inc: { walletBalanceTtkMinor: claimTtkMinor }, $set: { lastActiveAt: new Date() } }
        );
        throw saveError;
      }

      const regionClaims = map.regions.get(regionCode).claimedRanges;
      const savedClaim = regionClaims[regionClaims.length - 1];
      const savedClaimObj = savedClaim.toObject ? savedClaim.toObject() : savedClaim;

      return res.status(201).json({
        ok: true,
        claim: savedClaimObj,
        user: authService.sanitizeUser(walletDebit),
      });
    } catch (error) {
      console.error('Claim range failed:', error.message);
      return res.status(500).json({ error: 'Unable to claim range right now.' });
    }
  });

  router.post('/maps/:mapId/claims/:claimId/drop', async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Drop persistence is unavailable right now.' });
    }
    if (!req.authUser || req.authUser.type !== 'account') {
      return res.status(401).json({ error: 'Please sign in before dropping a range.' });
    }

    try {
      const map = await Map.findOne({ id: req.params.mapId });
      if (!map) {
        return res.status(404).json({ error: 'Map not found.' });
      }

      let claim = null;
      for (const [, regionData] of map.regions) {
        const found = (regionData.claimedRanges || []).find((entry) => entry.id === req.params.claimId);
        if (found) {
          claim = found;
          break;
        }
      }

      if (!claim) {
        return res.status(404).json({ error: 'Claim not found.' });
      }
      if (claimIsAuction(claim)) {
        return res.status(409).json({ error: 'This range is already queued for auction.' });
      }

      const authUserId = String(req.authUser._id);
      if (!claim.ownerId || String(claim.ownerId) !== authUserId) {
        return res.status(403).json({ error: 'Only the current owner can drop this range.' });
      }

      claim.previousOwnerId = claim.ownerId || null;
      claim.previousOwnerName = claim.ownerName || null;
      claim.ownerId = null;
      claim.ownerName = 'Auction queue';
      claim.status = 'auction';
      claim.droppedAt = new Date();
      map.markModified('regions');

      await map.save();

      const droppedClaim = claim.toObject ? claim.toObject() : claim;
      const refreshedUser = await User.findById(req.authUser._id).lean();

      return res.status(200).json({
        ok: true,
        claim: droppedClaim,
        user: authService.sanitizeUser(refreshedUser || req.authUser),
      });
    } catch (error) {
      console.error('Drop range failed:', error.message);
      return res.status(500).json({ error: 'Unable to drop range right now.' });
    }
  });

  return router;
}

// =============================================================================
// Auth: /api/auth
// =============================================================================

function createAuthRoutes({ authService, sessionService, config }) {
  const router = express.Router();

  router.get('/auth/session', async (req, res) => {
    if (req.authUser) {
      return res.json({
        authenticated: true,
        user: authService.sanitizeUser(req.authUser),
      });
    }

    return res.json({
      authenticated: false,
      user: {
        name: 'Anonymous user',
        lastMapId: req.anonSession?.lastMapId || null,
      },
    });
  });

  router.post('/auth/register', async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Authentication is unavailable right now.' });
    }

    const validation = authService.validateCredentials({
      email: req.body?.email,
      password: req.body?.password,
      displayName: req.body?.displayName,
      region: req.body?.region,
      requireDisplayName: true,
    });

    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    try {
      const existingUser = await User.findOne({ email: validation.email, type: 'account' }).lean();
      if (existingUser) {
        return res.status(409).json({ error: 'An account with that email already exists.' });
      }

      const passwordHash = await authService.hashPassword(req.body.password);
      const { sessionToken, update } = sessionService.buildAccountSessionUpdate(req.anonSession?.lastMapId || null);
      const account = await User.create({
        type: 'account',
        email: validation.email,
        displayName: validation.displayName,
        homeRegion: validation.region,
        passwordHash,
        ...update,
      });

      if (req.anonymousId) {
        await User.deleteOne({ anonymousId: req.anonymousId, type: 'anon' });
      }

      res.append('Set-Cookie', sessionService.createAuthSessionCookie(sessionToken));
      return res.json({
        ok: true,
        user: authService.sanitizeUser(account),
      });
    } catch (error) {
      console.error('Registration failed:', error.message);
      return res.status(500).json({ error: 'Unable to create account right now.' });
    }
  });

  router.post('/auth/login', async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Authentication is unavailable right now.' });
    }

    const validation = authService.validateCredentials({
      email: req.body?.email,
      password: req.body?.password,
    });

    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    try {
      const account = await User.findOne({ email: validation.email, type: 'account' });
      if (!account || !(await authService.verifyPassword(req.body.password, account.passwordHash))) {
        return res.status(401).json({ error: 'Incorrect email or password.' });
      }

      const { sessionToken, update } = sessionService.buildAccountSessionUpdate(req.anonSession?.lastMapId || null);
      if (req.anonSession?.lastMapId) {
        account.lastMapId = req.anonSession.lastMapId;
      }
      account.sessionTokenHash = update.sessionTokenHash;
      account.sessionExpiresAt = update.sessionExpiresAt;
      account.lastActiveAt = update.lastActiveAt;
      await account.save();

      if (req.anonymousId) {
        await User.deleteOne({ anonymousId: req.anonymousId, type: 'anon' });
      }

      res.append('Set-Cookie', sessionService.createAuthSessionCookie(sessionToken));
      return res.json({
        ok: true,
        user: authService.sanitizeUser(account),
      });
    } catch (error) {
      console.error('Login failed:', error.message);
      return res.status(500).json({ error: 'Unable to sign in right now.' });
    }
  });

  router.post('/auth/logout', async (req, res) => {
    res.append('Set-Cookie', sessionService.clearCookie(config.AUTH_USER_COOKIE));

    if (mongoose.connection.readyState !== 1 || !req.authUser) {
      return res.json({ ok: true });
    }

    try {
      await User.updateOne(
        { _id: req.authUser._id },
        {
          $set: {
            sessionExpiresAt: null,
            lastActiveAt: new Date(),
          },
          $unset: {
            sessionTokenHash: 1,
          },
        }
      );

      return res.json({ ok: true });
    } catch (error) {
      console.error('Logout failed:', error.message);
      return res.status(500).json({ error: 'Unable to sign out right now.' });
    }
  });

  return router;
}

// =============================================================================
// Billing: /api/billing
// =============================================================================

function createBillingRoutes({ config, stripe, billingService, authService }) {
  const router = express.Router();

  router.post('/billing/top-up-session', async (req, res) => {
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

  router.post('/billing/reconcile', async (req, res) => {
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

// =============================================================================
// Session: /api/session
// =============================================================================

function createSessionRoutes() {
  const router = express.Router();

  router.post('/session/map-visit', async (req, res) => {
    const { mapId } = req.body || {};

    if (!mapId) {
      return res.status(400).json({ error: 'mapId is required' });
    }

    if (mongoose.connection.readyState !== 1) {
      return res.status(202).json({
        ok: true,
        persisted: false,
        reason: 'database-unavailable',
      });
    }

    try {
      if (req.authUser) {
        await User.updateOne(
          { _id: req.authUser._id, type: 'account' },
          {
            $set: {
              lastMapId: mapId,
              lastActiveAt: new Date(),
            },
          }
        );
      } else {
        await User.updateOne(
          { anonymousId: req.anonymousId, type: 'anon' },
          {
            $set: {
              type: 'anon',
              anonymousId: req.anonymousId,
              lastMapId: mapId,
              lastActiveAt: new Date(),
            },
          },
          {
            upsert: true,
            setDefaultsOnInsert: true,
          }
        );
      }

      return res.json({ ok: true, persisted: true });
    } catch (error) {
      return res.status(500).json({ error: 'Unable to persist map visit' });
    }
  });

  return router;
}

function createApiRoutes({ rankMaps, config, stripe, authService, sessionService, billingService }) {
  const router = express.Router();

  router.use(createMapRoutes({ rankMaps, config, authService, User }));
  router.use(createAuthRoutes({ authService, sessionService, config }));
  router.use(createBillingRoutes({ config, stripe, billingService, authService }));
  router.use(createSessionRoutes());

  router.routes = [
    { method: 'GET', path: '/maps', label: 'Maps for a region, last visited first' },
    { method: 'POST', path: '/maps/:mapId/claims', label: 'Claim a range, paid from the wallet' },
    { method: 'POST', path: '/maps/:mapId/claims/:claimId/drop', label: 'Drop an owned range to the auction queue' },
    { method: 'GET', path: '/auth/session', label: 'Who is signed in' },
    { method: 'POST', path: '/auth/register', label: 'Create an account' },
    { method: 'POST', path: '/auth/login', label: 'Sign in' },
    { method: 'POST', path: '/auth/logout', label: 'Sign out' },
    { method: 'POST', path: '/billing/top-up-session', label: 'Start a Stripe wallet top-up' },
    { method: 'POST', path: '/billing/reconcile', label: 'Credit paid top-ups the webhook missed' },
    { method: 'POST', path: '/session/map-visit', label: 'Remember the last map visited' },
  ];

  return router;
}

module.exports = {
  createApiRoutes,
};
