const REGIONS = [
  { code: 'us', name: 'United States' },
  { code: 'ca', name: 'Canada' },
  { code: 'mx', name: 'Mexico' },
  { code: 'br', name: 'Brazil' },
  { code: 'ar', name: 'Argentina' },
  { code: 'gb', name: 'United Kingdom' },
  { code: 'fr', name: 'France' },
  { code: 'de', name: 'Germany' },
  { code: 'es', name: 'Spain' },
  { code: 'it', name: 'Italy' },
  { code: 'nl', name: 'Netherlands' },
  { code: 'se', name: 'Sweden' },
  { code: 'pl', name: 'Poland' },
  { code: 'au', name: 'Australia' },
  { code: 'in', name: 'India' },
  { code: 'jp', name: 'Japan' },
  { code: 'kr', name: 'South Korea' },
  { code: 'sg', name: 'Singapore' },
  { code: 'ng', name: 'Nigeria' },
  { code: 'za', name: 'South Africa' },
];

const DEFAULT_REGION = 'us';

const REGION_CODES = new Set(REGIONS.map((r) => r.code));

function isValidRegionCode(code) {
  return REGION_CODES.has(code);
}

module.exports = { REGIONS, DEFAULT_REGION, REGION_CODES, isValidRegionCode };
