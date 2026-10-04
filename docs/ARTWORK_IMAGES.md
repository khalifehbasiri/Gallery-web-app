# Artwork images and credits

The landing and sign-in pages feature **Cypresses** by Vincent van Gogh (1889). The collection uses actual artwork photographs, with visible creator/source credits and image-specific alternative text. SVG icons use `currentColor`, remain hidden from assistive technology, and retain readable button/link labels.

The 24 JPEGs below were downloaded from The Metropolitan Museum of Art's API only after confirming `isPublicDomain: true`. The Met releases these images under [CC0 1.0](https://www.metmuseum.org/hubs/open-access). The pinned source records, download URLs, dimensions and SHA-256 digests live in `shared/collection-images.ts`. No museum descriptions were copied. The first six works form the demo collection; the rest are reference images for preserved records with lost originals.

| Artwork                                                          | Creator                                              | Source                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| Cypresses                                                        | Vincent van Gogh                                     | [The Met, 1889](https://www.metmuseum.org/art/collection/search/437980)          |
| Wheat Field with Cypresses                                       | Vincent van Gogh                                     | [The Met, 1889](https://www.metmuseum.org/art/collection/search/436535)          |
| Irises                                                           | Vincent van Gogh                                     | [The Met, 1890](https://www.metmuseum.org/art/collection/search/436528)          |
| Still Life with Apples and a Pot of Primroses                    | Paul Cézanne                                         | [The Met, ca. 1890](https://www.metmuseum.org/art/collection/search/435882)      |
| Boating                                                          | Edouard Manet                                        | [The Met, 1874](https://www.metmuseum.org/art/collection/search/436947)          |
| The Boulevard Montmartre on a Winter Morning                     | Camille Pissarro                                     | [The Met, 1897](https://www.metmuseum.org/art/collection/search/437310)          |
| Sunflowers                                                       | Vincent van Gogh                                     | [The Met, 1887](https://www.metmuseum.org/art/collection/search/436524)          |
| Self-Portrait with a Straw Hat (obverse: The Potato Peeler)      | Vincent van Gogh                                     | [The Met, 1887](https://www.metmuseum.org/art/collection/search/436532)          |
| A Woman Seated beside a Vase of Flowers (Madame Paul Valpinçon?) | Edgar Degas                                          | [The Met, 1865](https://www.metmuseum.org/art/collection/search/436121)          |
| By the Seashore                                                  | Auguste Renoir                                       | [The Met, 1883](https://www.metmuseum.org/art/collection/search/437430)          |
| Circus Sideshow (Parade de cirque)                               | Georges Seurat                                       | [The Met, 1887–88](https://www.metmuseum.org/art/collection/search/437654)       |
| Landscape                                                        | Circle of Carl Rottmann                              | [The Met, ca. 1835–45](https://www.metmuseum.org/art/collection/search/438849)   |
| Italian Landscape                                                | Camille Corot                                        | [The Met, ca. 1825–28](https://www.metmuseum.org/art/collection/search/435973)   |
| Rue Eugène Moussoir at Moret: Winter                             | Alfred Sisley                                        | [The Met, 1891](https://www.metmuseum.org/art/collection/search/437686)          |
| January: Cernay, near Rambouillet                                | Léon-Germain Pelouse                                 | [The Met, ](https://www.metmuseum.org/art/collection/search/437269)              |
| Winter Landscape, Holland                                        | Barend Cornelis Koekkoek                             | [The Met, 1833](https://www.metmuseum.org/art/collection/search/436826)          |
| The Deer                                                         | Gustave Courbet                                      | [The Met, ca. 1865](https://www.metmuseum.org/art/collection/search/436011)      |
| The Peddler                                                      | Vladimir Egorovich Makovsky                          | [The Met, 1880](https://www.metmuseum.org/art/collection/search/436939)          |
| Fruit and Flowers                                                | Orsola Maddalena Caccia                              | [The Met, ca. 1630](https://www.metmuseum.org/art/collection/search/816523)      |
| Ship by Moonlight                                                | Ivan Konstantinovich Aivazovsky (Hovhannes Aivazian) | [The Met, ](https://www.metmuseum.org/art/collection/search/437979)              |
| Summer Flowers                                                   | Henri Fantin-Latour                                  | [The Met, 1880](https://www.metmuseum.org/art/collection/search/438031)          |
| Spring Flowers                                                   | Copy after Gustave Courbet                           | [The Met, ca. 1855–60](https://www.metmuseum.org/art/collection/search/436026)   |
| Basket of Flowers                                                | Eugène Delacroix                                     | [The Met, 1848–49](https://www.metmuseum.org/art/collection/search/436175)       |
| Bouquet of Flowers                                               | Odilon Redon                                         | [The Met, ca. 1900–1905](https://www.metmuseum.org/art/collection/search/437379) |

## Attribution and preservation

A reference image is visibly labeled on the card and detail page. Its credit and alternative text name the actual pictured work. The original record keeps its original title, artist, year, description and relationships. This avoids pretending that a different painting is the missing original. Demo collection entries use the real work's metadata and say “Shared by Maya Laurent”; that account did not author the paintings. The six recovered originals retain their existing images and rights; the CC0 statement applies only to the 24 new museum images.

## Storage and delivery

Bundled JPEGs live in `client/public/artworks/`, with their content digest in the filename, and are served by Vercel's CDN with an immutable one-year browser cache. They require no museum API calls while browsing and add no storage-service dependency to the isolated demo. User-created uploads still use validated private staging and public Supabase Storage. Artwork cards load images lazily, reserve their layout through CSS, and display a clear unavailable state on a real network failure; the hero loads eagerly with explicit dimensions. Source artwork is shown in full on the detail page.

## Safe hosted repair

`npm run images:repair` is an explicit operator command; it never runs during deployment. Configure a canonical HTTPS `CLIENT_ORIGIN` and the existing MongoDB/PostgreSQL credentials in the ignored environment. The command verifies local file digests, prepares only the original fixture/demo artwork IDs, and writes a before/after journal to ignored `exports/collection-image-repair.json`.

Deploy and verify the new static assets first. Then run `npm run images:repair -- --apply`. It verifies the hosted files against the same digests, locks each SQL record, conditionally replaces the matching MongoDB document, updates the PostgreSQL search projection, and invalidates public Redis caches. It preserves IDs, owners, publication timestamps, likes and reviews. A retry accepts either the recorded before state or after state, allowing an interrupted cross-database copy to finish; unexpected edits cause it to stop. The existing prepared seed snapshot is updated after completion. Keep the ignored journal as the restoration reference, and never publish operator exports.

Asset verification runs in CI alongside API/client tests and the production build. See the README for the complete architecture and deployment checks.
