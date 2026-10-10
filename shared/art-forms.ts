// Common gallery fields remain searchable in SQL. These varying details belong
// to the complete artwork document in MongoDB.
export const artForms = {
  painting: {
    category: 'Painting',
    fields: [
      {
        key: 'paint',
        label: 'Paint',
        placeholder: 'Oil, watercolor, acrylic…',
      },
      { key: 'support', label: 'Surface', placeholder: 'Canvas, paper, wood…' },
    ],
  },
  sculpture: {
    category: 'Sculpture',
    fields: [
      {
        key: 'material',
        label: 'Material',
        placeholder: 'Bronze, marble, wood…',
      },
      {
        key: 'dimensions',
        label: 'Dimensions',
        placeholder: 'Height × width × depth, with units',
      },
    ],
  },
  ceramics: {
    category: 'Ceramics',
    fields: [
      {
        key: 'clayBody',
        label: 'Clay body',
        placeholder: 'Stoneware, porcelain, earthenware…',
      },
      {
        key: 'finish',
        label: 'Finish',
        placeholder: 'Glaze, decoration, or unglazed',
      },
    ],
  },
  photography: {
    category: 'Photography',
    fields: [
      {
        key: 'process',
        label: 'Photographic process',
        placeholder: 'Albumen print, digital capture…',
      },
      {
        key: 'dimensions',
        label: 'Dimensions',
        placeholder: 'Print or image dimensions, with units',
      },
    ],
  },
  printmaking: {
    category: 'Printmaking',
    fields: [
      {
        key: 'technique',
        label: 'Print technique',
        placeholder: 'Woodblock, etching, lithography…',
      },
      { key: 'support', label: 'Surface', placeholder: 'Paper, fabric…' },
    ],
  },
  textile: {
    category: 'Textile',
    fields: [
      { key: 'fibers', label: 'Fibers', placeholder: 'Wool, silk, cotton…' },
      {
        key: 'technique',
        label: 'Textile technique',
        placeholder: 'Weaving, embroidery, tapestry…',
      },
    ],
  },
} as const;

export type ArtForm = keyof typeof artForms;
export type ArtDetails = {
  [K in ArtForm]: { type: K } & Record<
    (typeof artForms)[K]['fields'][number]['key'],
    string
  >;
}[ArtForm];

export function artFormForCategory(category: string): ArtForm | undefined {
  return (Object.keys(artForms) as ArtForm[]).find(
    (key) => artForms[key].category === category,
  );
}

export function artDetailFacts(details?: ArtDetails) {
  if (!details) return [];
  return artForms[details.type].fields.map((field) => ({
    label: field.label,
    value: (details as unknown as Record<string, string>)[field.key],
  }));
}
