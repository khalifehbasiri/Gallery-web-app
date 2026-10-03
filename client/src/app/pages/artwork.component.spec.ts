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
        imageUrl: '/blue-hour.svg',
        likeCount: 0,
        reviewCount: 0,
        liked: false,
        reviews: [],
      },
    };
    http.expectOne('/api/artworks/art').flush(detail);
    await fixture.whenStable();
    fixture.detectChanges();
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
    expect(
      fixture.nativeElement.querySelector('.review-entry')?.textContent,
    ).toContain('A peaceful composition.');
    expect(textarea.value).toBe('');
    expect(fixture.componentInstance.reviewBusy()).toBe(false);
  });
});
