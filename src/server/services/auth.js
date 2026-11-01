const crypto = require('crypto');
const { promisify } = require('util');
const { isValidRegionCode, DEFAULT_REGION } = require('../../shared/regions');

const scrypt = promisify(crypto.scrypt);

function createAuthService(config) {
  function normalizeEmail(email = '') {
    return String(email).trim().toLowerCase();
  }

  function normalizeDisplayName(displayName = '') {
    return String(displayName).trim().replace(/\s+/g, ' ');
  }

  function sanitizeUser(user) {
    if (!user) {
      return null;
    }

    return {
      id: String(user._id),
      email: user.email,
      name: user.displayName || user.email,
      homeRegion: user.homeRegion || DEFAULT_REGION,
      walletBalanceTtk: Number(user.walletBalanceTtkMinor || 0) / config.TTK_MINOR_SCALE,
      lastMapId: user.lastMapId || null,
    };
  }

  function getPasswordRuleStatus(password = '') {
    const value = typeof password === 'string' ? password : '';
    const uppercaseCount = (value.match(/[A-Z]/g) || []).length;
    const lowercaseCount = (value.match(/[a-z]/g) || []).length;
    const digitCount = (value.match(/\d/g) || []).length;
    const specialCount = (value.match(/[^A-Za-z0-9]/g) || []).length;

    return {
      minLength: value.length >= config.PASSWORD_MIN_LENGTH,
      uppercases: uppercaseCount >= config.PASSWORD_REQUIREMENTS.uppercases,
      lowercases: lowercaseCount >= config.PASSWORD_REQUIREMENTS.lowercases,
      digits: digitCount >= config.PASSWORD_REQUIREMENTS.digits,
      specials: specialCount >= config.PASSWORD_REQUIREMENTS.specials,
    };
  }

  function isPasswordStrongEnough(password) {
    return Object.values(getPasswordRuleStatus(password)).every(Boolean);
  }

  function validateCredentials({ email, password, displayName, region, requireDisplayName = false }) {
    const normalizedEmail = normalizeEmail(email);
    const normalizedDisplayName = normalizeDisplayName(displayName);

    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return { ok: false, error: 'A valid email address is required.' };
    }

    if (requireDisplayName && (normalizedDisplayName.length < 2 || normalizedDisplayName.length > 40)) {
      return { ok: false, error: 'Display name must be between 2 and 40 characters.' };
    }

    if (typeof password !== 'string' || password.length < config.PASSWORD_MIN_LENGTH) {
      return { ok: false, error: `Password must be at least ${config.PASSWORD_MIN_LENGTH} characters.` };
    }

    if (requireDisplayName && !isPasswordStrongEnough(password)) {
      return {
        ok: false,
        error: 'Password must include at least 3 uppercase letters, 3 lowercase letters, 3 digits, and 3 special characters.',
      };
    }

    const normalizedRegion = typeof region === 'string' ? region.trim().toLowerCase() : '';
    if (requireDisplayName) {
      if (!normalizedRegion || !isValidRegionCode(normalizedRegion)) {
        return { ok: false, error: 'Please select a valid region.' };
      }
    }

    return {
      ok: true,
      email: normalizedEmail,
      displayName: normalizedDisplayName,
      region: normalizedRegion || DEFAULT_REGION,
    };
  }

  async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = await scrypt(password, salt, 64);
    return `${salt}:${derivedKey.toString('hex')}`;
  }

  async function verifyPassword(password, storedHash) {
    if (!storedHash || !storedHash.includes(':')) {
      return false;
    }

    const [salt, expectedHash] = storedHash.split(':');
    const derivedKey = await scrypt(password, salt, 64);
    const expectedBuffer = Buffer.from(expectedHash, 'hex');

    if (derivedKey.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(derivedKey, expectedBuffer);
  }

  return {
    sanitizeUser,
    getPasswordRuleStatus,
    isPasswordStrongEnough,
    validateCredentials,
    hashPassword,
    verifyPassword,
  };
}

module.exports = {
  createAuthService,
};
