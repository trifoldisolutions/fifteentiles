function sortMapsAlphabetically(maps) {
  return [...maps].sort((left, right) => left.name.localeCompare(right.name));
}

function rankMaps(maps, lastMapId) {
  const rankedMaps = sortMapsAlphabetically(maps);

  if (!lastMapId) {
    return {
      maps: rankedMaps,
      ranking: {
        strategy: 'alphabetical',
        lastMapId: null,
      },
    };
  }

  const lastMapIndex = rankedMaps.findIndex((map) => map.id === lastMapId);
  if (lastMapIndex <= 0) {
    return {
      maps: rankedMaps,
      ranking: {
        strategy: lastMapIndex === 0 ? 'last-visited' : 'alphabetical',
        lastMapId,
      },
    };
  }

  const [lastVisitedMap] = rankedMaps.splice(lastMapIndex, 1);
  rankedMaps.unshift(lastVisitedMap);

  return {
    maps: rankedMaps,
    ranking: {
      strategy: 'last-visited',
      lastMapId,
    },
  };
}

module.exports = {
  sortMapsAlphabetically,
  rankMaps,
};
