const express = require('express');
const mongoose = require('mongoose');
const User = require('../../../models/User');

function createSessionRoutes() {
  const router = express.Router();

  router.post('/api/session/map-visit', async (req, res) => {
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

module.exports = {
  createSessionRoutes,
};
