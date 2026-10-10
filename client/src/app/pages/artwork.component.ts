import {
  collectionImage,
  isReferenceImage,
  isDemoCollection,
} from '../../../../shared/collection-images';
import { IconComponent } from '../shared/icon.component';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { ArtworkDetail, Review } from '../../../../shared/contracts';
import { ApiService } from '../core/api.service';
import { AuthStore } from '../core/auth.store';
import { errorMessage } from '../core/errors';
import { artDetailFacts } from '../../../../shared/art-forms';

@Component({
  selector: 'app-artwork',
  imports: [IconComponent, RouterLink, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page-width detail-page">
      <a class="back-link" routerLink="/"
        ><app-icon name="arrow-left" /> Back to the collection</a
      >
      @if (loading()) {
        <div class="empty-state" aria-busy="true">Opening the artwork…</div>
      }
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      @if (detail(); as data) {
        <div class="art-detail-grid">
          <div class="art-detail-image">
            @if (!imageFailed()) {
              <img
                [src]="data.artwork.imageUrl"
                [alt]="
                  collectionImage(data.artwork.imageUrl)?.alt ??
                  data.artwork.title
                "
                decoding="async"
                (error)="imageFailed.set(true)"
              />
            } @else {
              <span class="image-placeholder"
                ><app-icon name="image" /><span
                  >This artwork’s image is currently unavailable.</span
                ></span
              >
            }
            @if (collectionImage(data.artwork.imageUrl); as image) {
              <p class="image-credit detail-image-credit">
                @if (isReferenceImage(data.artwork.description)) {
                  <strong>Reference image.</strong>
                }
                {{ image.title }} · {{ image.creator }} · {{ image.date }}.
                <a
                  [href]="image.sourceUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  >The Met, CC0 <app-icon name="arrow-up-right"
                /></a>
              </p>
            }
          </div>
          <div class="art-detail-copy">
            <p class="eyebrow">
              {{ data.artwork.category }} · {{ data.artwork.year }}
            </p>
            <h1>{{ data.artwork.title }}</h1>
            @if (data.artist) {
              <a class="artist-link" [routerLink]="['/artists', data.artist.id]"
                >{{
                  isDemoCollection(data.artwork.description)
                    ? 'Shared by'
                    : isReferenceImage(data.artwork.description)
                      ? 'Original record by'
                      : 'By'
                }}
                {{ data.artist.username }} <app-icon name="arrow-up-right"
              /></a>
            } @else {
              <p>By {{ data.artwork.artist }}</p>
            }
            <p class="art-description">{{ data.artwork.description }}</p>
            <dl class="art-facts">
              @for (
                fact of artDetailFacts(data.artwork.artDetails);
                track fact.label
              ) {
                <div>
                  <dt>{{ fact.label }}</dt>
                  <dd>{{ fact.value }}</dd>
                </div>
              }
              <div>
                <dt>Medium</dt>
                <dd>{{ data.artwork.medium }}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{{ data.artwork.year }}</dd>
              </div>
              <div>
                <dt>Appreciations</dt>
                <dd>{{ data.artwork.likeCount }}</dd>
              </div>
            </dl>
            <button
              class="button button-outline"
              [disabled]="liking()"
              (click)="like()"
            >
              <app-icon name="heart" [filled]="data.artwork.liked" />
              {{
                data.artwork.liked
                  ? 'Saved to your collection'
                  : 'Save to your collection'
              }}
            </button>
          </div>
        </div>
        <section class="reviews-section">
          <div class="section-heading">
            <div>
              <p class="eyebrow">THE CONVERSATION</p>
              <h2>A different <em>point of view.</em></h2>
            </div>
            <span
              >{{ data.artwork.reviewCount }}
              {{ data.artwork.reviewCount === 1 ? 'review' : 'reviews' }}</span
            >
          </div>
          @if (auth.signedIn()) {
            <form
              class="review-form"
              [formGroup]="reviewForm"
              (ngSubmit)="submitReview()"
            >
              <label for="review">What does this work make you think of?</label
              ><textarea
                id="review"
                formControlName="text"
                maxlength="2000"
                placeholder="Share a thought, a feeling, or a question…"
              ></textarea
              ><button class="button button-small" [disabled]="reviewBusy()">
                {{ reviewBusy() ? 'Posting…' : 'Post your review' }}
                @if (!reviewBusy()) {
                  <app-icon name="arrow-up-right" />
                }
              </button>
            </form>
          } @else {
            <p><a routerLink="/login">Sign in</a> to join the conversation.</p>
          }
          @for (entry of data.artwork.reviews; track entry.id) {
            <article class="review-entry">
              <div class="review-heading">
                <a [routerLink]="['/artists', entry.authorId]"
                  ><span class="avatar">{{
                    entry.author.charAt(0).toUpperCase()
                  }}</span
                  >{{ entry.author }}</a
                >
                @if (entry.owned) {
                  <button
                    class="text-button"
                    [disabled]="removing() === entry.id"
                    (click)="remove(entry)"
                  >
                    Remove review
                  </button>
                }
              </div>
              <p>{{ entry.text }}</p>
            </article>
          }
          @if (!data.artwork.reviews.length) {
            <p class="muted">
              The conversation is open. Be the first to share a thought.
            </p>
          }
          @if (data.artwork.reviews.length < data.artwork.reviewCount) {
            <button
              class="text-button"
              [disabled]="reviewBusy()"
              (click)="moreReviews()"
            >
              Load more reviews
            </button>
          }
        </section>
      }
    </section>
  `,
})
export class ArtworkComponent {
  readonly artDetailFacts = artDetailFacts;
  readonly collectionImage = collectionImage;
  readonly isReferenceImage = isReferenceImage;
  readonly isDemoCollection = isDemoCollection;
  readonly id = input.required<string>();
  readonly auth = inject(AuthStore);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly detail = signal<ArtworkDetail | null>(null);
  readonly error = signal('');
  readonly loading = signal(true);
  readonly liking = signal(false);
  readonly reviewBusy = signal(false);
  readonly removing = signal('');
  readonly imageFailed = signal(false);
  private reviewPage = 1;
  async moreReviews() {
    if (this.reviewBusy()) return;
    this.reviewBusy.set(true);
    try {
      const response = await firstValueFrom(
        this.api.reviews(this.id(), this.reviewPage + 1),
      );
      this.reviewPage = response.page;
      this.detail.update((data) =>
        data
          ? {
              ...data,
              artwork: {
                ...data.artwork,
                reviewCount: response.total,
                reviews: [
                  ...new Map(
                    [...data.artwork.reviews, ...response.items].map((r) => [
                      r.id,
                      r,
                    ]),
                  ).values(),
                ],
              },
            }
          : data,
      );
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.reviewBusy.set(false);
    }
  }
  readonly review = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(2000)],
  });
  readonly reviewForm = new FormGroup({ text: this.review });
  constructor() {
    effect((onCleanup) => {
      const id = this.id();
      this.auth.user();
      this.detail.set(null);
      this.loading.set(true);
      this.error.set('');
      this.imageFailed.set(false);
      this.reviewPage = 1;
      const request = this.api.artwork(id).subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.error.set(errorMessage(error));
          this.loading.set(false);
        },
      });
      onCleanup(() => request.unsubscribe());
    });
  }
  async like() {
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/login'], {
        queryParams: { returnUrl: `/artworks/${this.id()}` },
      });
      return;
    }
    const current = this.detail();
    if (!current || this.liking()) return;
    this.liking.set(true);
    this.error.set('');
    const artworkId = current.artwork.id;
    this.detail.set({
      ...current,
      artwork: {
        ...current.artwork,
        liked: !current.artwork.liked,
        likeCount: current.artwork.likeCount + (current.artwork.liked ? -1 : 1),
      },
    });
    try {
      const response = await firstValueFrom(
        this.api.like(artworkId, !current.artwork.liked),
      );
      this.detail.update((data) =>
        data?.artwork.id === artworkId
          ? { ...data, artwork: { ...data.artwork, ...response } }
          : data,
      );
    } catch (error) {
      this.detail.update((data) =>
        data?.artwork.id === artworkId
          ? {
              ...data,
              artwork: {
                ...data.artwork,
                liked: current.artwork.liked,
                likeCount: current.artwork.likeCount,
              },
            }
          : data,
      );
      this.error.set(errorMessage(error));
    } finally {
      this.liking.set(false);
    }
  }
  async submitReview() {
    if (this.reviewBusy()) return;
    if (!this.review.value.trim()) {
      this.error.set('Write a review first.');
      return;
    }
    this.reviewBusy.set(true);
    this.error.set('');
    try {
      const review = await firstValueFrom(
        this.api.review(this.id(), this.review.value.trim()),
      );
      this.detail.update((data) =>
        data
          ? {
              ...data,
              artwork: {
                ...data.artwork,
                reviews: [...data.artwork.reviews, review],
                reviewCount: data.artwork.reviewCount + 1,
              },
            }
          : data,
      );
      this.review.reset();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.reviewBusy.set(false);
    }
  }
  async remove(review: Review) {
    this.removing.set(review.id);
    this.error.set('');
    try {
      await firstValueFrom(this.api.removeReview(this.id(), review.id));
      this.detail.update((data) =>
        data
          ? {
              ...data,
              artwork: {
                ...data.artwork,
                reviews: data.artwork.reviews.filter(
                  (entry) => entry.id !== review.id,
                ),
                reviewCount: data.artwork.reviewCount - 1,
              },
            }
          : data,
      );
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.removing.set('');
    }
  }
}
