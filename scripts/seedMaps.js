require('dotenv').config();
const mongoose = require('mongoose');
const Map = require('../models/Map');
const defaultMaps = require('../config/defaultMaps');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fifteenTiles';

async function seedMaps() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log(`Connected to MongoDB at ${MONGODB_URI}`);

    for (const map of defaultMaps) {
      await Map.updateOne(
        { id: map.id },
        { $set: map },
        { upsert: true }
      );
    }

    console.log(`Seeded ${defaultMaps.length} maps into fifteenTiles.maps`);
  } catch (error) {
    console.error('Failed to seed maps:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

seedMaps();
