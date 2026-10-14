# Public gallery design review — 14 October 2026

Scope: the Discover landing page, shared artwork entries, header and footer. Account settings and editor screens retain their existing layouts. This uses the design-taste-frontend rubric; the scores below are subjective design judgments, not an accessibility certification.

## Direction and brief

Direction: **The contact sheet**, seed **1549659218**. Existing Georgia/Segoe UI type and Atelier green were retained; the ground moved to a neutral green-grey to improve contrast. One section redraw: the empty sideways gallery strip became **Photo tiles with label strips**, because a searchable collection needs readable titles, attribution and pagination. Actual 12-item API pages were retained instead of inventing 24 frames.

Subject inventory: Atelier; the existing green wordmark; credited Met CC0 images; complete museum titles; painting, sculpture, ceramics, printmaking, photography and textile records; explicit fictional community profiles; shared works distinct from their makers; private favorites; workshops; search and category filters; paginated discovery.

Idea: **On this page, Atelier's credited museum works and shared discoveries become a working contact sheet, with the artwork first and its provenance alongside it.** This is a familiar catalogue approach, rather than a wholly original concept.

Live interaction: search and category filters redraw the real collection. Pagination, empty-search recovery, artwork links, favorites and workshop routes remain available.

Argument and copy deck:

1. See what this gallery contains → real collection images visible in the first viewport. “A closer look at art.” / “A collection of museum works and shared discoveries. Find your next favorite.” / “Browse artworks.”
2. Find and inspect a work → “The collection”, labeled search/category controls, live result counts and complete catalogue entries.
3. Return to favorites → “Keep the works you love. Make a collection of your own.” / “Start your collection”, or “Open your collection” for a signed-in visitor.
4. Understand the demo → the footer explicitly identifies fictional profiles and sample activity; Privacy and Terms remain linked.

## Screenshot critique

### Before

Seen in one second: one tilted, framed Van Gogh reproduction.

Idea: a conventional gallery promotion rather than a working collection.

Live thing: existing search and filters, below the oversized introduction.

Layout words by section: hero=split / collection=grid / invitation=split / footer=row.

Scores: design 6.0 · usability 6.0 · creativity 5.5 · content 7.0 → overall **6.0**.

Caps applied: inspector failures; tiny labels, decorative framing and rules.

Top three problems:

1. `before/mobile-fold.jpg`: the first screen contained almost no artwork. Replace the framed hero with a compact introduction leading directly into the collection.
2. `before/tablet-page-01.jpg`: long titles were crowded into narrow columns with tiny provenance text. Use readable catalogue text and consistent image frames that show the whole object.
3. `before/desktop-fold.jpg`: the frame, shadow, uppercase labels and italic headline competed with the art. Remove the ornaments and use scale and spacing.

### Round 1

Seen in one second: the large gallery statement, then a row of real objects.

Idea: a collection laid out for inspection.

Live thing: labeled filters with the existing API.

Layout words by section: hero=text band / collection=contact sheet / invitation=sentence / footer=row.

Scores: design 7.2 · usability 7.5 · creativity 6.5 · content 8.0 → overall **6.0**, capped by the remaining inspector failures.

Caps applied: static motion and a short context label above the collection heading on small screens.

Top three problems:

1. `round-1/mobile-fold.jpg`: redundant introductory links still pushed the art to the very bottom. Remove repeated navigation and shorten the introduction.
2. `round-1/tablet-fold.jpg`: attribution appeared before the work's catalogue label. Move provenance below the title and contributor.
3. `round-1/desktop-page-01.jpg`: there was no motion or clear image feedback. Add brief entrances, a photograph settling into its frame, and hover/focus feedback with a reduced-motion fallback.

### Final round

Seen in one second: “A closer look at art”, immediately followed by the collection.

Idea: Atelier's objects form a readable contact sheet, with full titles and honest provenance.

Live thing: real search/category results; no invented counts or placeholder artwork.

Layout words by section: hero=text band / collection=contact sheet / invitation=sentence / footer=row.

Scores: design 7.5 · usability 8.2 · creativity 6.5 · content 8.0 → overall **7.6**.

Caps applied: none. Creativity remains modest because the archive composition is a known approach.

Remaining soft spots:

1. `final/mobile-page-01.jpg`: complete museum titles and provenance can create tall entries. They are retained as readable catalogue paragraphs; shortening the source records is outside a visual refresh.
2. `final/desktop-fold.jpg`: the static introduction is less distinctive than a bespoke exhibition identity. The collection supplies the subject-specific content.
3. `final/desktop-page-01.jpg`: the close is deliberately quiet, rather than another photographic section.

## Checks and limits

- Ran the skill inspector in real Chrome at **1440, 768 and 390px**; opened every final screenshot. Final result: **0 FAIL, 1 WARN**. No horizontal overflow or measured contrast warnings. The headline fits one line on desktop/tablet and two on phone.
- The single warning is no footage. The existing collection consists of credited still objects, so unrelated stock footage was omitted. Artwork photographs settle into their frames and provide hover/focus feedback instead. No new photographs, generated art, drawings or clips were introduced.
- The motion recorder observed 27 animated elements at each viewport. CSS disables animations and transitions for reduced-motion users; all content remains visible without an observer or motion script.
- Public template source lint: **0 FAIL, 0 WARN**. The shared stylesheet also contains existing account/editor/detail styles outside this landing-page review; its source-wide lint is not a clean bill for those screens.
- Angular tests include mobile-menu state, Escape/focus behavior, attribution and failed images. Browser checks covered category filtering, empty-search recovery, pagination and opening an artwork on a phone.
- Verification uses the temporary local demo, whose count is 38 works; the hosted catalogue has different data. Production publishing is a separate action.

## Existing imagery and credits

The first local page renders 12 images from 11 existing Met records; Bouquet of Flowers appears in two different shared entries. Each catalogue entry shows its image creator and “The Met, CC0”. Full source links and museum titles remain in the artwork detail and the shared image records. All files were already bundled in the project.

| Work / source                                                                                                         | Creator                                                         | License |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------- |
| [The Unicorn Rests in a Garden (from the Unicorn Tapestries)](https://www.metmuseum.org/art/collection/search/467642) | Unrecorded makers (French cartoon; South Netherlandish weaving) | CC0 1.0 |
| [Under the Wave off Kanagawa](https://www.metmuseum.org/art/collection/search/45434)                                  | Katsushika Hokusai                                              | CC0 1.0 |
| [View on the Columbia, Cascades](https://www.metmuseum.org/art/collection/search/262612)                              | Carleton E. Watkins                                             | CC0 1.0 |
| [Meiping vase with floral scrolls](https://www.metmuseum.org/art/collection/search/51206)                             | Unrecorded maker (China)                                        | CC0 1.0 |
| [Eve](https://www.metmuseum.org/art/collection/search/191804)                                                         | Auguste Rodin                                                   | CC0 1.0 |
| [The Thinker](https://www.metmuseum.org/art/collection/search/191811)                                                 | Auguste Rodin                                                   | CC0 1.0 |
| [Bouquet of Flowers](https://www.metmuseum.org/art/collection/search/437379)                                          | Odilon Redon                                                    | CC0 1.0 |
| [Sunflowers](https://www.metmuseum.org/art/collection/search/436524)                                                  | Vincent van Gogh                                                | CC0 1.0 |
| [Basket of Flowers](https://www.metmuseum.org/art/collection/search/436175)                                           | Eugène Delacroix                                                | CC0 1.0 |
| [Spring Flowers](https://www.metmuseum.org/art/collection/search/436026)                                              | Copy after Gustave Courbet                                      | CC0 1.0 |
| [Summer Flowers](https://www.metmuseum.org/art/collection/search/438031)                                              | Henri Fantin-Latour                                             | CC0 1.0 |

No sample content was added. Existing fictional profiles, demo posts and sample activity remain explicitly labeled and must be assessed before treating the app as a live artist community.
