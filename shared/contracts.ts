export type AccountRole = 'patron' | 'artist';

export interface User {
  id: string;
  username: string;
  role: AccountRole;
}

export interface Review {
  id: string;
  author: string;
  authorId: string;
  text: string;
  owned: boolean;
}

export interface ArtworkSummary {
  id: string;
  title: string;
  artist: string;
  year: string;
  category: string;
  medium: string;
  description: string;
  imageUrl: string;
  likeCount: number;
  reviewCount: number;
  liked: boolean;
}

export interface Artwork extends ArtworkSummary {
  reviews: Review[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface GalleryQuery {
  search: string;
  category: string;
  artist: string;
  page: number;
}

export interface Workshop {
  id: string;
  artistId: string;
  artist: string;
  name: string;
  goal: string;
  weeks: number;
  attendeeCount: number;
  joined: boolean;
}

export interface Artist extends User {
  following: boolean;
  artworks: ArtworkSummary[];
  workshops: Workshop[];
}

export interface ArtworkDetail {
  artwork: Artwork;
  artist: User | null;
}

export interface Account {
  user: User;
  following: User[];
  likes: ArtworkSummary[];
  reviews: { artworkId: string; text: string }[];
  artworks: ArtworkSummary[];
  workshops: Workshop[];
}

export interface GalleryStats {
  artworks: number;
  artists: number;
  workshops: number;
  categories: string[];
}

export interface Credentials {
  username: string;
  password: string;
}
export interface AuthResponse {
  user: User | null;
}
export interface LikeResponse {
  liked: boolean;
  likeCount: number;
}
export interface ApiError {
  error: string;
}
export interface NotificationPreferences {
  available: boolean;
  publicDemo: boolean;
  email: string;
  enabled: boolean;
  verified: boolean;
}
