const express = require('express');
const { REGIONS, DEFAULT_REGION, isValidRegionCode } = require('../config/regions');

function createPageRoutes() {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.render('public/index', { regionCode: DEFAULT_REGION, regions: REGIONS });
  });

  router.get('/:regionCode', (req, res, next) => {
    const { regionCode } = req.params;
    if (!isValidRegionCode(regionCode)) {
      return next();
    }
    res.render('public/index', { regionCode, regions: REGIONS });
  });

  router.routes = [
    { method: 'GET', path: '/', label: 'The map page, default region' },
    { method: 'GET', path: '/:regionCode', label: 'The map page for a region' },
  ];

  return router;
}

module.exports = {
  createPageRoutes,
};
