const mongoose = require('mongoose');
const Map = require('../../models/Map');

async function connectToDatabase(mongoUri) {
  try {
    await mongoose.connect(mongoUri);
    console.log(`Connected to MongoDB at ${mongoUri}`);
    const mapCount = await Map.countDocuments();
    console.log(`Loaded ${mapCount} map records from fifteenTiles.maps`);
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
  }
}

module.exports = {
  connectToDatabase,
};
