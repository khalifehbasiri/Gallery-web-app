import mongoose, { Schema, type HydratedDocument, type Types } from 'mongoose';
import type { AccountRole } from '../../shared/contracts.js';

export interface EmbeddedReview {
  reviewId?: string;
  user: string;
  userId: Types.ObjectId | string;
  review: string;
}
export interface EmbeddedWorkshop {
  workshopId?: string;
  name: string;
  goal: string;
  duration: string;
  user: string;
  signed: { name: string }[];
}
export interface UserRecord {
  username: string;
  password: string;
  aType: AccountRole;
  following: { _id: Types.ObjectId; username: string; aType: AccountRole }[];
  like: { _id: Types.ObjectId; name: string }[];
  reviews: {
    reviewId?: string;
    art: string;
    artId: Types.ObjectId | string;
    review: string;
  }[];
  workshops: EmbeddedWorkshop[];
}
export interface GalleryRecord {
  name: string;
  artist: string;
  year: string;
  category: string;
  medium: string;
  description: string;
  image: string;
  reviews: EmbeddedReview[];
  numLikes: string[];
}
export type UserDocument = HydratedDocument<UserRecord>;
export type GalleryDocument = HydratedDocument<GalleryRecord>;

mongoose.set('strictQuery', true);
const userSchema = new Schema({
  username: { type: String, required: true, trim: true, unique: true },
  password: { type: String, required: true, select: false },
  aType: {
    type: String,
    enum: ['patron', 'artist'],
    default: 'patron',
    index: true,
  },
  // Preserve legacy embedded data. REST serializers expose only documented fields.
  following: { type: [Schema.Types.Mixed], default: [] },
  like: { type: [Schema.Types.Mixed], default: [] },
  reviews: { type: [Schema.Types.Mixed], default: [] },
  workshops: { type: [Schema.Types.Mixed], default: [] },
});
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
gallerySchema.index(
  { name: 'text', artist: 'text', description: 'text' },
  { name: 'artwork_search', weights: { name: 5, artist: 3, description: 1 } },
);
gallerySchema.index({ category: 1, _id: -1 });
gallerySchema.index({ artist: 1, _id: -1 });

export const User = mongoose.model<UserRecord>('user', userSchema);
export const Gallery = mongoose.model<GalleryRecord>(
  'galleries',
  gallerySchema,
);
export const AuthSession = mongoose.model(
  'auth_session',
  new Schema({
    sessionId: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    expiresAt: { type: Date, required: true, expires: 0 },
  }),
);
