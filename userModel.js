import mongoose from 'mongoose';

const { Schema, model } = mongoose;
mongoose.set('strictQuery', true);

const userSchema = new Schema({
  username: { type: String, required: true, trim: true, unique: true },
  password: { type: String, required: true, select: false },
  aType: { type: String, enum: ['patron', 'artist'], default: 'patron' },
  // Retain existing embedded records so old databases need no migration.
  following: { type: [Schema.Types.Mixed], default: [] },
  like: { type: [Schema.Types.Mixed], default: [] },
  reviews: { type: [Schema.Types.Mixed], default: [] },
  workshops: { type: [Schema.Types.Mixed], default: [] },
});

export default model('user', userSchema);
