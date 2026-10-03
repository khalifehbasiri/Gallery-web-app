import { createHash } from 'node:crypto';
import type {
  Artist,
  Artwork,
  ArtworkSummary,
  Review,
  User as UserDto,
  Workshop,
} from '../../shared/contracts.js';
import type {
  EmbeddedReview,
  EmbeddedWorkshop,
  GalleryDocument,
  UserDocument,
} from './models.js';

export const publicUser = (user: UserDocument): UserDto => ({
  id: user._id.toString(),
  username: user.username,
  role: user.aType,
});
export const reviewId = (review: EmbeddedReview) =>
  review.reviewId ||
  `legacy-${createHash('sha256').update(`${review.userId}:${review.review}`).digest('hex').slice(0, 32)}`;
export const workshopId = (workshop: EmbeddedWorkshop) =>
  workshop.workshopId ||
  `legacy-${createHash('sha256').update(`${workshop.user}:${workshop.name}`).digest('hex').slice(0, 32)}`;
export function publicReview(
  review: EmbeddedReview,
  currentUser?: UserDocument,
): Review {
  return {
    id: reviewId(review),
    author: review.user,
    authorId: String(review.userId),
    text: review.review,
    owned: review.user === currentUser?.username,
  };
}
export function artworkSummary(
  art: GalleryDocument,
  user?: UserDocument,
): ArtworkSummary {
  return {
    id: art._id.toString(),
    title: art.name,
    artist: art.artist,
    year: art.year,
    category: art.category,
    medium: art.medium,
    description: art.description.slice(0, 300),
    imageUrl: art.image,
    likeCount: art.numLikes.length,
    reviewCount: art.reviews.length,
    liked:
      user?.like.some((like) => String(like._id) === art._id.toString()) ??
      false,
  };
}
export function publicArtwork(
  art: GalleryDocument,
  user?: UserDocument,
): Artwork {
  return {
    ...artworkSummary(art, user),
    description: art.description,
    reviews: art.reviews.map((review) => publicReview(review, user)),
  };
}
export function publicWorkshop(
  workshop: EmbeddedWorkshop,
  artist: Pick<UserDocument, '_id' | 'username'>,
  user?: UserDocument,
): Workshop {
  return {
    id: workshopId(workshop),
    artistId: artist._id.toString(),
    artist: artist.username,
    name: workshop.name,
    goal: workshop.goal,
    weeks: Number(workshop.duration),
    attendeeCount: (workshop.signed || []).length,
    joined: (workshop.signed || []).some(
      (attendee) => attendee.name === user?.username,
    ),
  };
}
export function publicArtist(
  artist: UserDocument,
  artworks: GalleryDocument[],
  user?: UserDocument,
): Artist {
  return {
    ...publicUser(artist),
    following:
      user?.following.some((person) => person.username === artist.username) ??
      false,
    artworks: artworks.map((art) => artworkSummary(art, user)),
    workshops: artist.workshops.map((workshop) =>
      publicWorkshop(workshop, artist, user),
    ),
  };
}
