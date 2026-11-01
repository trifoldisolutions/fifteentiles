const mongoose = require('mongoose');

const tileSchema = new mongoose.Schema(
  {
    col: { type: Number, required: true },
    row: { type: Number, required: true },
    type: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const claimedRangeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    ownerId: { type: String, default: null, trim: true },
    ownerName: { type: String, required: true, trim: true },
    status: { type: String, enum: ['owned', 'auction'], default: 'owned' },
    previousOwnerId: { type: String, default: null, trim: true },
    previousOwnerName: { type: String, default: null, trim: true },
    droppedAt: { type: Date, default: null },
    bounds: {
      minCol: { type: Number, required: true },
      maxCol: { type: Number, required: true },
      minRow: { type: Number, required: true },
      maxRow: { type: Number, required: true },
    },
    keys: {
      type: [String],
      default: [],
    },
    metrics: {
      xCount: { type: Number, required: true },
      yCount: { type: Number, required: true },
      total: { type: Number, required: true },
    },
    zoningRings: { type: Number, default: 0, min: 0, max: 3 },
    zoningRingKeys: {
      type: [String],
      default: [],
    },
    ttkValue: { type: Number, default: 0 },
    holdersCount: { type: Number, default: 0, min: 0 },
    claimedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const regionDataSchema = new mongoose.Schema(
  {
    claimedRanges: { type: [claimedRangeSchema], default: [] },
  },
  { _id: false }
);

const mapSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    intent: { type: String, required: true, trim: true },
    accent: { type: String, required: true, trim: true },
    camera: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
      zoom: { type: Number, default: 1 },
    },
    tiles: {
      type: [tileSchema],
      default: [],
    },
    regions: {
      type: Map,
      of: regionDataSchema,
      default: {},
    },
  },
  {
    collection: 'maps',
    timestamps: true,
  }
);

module.exports = mongoose.models.Map || mongoose.model('Map', mapSchema);
