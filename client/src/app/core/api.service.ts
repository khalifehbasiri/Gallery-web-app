import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { from, switchMap } from 'rxjs';
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
  reviews(id: string, page = 1) {
    return this.http.get<Page<Review>>(`/api/artworks/${id}/reviews`, {
      params: { page, limit: 12 },
    });
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
    const image = body.get('image') as File;
    return this.http
      .post<{ id: string; url: string }>('/api/uploads', {
        contentType: image.type,
        bytes: image.size,
      })
      .pipe(
        switchMap((upload) =>
          from(
            fetch(upload.url, {
              method: 'PUT',
              headers: { 'Content-Type': image.type, 'x-upsert': 'false' },
              body: image,
            }),
          ).pipe(
            switchMap((response) => {
              if (!response.ok)
                throw new Error('Image upload failed. Please try again.');
              const fields: Record<string, string> = { uploadId: upload.id };
              for (const key of [
                'title',
                'year',
                'category',
                'medium',
                'description',
              ])
                fields[key] = String(body.get(key) || '');
              return this.http.post<Artwork>('/api/artworks', fields);
            }),
          ),
        ),
      );
  }
  sessions() {
    return this.http.get<
      {
        id: string;
        createdAt: string;
        idleExpiresAt: string;
        absoluteExpiresAt: string;
        current: boolean;
      }[]
    >('/api/auth/sessions');
  }
  revokeSession(id: string) {
    return this.http.delete<void>(`/api/auth/sessions/${id}`);
  }
  logoutAll() {
    return this.http.post<void>('/api/auth/logout-all', {});
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
