const express = require('express');
const { REGIONS, DEFAULT_REGION, isValidRegionCode } = require('../../shared/regions');

function createPageRoutes() {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.render('index', { regionCode: DEFAULT_REGION, regions: REGIONS });
  });

  router.get('/:regionCode', (req, res, next) => {
    const { regionCode } = req.params;
    if (!isValidRegionCode(regionCode)) {
      return next();
    }
    res.render('index', { regionCode, regions: REGIONS });
  });

  return router;
}

module.exports = {
  createPageRoutes,
};
