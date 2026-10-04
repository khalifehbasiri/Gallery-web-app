# Technical legal readiness review

Reviewed October 4, 2026. This is a source-level privacy readiness assessment, not a lawyer's opinion, regulatory certification or a determination that any particular law applies. A qualified reviewer must assess the operator, jurisdictions, audience, service purpose and provider contracts before broader/commercial launch.

## Implemented evidence

- `/privacy` describes collection, purpose, public content, processors, cross-border processing, essential cookies, account rights, retention and limitations.
- `/terms` describes the portfolio service, user responsibilities, content ownership/display permission, acceptable use, availability and closure.
- Registration records terms version/time. Optional notification consent is separate, unchecked by default, versioned and withdrawable.
- Email ownership is required before recovery or enabling the linked optional notifications. Transactional recovery is independent of optional consent.
- Export and deletion require current-password confirmation, authenticated ownership and CSRF protection. Demo accounts are protected.
- Deletion revokes authorization through the distributed fence and retries cleanup across MongoDB, PostgreSQL and Storage. Retention maintenance is scheduled daily and available to operators.
- Credentials are hashed; mail payloads are encrypted; Redis holds no raw bearer credentials. No advertising/product analytics SDK is installed.

## Matters requiring qualified review / operator completion

1. Confirm the operator's legal identity and publish a dedicated private privacy/contact channel. The current maintainer profile link is a portfolio fallback, not a finished privacy office.
2. Determine applicable Canadian provincial/federal, EU/UK or other requirements from actual activity and users. Assess lawful bases, notices, response deadlines and cross-border transfers rather than claiming universal compliance.
3. Review the age restriction, content/IP licence, takedown/dispute procedures and contract wording.
4. Review whether appreciation mail is a commercial electronic message, sender identification/contact-address requirements and consent evidence retention. Public email remains disabled pending a verified sender and signed webhook.
5. Audit provider data-processing terms, subprocessors, retention, incident response and notification duties. Establish an incident-response owner and record.
6. Inventory and expire ignored snapshots/legacy copies; replay deletions before restores. Automated deletion does not erase historical offline/provider backup copies.
7. Test an assisted large export and a restore/deletion reconciliation exercise. Free hosting has no deletion SLA and no comprehensive managed backup guarantee.

The implementation supports privacy-conscious operation; it must not be advertised as fully GDPR/PIPEDA/CASL compliant without that review. Canada's privacy regulator recommends purpose-based retention and disposal procedures: [retention/disposal guidance](https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/appropriate-handling-of-personal-information/gd_rd_201406/) and [limiting use, disclosure and retention](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/p_principle/principles/p_use/).
