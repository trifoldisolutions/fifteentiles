const express = require('express');
const mongoose = require('mongoose');
const User = require('../../../models/User');

function createAuthRoutes({ authService, sessionService, config }) {
  const router = express.Router();

  router.get('/api/auth/session', async (req, res) => {
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

  router.post('/api/auth/register', async (req, res) => {
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

  router.post('/api/auth/login', async (req, res) => {
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

  router.post('/api/auth/logout', async (req, res) => {
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

module.exports = {
  createAuthRoutes,
};
