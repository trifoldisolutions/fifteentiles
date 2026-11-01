const crypto = require('crypto');

function createSessionService(config) {
  function parseCookies(cookieHeader = '') {
    return cookieHeader
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .reduce((cookies, part) => {
        const separatorIndex = part.indexOf('=');
        if (separatorIndex === -1) {
          return cookies;
        }

        const key = part.slice(0, separatorIndex).trim();
        const value = part.slice(separatorIndex + 1).trim();
        cookies[key] = decodeURIComponent(value);
        return cookies;
      }, {});
  }

  function createAnonSessionCookie(anonymousId) {
    return [
      `${config.ANON_USER_COOKIE}=${encodeURIComponent(anonymousId)}`,
      'Path=/',
      `Max-Age=${config.ANON_SESSION_TTL_MS / 1000}`,
      'HttpOnly',
      'SameSite=Lax',
    ].join('; ');
  }

  function createAuthSessionCookie(sessionToken) {
    return [
      `${config.AUTH_USER_COOKIE}=${encodeURIComponent(sessionToken)}`,
      'Path=/',
      `Max-Age=${config.AUTH_SESSION_TTL_MS / 1000}`,
      'HttpOnly',
      'SameSite=Lax',
    ].join('; ');
  }

  function clearCookie(cookieName) {
    return [
      `${cookieName}=`,
      'Path=/',
      'Max-Age=0',
      'HttpOnly',
      'SameSite=Lax',
    ].join('; ');
  }

  function hashSessionToken(sessionToken) {
    return crypto.createHash('sha256').update(sessionToken).digest('hex');
  }

  function buildAccountSessionUpdate(lastMapId = null) {
    const sessionToken = crypto.randomBytes(32).toString('hex');
    return {
      sessionToken,
      update: {
        sessionTokenHash: hashSessionToken(sessionToken),
        sessionExpiresAt: new Date(Date.now() + config.AUTH_SESSION_TTL_MS),
        lastActiveAt: new Date(),
        ...(lastMapId ? { lastMapId } : {}),
      },
    };
  }

  return {
    parseCookies,
    createAnonSessionCookie,
    createAuthSessionCookie,
    clearCookie,
    hashSessionToken,
    buildAccountSessionUpdate,
  };
}

module.exports = {
  createSessionService,
};
