import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { ArtCardComponent } from './art-card.component';
import {
  featuredImage,
  referenceImageDescription,
  demoCollectionDescription,
} from '../../../../shared/collection-images';

function card(description: string) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(ArtCardComponent);
  fixture.componentRef.setInput('art', {
    id: 'art',
    title: 'Original artwork',
    artist: 'Original artist',
    year: '2022',
    category: 'Painting',
    medium: 'Oil',
    description,
    imageUrl: `/artworks/${featuredImage.file}`,
    likeCount: 1,
    reviewCount: 0,
    liked: true,
  });
  fixture.detectChanges();
  return fixture;
}

describe('Artwork image attribution', () => {
  it('labels a reference and describes the actual image rather than the unavailable original', () => {
    const fixture = card(
      referenceImageDescription(featuredImage, 'Original description.'),
    );
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.reference-label')?.textContent).toBe(
      'Reference image',
    );
    expect(element.querySelector('img')?.alt).toBe(featuredImage.alt);
    expect(element.querySelector('.image-credit')?.textContent).toContain(
      featuredImage.creator,
    );
    expect(element.textContent).toContain('Original artwork');
    expect(element.querySelectorAll('a a').length).toBe(0);
    expect(
      element.querySelector('app-icon[name="heart"] svg')?.getAttribute('fill'),
    ).toBe('currentColor');
    expect(element.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('credits shared demo artwork and shows a clear failure state when its image cannot load', () => {
    const fixture = card(demoCollectionDescription(featuredImage));
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.art-card-meta')?.textContent).toContain(
      'Shared by Original artist',
    );
    expect(element.querySelector('.reference-label')).toBeNull();
    element.querySelector('img')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('.image-placeholder')?.textContent).toContain(
      'Image unavailable',
    );
  });
});
