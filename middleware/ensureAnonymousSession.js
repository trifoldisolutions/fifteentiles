const mongoose = require('mongoose');
const User = require('../models/User');

function createEnsureAnonymousSession({ config, sessionService }) {
  return async function ensureAnonymousSession(req, res, next) {
    const cookies = sessionService.parseCookies(req.headers.cookie);
    let anonymousId = cookies[config.ANON_USER_COOKIE];
    const authSessionToken = cookies[config.AUTH_USER_COOKIE];

    if (!anonymousId) {
      anonymousId = crypto.randomUUID();
      res.append('Set-Cookie', sessionService.createAnonSessionCookie(anonymousId));
    }

    req.anonymousId = anonymousId;
    req.anonSession = null;
    req.authUser = null;
    req.sessionUser = null;

    if (mongoose.connection.readyState !== 1) {
      return next();
    }

    try {
      if (authSessionToken) {
        const authenticatedUser = await User.findOne({
          type: 'account',
          sessionTokenHash: sessionService.hashSessionToken(authSessionToken),
          sessionExpiresAt: { $gt: new Date() },
        });

        if (authenticatedUser) {
          req.authUser = authenticatedUser;
          req.sessionUser = authenticatedUser;
          res.append('Set-Cookie', sessionService.createAuthSessionCookie(authSessionToken));
        } else {
          res.append('Set-Cookie', sessionService.clearCookie(config.AUTH_USER_COOKIE));
        }
      }

      if (req.authUser) {
        return next();
      }

      req.anonSession = await User.findOneAndUpdate(
        { anonymousId, type: 'anon' },
        {
          $set: {
            type: 'anon',
            anonymousId,
            lastActiveAt: new Date(),
          },
        },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true,
        }
      ).lean();

      req.sessionUser = req.anonSession;
      res.append('Set-Cookie', sessionService.createAnonSessionCookie(anonymousId));
    } catch (error) {
      console.error('Anonymous session setup failed:', error.message);
    }

    next();
  };
}

const crypto = require('crypto');

module.exports = {
  createEnsureAnonymousSession,
};
