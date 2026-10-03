import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import type {
  Account,
  AccountRole,
  Artist,
  Artwork,
  ArtworkDetail,
  ArtworkSummary,
  AuthResponse,
  Credentials,
  GalleryQuery,
  GalleryStats,
  LikeResponse,
  Page,
  Review,
  Workshop,
} from '../../../../shared/contracts';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  me() {
    return this.http.get<AuthResponse>('/api/auth/me');
  }
  login(credentials: Credentials) {
    return this.http.post<AuthResponse>('/api/auth/login', credentials);
  }
  register(credentials: Credentials) {
    return this.http.post<AuthResponse>('/api/auth/register', credentials);
  }
  logout() {
    return this.http.post<void>('/api/auth/logout', {});
  }
  stats() {
    return this.http.get<GalleryStats>('/api/stats');
  }
  artworks(query: GalleryQuery) {
    const params = new HttpParams()
      .set('search', query.search)
      .set('category', query.category)
      .set('artist', query.artist)
      .set('page', query.page)
      .set('limit', 12);
    return this.http.get<Page<ArtworkSummary>>('/api/artworks', { params });
  }
  artwork(id: string) {
    return this.http.get<ArtworkDetail>(`/api/artworks/${id}`);
  }
  artist(id: string) {
    return this.http.get<Artist>(`/api/artists/${id}`);
  }
  follow(id: string, following: boolean) {
    return following
      ? this.http.put<{ following: boolean }>(`/api/artists/${id}/follow`, {})
      : this.http.delete<{ following: boolean }>(`/api/artists/${id}/follow`);
  }
  like(id: string, liked: boolean) {
    return liked
      ? this.http.put<LikeResponse>(`/api/artworks/${id}/like`, {})
      : this.http.delete<LikeResponse>(`/api/artworks/${id}/like`);
  }
  review(id: string, text: string) {
    return this.http.post<Review>(`/api/artworks/${id}/reviews`, { text });
  }
  removeReview(id: string, reviewId: string) {
    return this.http.delete<void>(`/api/artworks/${id}/reviews/${reviewId}`);
  }
  createArtwork(body: FormData) {
    return this.http.post<Artwork>('/api/artworks', body);
  }
  workshops(page = 1) {
    return this.http.get<Page<Workshop>>('/api/workshops', {
      params: { page, limit: 12 },
    });
  }
  createWorkshop(body: { name: string; goal: string; weeks: number }) {
    return this.http.post<Workshop>('/api/workshops', body);
  }
  joinWorkshop(workshop: Workshop) {
    return this.http.put<Workshop>(
      `/api/artists/${workshop.artistId}/workshops/${workshop.id}/registration`,
      {},
    );
  }
  account() {
    return this.http.get<Account>('/api/account');
  }
  updateRole(role: AccountRole) {
    return this.http.patch<AuthResponse>('/api/account', { role });
  }
}
