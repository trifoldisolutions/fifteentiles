const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Map = require('../../../models/Map');
const defaultMaps = require('../../../data/defaultMaps');
const { isValidRegionCode } = require('../../shared/regions');

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

  router.get('/api/maps', async (req, res) => {
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

  router.post('/api/maps/:mapId/claims', async (req, res) => {
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

  router.post('/api/maps/:mapId/claims/:claimId/drop', async (req, res) => {
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

module.exports = {
  createMapRoutes,
};
