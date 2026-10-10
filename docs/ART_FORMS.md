# Art forms and MongoDB documents

The gallery supports Painting, Sculpture, Ceramics, Photography, Printmaking and Textile. Publishing suggests these categories and asks for the relevant details. Custom categories remain available. Artwork detail pages display the stored facts; gallery category filters and text search use the existing SQL projection.

The optional `artDetails` object is a discriminated union, validated by Express and MongoDB. Each form has its own required fields, bounded to 200 characters. Unknown fields, mismatched categories and invalid values are rejected. Existing documents without this object remain valid.

| Form        | Nested fields            |
| ----------- | ------------------------ |
| Painting    | `paint`, `support`       |
| Sculpture   | `material`, `dimensions` |
| Ceramics    | `clayBody`, `finish`     |
| Photography | `process`, `dimensions`  |
| Printmaking | `technique`, `support`   |
| Textile     | `fibers`, `technique`    |

For example, a sculpture contains `artDetails: { type: "sculpture", material: "Bronze", dimensions: "174 × 52.1 × 59.7 cm" }`, while a textile contains fibers and a weaving technique. These complete, varying documents live in MongoDB. PostgreSQL keeps the common searchable metadata and relational activity. Art details are returned on the detail endpoint, preserved by account export and artwork migration, and included in publication retry comparisons. Form-specific fields are not indexed for full-text search.

This provides a concrete document-model use case: artwork is an aggregate with a common core and different nested facts for each form. MongoDB is a suitable choice, although PostgreSQL JSONB could also represent these structures. Variety alone does not require MongoDB.

## Repeatable seed

`npm run demo` includes eight additional entries, covering all six forms, after the original demo and community fixtures. The hosted operator seed uses the existing Maya Laurent demo artist and never runs during deployment:

```sh
# Configure .env for the intended databases and canonical HTTPS CLIENT_ORIGIN.
npm run seed:art-forms
npm run seed:art-forms:apply
```

The first command checks conflicts and prints the planned scope without writes. Apply verifies bundled image digests, prepares the expanded MongoDB collection, publishes eight deterministic IDs, verifies full document equality and SQL publication, and invalidates discovery caches. Repeat runs insert zero duplicates. Matching pending publications can resume; conflicting or missing published documents stop for reconciliation. Existing accounts, credentials, posts, likes, reviews and follows remain untouched; seeding sends no emails.

`npm run mongo:prepare` creates/verifies `artworks_v2` with the expanded validator. Runtime writes use this collection; reads fall back to the original `artworks` collection, and deletion covers both. New writes cannot reuse IDs already stored in the legacy collection. An unknown validator on `artworks_v2` is rejected. The original collection and its validator stay intact: preparation requires only the existing database-scoped `readWrite` role, avoiding `collMod` administrator privileges. No database roles or credentials are changed.

For an existing hosted installation, prepare the new collection, deploy this version, then apply the seed. Older releases only read `artworks` and cannot read the new collection; rolling back after new publications requires copying and verifying the new documents with a compatible schema first. There is no automatic rollback to the old document format.

## Museum sources

All eight entries are explicitly labeled demo collection posts. Maya Laurent shares them and is not their creator. The collection includes Sunflowers and Bouquet of Flowers, two Rodin bronzes, a glazed stoneware vase, an albumen photograph, a woodblock print and a tapestry. Six additional CC0 JPEGs are bundled with source URLs, dimensions and SHA-256 digests in `shared/art-form-images.ts`; the two painting images reuse existing audited assets.

- [The Thinker](https://www.metmuseum.org/art/collection/search/191811) and [Eve](https://www.metmuseum.org/art/collection/search/191804): bronze sculptures by Auguste Rodin.
- [Meiping vase with floral scrolls](https://www.metmuseum.org/art/collection/search/51206): Chinese stoneware, 14th century; maker unrecorded.
- [View on the Columbia, Cascades](https://www.metmuseum.org/art/collection/search/262612): Carleton E. Watkins, 1867, albumen silver print from a glass negative.
- [The Great Wave](https://www.metmuseum.org/art/collection/search/45434): Katsushika Hokusai, ca. 1830–32, woodblock print.
- [The Unicorn Rests in a Garden](https://www.metmuseum.org/art/collection/search/467642): South Netherlandish tapestry, 1495–1505; maker unrecorded.

Year filters retain a representative numeric year; image credits show the museum's complete date or range. No invented camera models, firing temperatures, edition numbers or weights are added.

Tests cover the actual MongoDB validator and legacy compatibility, all document shapes, nested export/copy fidelity, seed preservation/conflicts/recovery, gallery filtering, cached API details, publication retry conflicts, publishing form submission and escaped detail rendering.
