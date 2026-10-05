import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
@Component({
  selector: 'app-legal',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <article class="page-width inner-page legal-page">
    @if (mode === 'deleted') {
      <h1>Account deletion requested</h1>
      <p>
        Your access has been revoked, optional email stopped, and your public
        gallery entries hidden. Document and image cleanup will be retried if a
        provider is unavailable. A final image sweep waits for issued upload
        links to expire.
      </p>
      <p>
        Previously downloaded copies and browser/CDN caches cannot be recalled.
        See the <a routerLink="/privacy">retention policy</a>.
      </p>
      <a routerLink="/">Return to the gallery</a>
    } @else if (mode === 'privacy') {
      <h1>Privacy notice and retention</h1>
      <p>Effective October 5, 2026 · Version 2026-10-05</p>
      <p>
        Atelier is a personal portfolio gallery maintained by the owner of
        <a href="https://github.com/khalifehbasiri/Gallery-web-app"
          >this project</a
        >. These disclosures describe the implemented service; they are not a
        certification of legal compliance.
      </p>
      <h2>Information and purpose</h2>
      <p>
        We collect your username, email, password hash, role, terms
        acknowledgement, session records, artwork, images, reviews, likes,
        follows, workshop participation, and notification choices. We use them
        to provide the gallery, authenticate accounts, recover access, process
        uploads and deliver requested emails. Passwords are hashed;
        recovery/refresh secrets are stored as hashes, and queued email payloads
        are encrypted.
      </p>
      <h2>Public and private information</h2>
      <p>
        Published artwork, artist names, workshops and reviews are public.
        Account email, credentials, session records and notification settings
        are private. Uploaded images become public when published. Do not upload
        sensitive personal information or content you do not have permission to
        share.
      </p>
      <h2>Providers and locations</h2>
      <p>
        Vercel serves the app and API; Supabase stores relational records and
        images in Canada; MongoDB Atlas stores artwork documents in the United
        States; Upstash supplies Redis; Render processes email jobs in the
        United States; Resend delivers email when enabled. Providers may process
        data in other locations under their own terms. Data may cross borders.
        We do not sell account data or install advertising trackers.
      </p>
      <h2>Web analytics</h2>
      <p>
        We use Vercel Web Analytics to understand visits and page views. It
        collects page paths, referrer information, approximate location, and
        browser/device information for aggregate traffic statistics without
        analytics cookies. We remove query strings and URL fragments before
        sending page views, including verification and password recovery tokens.
        We do not send account email, credentials, or custom interaction events
        to analytics. See
        <a href="https://vercel.com/docs/analytics/privacy-policy"
          >Vercel's analytics privacy information</a
        >
        for provider handling and retention.
      </p>
      <h2>Cookies and email choice</h2>
      <p>
        Essential authentication and CSRF cookies maintain sessions and protect
        requests. Tokens are not stored in browser local storage. Optional
        appreciation emails are off by default unless you explicitly choose them
        and verify your email. Disable them in account settings or unsubscribe
        from an email. Requested verification and password recovery emails are
        separate.
      </p>
      <h2>Retention schedule</h2>
      <ul>
        <li>
          Account/profile/content: while your account exists; deletion
          immediately revokes access and hides public entries. Bounded cleanup
          retries remove documents, images and relational records. A final image
          sweep waits up to two hours for issued upload URLs to expire. Daily
          processing adds delay; outages/backlogs can extend it.
        </li>
        <li>
          Access JWT: ten minutes. Refresh/session: seven-day sliding idle
          window, thirty-day absolute maximum. Expired records are removed by
          maintenance.
        </li>
        <li>
          Verification/reset challenges: thirty minutes, single use; expired
          records are removed by maintenance.
        </li>
        <li>
          Completed, cancelled and dead email jobs, including encrypted
          payloads: thirty days. Expired account-email jobs are cancelled;
          unresolved jobs require operator review.
        </li>
        <li>
          Webhook deduplication: thirty days; hashed email abuse counters: seven
          days; send-budget counters: ninety days.
        </li>
        <li>
          Bounce/complaint suppression addresses: up to three years to prevent
          unwanted mail, then removed by maintenance; they are independent of
          account deletion.
        </li>
        <li>
          Public Redis entries and authorization proofs: normally at most sixty
          seconds; rate counters expire with their windows.
        </li>
        <li>
          Unused uploads: reservation expires after fifteen minutes; cleanup
          waits for the two-hour signed upload capability to expire.
        </li>
        <li>
          Provider logs, CDN caches and provider-managed backups follow provider
          retention. Manual operator backups must be inventoried,
          access-restricted, and removed within thirty days unless a documented
          legal preservation obligation applies; restoring one requires
          replaying subsequent deletions.
        </li>
      </ul>
      <h2>Access, correction and deletion</h2>
      <p>
        In <a routerLink="/account">account settings</a>, confirm your password
        to export your data or permanently delete your account. JSON exports
        include account/activity data, full artwork text and image links; image
        bytes are downloaded separately. Exports over 1,000 rows per category or
        4 MB need operator assistance. Shared public demo accounts cannot store
        personal email or be deleted.
      </p>
      <p>
        For privacy questions, corrections, a large export or delayed deletion,
        contact the
        <a href="https://github.com/khalifehbasiri">project maintainer</a>. Do
        not put personal information or passwords in public issues. A dedicated
        privacy contact and jurisdiction-specific legal review are pending
        before a broader public launch.
      </p>
      <h2>Limits and changes</h2>
      <p>
        Copies already downloaded by others cannot be recalled. Free hosting
        does not provide a guaranteed deletion completion time or comprehensive
        managed backups. Material changes will update this notice and its
        version.
      </p>
    } @else {
      <h1>Terms of use</h1>
      <p>Effective October 4, 2026 · Version 2026-10-04</p>
      <p>
        Atelier is a free personal portfolio demonstration. It is not an artwork
        marketplace, payment service, or guaranteed production service. By
        registering, you acknowledge these terms and the
        <a routerLink="/privacy">privacy notice</a>.
      </p>
      <h2>Your account</h2>
      <p>
        Provide an email you control, keep credentials private, and use account
        controls to revoke access if compromised. Shared demo accounts are for
        testing: do not use them for personal or confidential data. This
        demonstration is intended for people aged sixteen or older.
      </p>
      <h2>Your content</h2>
      <p>
        You retain ownership of your original content. You grant the maintainer
        permission to store and display content you publish for operating this
        gallery, ending when it is removed, subject to documented cleanup,
        caching and retention. Upload only material you have rights to share.
        Artwork and workshop listings do not transfer ownership or create a
        purchase agreement.
      </p>
      <h2>Acceptable use</h2>
      <p>
        Do not upload unlawful, abusive or rights-infringing content;
        impersonate others; send spam; bypass limits; probe other users'
        accounts; or interfere with the service. The maintainer may remove
        content or suspend abusive access.
      </p>
      <h2>Availability and account closure</h2>
      <p>
        Free providers can impose quotas, sleep, suspend inactive services or
        experience outages. Keep your own copies of artwork. You may export or
        delete your account in settings. Deletion also removes your workshops
        and artwork-related activity; it cannot recall third-party copies.
      </p>
      <h2>Contact and legal review</h2>
      <p>
        Contact the
        <a href="https://github.com/khalifehbasiri">project maintainer</a> for
        questions or content concerns. These portfolio terms require a qualified
        review of operator details, applicable law, user age requirements and
        jurisdiction before broader launch; no legal compliance certification is
        claimed.
      </p>
    }
  </article>`,
})
export class LegalComponent {
  readonly mode = inject(ActivatedRoute).snapshot.data['mode'] as
    'privacy' | 'terms' | 'deleted';
}
