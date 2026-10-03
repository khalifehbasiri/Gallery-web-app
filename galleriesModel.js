import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const gallerySchema = new Schema({
  name: { type: String, required: true, trim: true },
  artist: { type: String, required: true, trim: true },
  year: { type: String, required: true },
  category: { type: String, required: true, trim: true },
  medium: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  image: { type: String, required: true },
  reviews: { type: [Schema.Types.Mixed], default: [] },
  numLikes: { type: [String], default: [] },
});

export default model('galleries', gallerySchema);
