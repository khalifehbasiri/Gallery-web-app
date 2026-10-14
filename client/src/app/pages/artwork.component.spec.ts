import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';
import { ArtworkComponent } from './artwork.component';
import { AuthStore } from '../core/auth.store';
import type { ArtworkDetail } from '../../../../shared/contracts';

describe('Artwork review form', () => {
  let http: HttpTestingController;
  afterEach(() => http.verify());
  for (const action of ['submit', 'remove', 'more'] as const) {
    for (const failed of [false, true]) {
      it(`ignores a late ${action} review ${failed ? 'failure' : 'response'} after navigating to another artwork`, async () => {
        TestBed.configureTestingModule({
          providers: [
            provideHttpClient(),
            provideHttpClientTesting(),
            provideRouter([]),
          ],
        });
        http = TestBed.inject(HttpTestingController);
        const fixture = TestBed.createComponent(ArtworkComponent);
        const component = fixture.componentInstance;
        const entry = {
          id: 'review',
          author: 'Patron',
          authorId: 'patron',
          text: 'A thought.',
          owned: true,
        };
        const detail = (id: string): ArtworkDetail => ({
          artist: null,
          artwork: {
            id,
            title: 'Study',
            artist: 'Artist',
            year: '2026',
            category: 'Painting',
            medium: 'Oil',
            description: 'Study.',
            imageUrl: '/test.jpg',
            likeCount: 0,
            liked: false,
            reviewCount: 13,
            reviews: [entry],
          },
        });
        fixture.componentRef.setInput('id', 'old');
        fixture.detectChanges();
        http.expectOne('/api/artworks/old').flush(detail('old'));
        await fixture.whenStable();
        component.review.setValue('A new thought.');
        const operation =
          action === 'submit'
            ? component.submitReview()
            : action === 'remove'
              ? component.remove(entry)
              : component.moreReviews();
        const pending = http.expectOne(
          (request) =>
            request.url ===
            (action === 'remove'
              ? '/api/artworks/old/reviews/review'
              : '/api/artworks/old/reviews'),
        );
        fixture.componentRef.setInput('id', 'new');
        fixture.detectChanges();
        const next = detail('new');
        http.expectOne('/api/artworks/new').flush(next);
        await fixture.whenStable();
        component.review.setValue('Draft for the new artwork.');
        if (failed)
          pending.flush(
            { error: 'Old request failed.' },
            {
              status: 503,
              statusText: 'Unavailable',
            },
          );
        else
          pending.flush(
            action === 'submit'
              ? entry
              : action === 'remove'
                ? null
                : { items: [entry], total: 13, page: 2, limit: 12, pages: 2 },
          );
        await operation;
        expect(component.detail()).toEqual(next);
        expect(component.error()).toBe('');
        expect(component.review.value).toBe('Draft for the new artwork.');
        if (action === 'more') {
          const loading = component.moreReviews();
          const request = http.expectOne(
            '/api/artworks/new/reviews?page=2&limit=12',
          );
          request.flush({ items: [], total: 13, page: 2, limit: 12, pages: 2 });
          await loading;
        }
      });
    }
  }
  it('renders the structured form details as escaped text', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ArtworkComponent);
    fixture.componentRef.setInput('id', 'sculpture');
    fixture.detectChanges();
    http.expectOne('/api/artworks/sculpture').flush({
      artist: null,
      artwork: {
        id: 'sculpture',
        title: 'Study',
        artist: 'Artist',
        year: '2026',
        category: 'Sculpture',
        medium: 'Bronze',
        description: 'Study.',
        imageUrl: '/test.jpg',
        likeCount: 0,
        reviewCount: 0,
        liked: false,
        reviews: [],
        artDetails: {
          type: 'sculpture',
          material: '<script>bronze</script>',
          dimensions: '70.2 cm',
        },
      },
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const facts = fixture.nativeElement.querySelector('.art-facts');
    expect(facts.textContent).toContain('Material');
    expect(facts.textContent).toContain('<script>bronze</script>');
    expect(facts.textContent).toContain('70.2 cm');
    expect(facts.querySelector('script')).toBeNull();
  });

  it('shows an optimistic heart immediately and restores it when persistence fails', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthStore).setUser({
      id: 'patron',
      username: 'Patron',
      role: 'patron',
    });
    const fixture = TestBed.createComponent(ArtworkComponent);
    fixture.componentRef.setInput('id', 'art');
    fixture.detectChanges();
    http.expectOne('/api/artworks/art').flush({
      artist: null,
      artwork: {
        id: 'art',
        title: 'Blue hour',
        artist: 'Artist',
        year: '2026',
        category: 'Digital',
        medium: 'Digital',
        description: 'Blue.',
        imageUrl: '/test-artwork.jpg',
        likeCount: 2,
        reviewCount: 0,
        liked: false,
        reviews: [],
      },
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const operation = fixture.componentInstance.like();
    expect(fixture.componentInstance.detail()!.artwork.liked).toBe(true);
    expect(fixture.componentInstance.detail()!.artwork.likeCount).toBe(3);
    http
      .expectOne('/api/artworks/art/like')
      .flush(
        { error: 'Unavailable' },
        { status: 503, statusText: 'Unavailable' },
      );
    await operation;
    expect(fixture.componentInstance.detail()!.artwork.liked).toBe(false);
    expect(fixture.componentInstance.detail()!.artwork.likeCount).toBe(2);
    expect(fixture.componentInstance.error()).toBe('Unavailable');
  });

  it('submits the form through Angular, displays the saved review, and clears the input', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthStore).setUser({
      id: 'patron',
      username: 'Patron',
      role: 'patron',
    });
    const fixture = TestBed.createComponent(ArtworkComponent);
    fixture.componentRef.setInput('id', 'art');
    fixture.detectChanges();
    const detail: ArtworkDetail = {
      artist: null,
      artwork: {
        id: 'art',
        title: 'Blue hour',
        artist: 'Artist',
        year: '2026',
        category: 'Digital',
        medium: 'Digital',
        description: 'A study in blue.',
        imageUrl: '/test-artwork.jpg',
        likeCount: 0,
        reviewCount: 0,
        liked: false,
        reviews: [
          {
            id: 'legacy-xss',
            author: 'Legacy <script>',
            authorId: 'legacy',
            owned: false,
            text: "<script>alert(1)</script><img src=x onerror=alert(1)> javascript:alert(1) &#60;script&#62; O'Brien — مرحباً",
          },
        ],
      },
    };
    http.expectOne('/api/artworks/art').flush(detail);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.review-entry').textContent,
    ).toContain('<script>alert(1)</script>');
    expect(
      fixture.nativeElement.querySelector('.review-entry script'),
    ).toBeNull();
    expect(fixture.nativeElement.querySelector('.review-entry img')).toBeNull();
    const textarea = fixture.nativeElement.querySelector(
      'textarea',
    ) as HTMLTextAreaElement;
    textarea.value = 'A peaceful composition.';
    textarea.dispatchEvent(new Event('input'));
    const submitted = new Event('submit', { bubbles: true, cancelable: true });
    fixture.nativeElement.querySelector('form').dispatchEvent(submitted);
    expect(submitted.defaultPrevented).toBe(true);
    const request = http.expectOne('/api/artworks/art/reviews');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ text: 'A peaceful composition.' });
    request.flush({
      id: 'review',
      authorId: 'patron',
      author: 'Patron',
      text: 'A peaceful composition.',
      owned: true,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'A peaceful composition.',
    );
    expect(textarea.value).toBe('');
    expect(fixture.componentInstance.reviewBusy()).toBe(false);
  });
});
