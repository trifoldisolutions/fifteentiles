const Stripe = require('stripe');

const PORT = process.env.PORT || 3003;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fifteenTiles';
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const ANON_USER_COOKIE = 'ft_anon_session';
const AUTH_USER_COOKIE = 'ft_auth_session';
const ANON_SESSION_TTL_MS = 60 * 60 * 1000;
const AUTH_SESSION_TTL_MS = 60 * 60 * 24 * 30 * 1000;
const TTK_MINOR_SCALE = 100;
const TTK_USD_RATE = 2.25;
const MIN_TOP_UP_USD_CENTS = 800;
const MAX_TOP_UP_USD_CENTS = 50000;
const MIN_TOP_UP_TTK = Number((MIN_TOP_UP_USD_CENTS / 100 / TTK_USD_RATE).toFixed(2));
const MAX_TOP_UP_TTK = Number((MAX_TOP_UP_USD_CENTS / 100 / TTK_USD_RATE).toFixed(2));
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_REQUIREMENTS = {
  uppercases: 3,
  lowercases: 3,
  digits: 3,
  specials: 3,
};
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

module.exports = {
  PORT,
  MONGODB_URI,
  APP_URL,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  ANON_USER_COOKIE,
  AUTH_USER_COOKIE,
  ANON_SESSION_TTL_MS,
  AUTH_SESSION_TTL_MS,
  TTK_MINOR_SCALE,
  TTK_USD_RATE,
  MIN_TOP_UP_USD_CENTS,
  MAX_TOP_UP_USD_CENTS,
  MIN_TOP_UP_TTK,
  MAX_TOP_UP_TTK,
  PASSWORD_MIN_LENGTH,
  PASSWORD_REQUIREMENTS,
  stripe,
};
