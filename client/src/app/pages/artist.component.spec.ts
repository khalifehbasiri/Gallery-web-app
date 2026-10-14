import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtistComponent } from './artist.component';
import { AuthStore } from '../core/auth.store';

describe('Profile follow actions', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthStore).setUser({
      id: 'viewer',
      username: 'Viewer',
      role: 'patron',
    });
  });
  afterEach(() => http.verify());
  for (const failed of [false, true]) {
    it(`ignores a late follow ${failed ? 'failure' : 'response'} after navigating to another profile`, async () => {
      const fixture = TestBed.createComponent(ArtistComponent);
      const profile = (id: string) => ({
        id,
        username: id,
        role: 'artist',
        following: false,
        artworks: [],
        workshops: [],
      });
      fixture.componentRef.setInput('id', 'old');
      fixture.detectChanges();
      http.expectOne('/api/people/old').flush(profile('old'));
      await fixture.whenStable();
      const operation = fixture.componentInstance.follow();
      const pending = http.expectOne('/api/people/old/follow');
      await fixture.componentInstance.follow();
      http.expectNone('/api/people/old/follow');
      fixture.componentRef.setInput('id', 'new');
      fixture.detectChanges();
      const next = profile('new');
      http.expectOne('/api/people/new').flush(next);
      await fixture.whenStable();
      if (failed)
        pending.flush(
          { error: 'Old follow failed.' },
          {
            status: 503,
            statusText: 'Unavailable',
          },
        );
      else pending.flush({ following: true });
      await operation;
      expect(fixture.componentInstance.artist()).toEqual(next);
      expect(fixture.componentInstance.error()).toBe('');
      expect(fixture.componentInstance.busy()).toBe(false);
      const following = fixture.componentInstance.follow();
      http.expectOne('/api/people/new/follow').flush({ following: true });
      await following;
      expect(fixture.componentInstance.artist()?.following).toBe(true);
    });
  }
});
