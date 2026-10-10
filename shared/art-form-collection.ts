import { artFormImages } from './art-form-images.js';
import { collectionImages, type CollectionImage } from './collection-images.js';
import type { ArtDetails } from './art-forms.js';

export const artFormCollection: {
  image: CollectionImage;
  details: ArtDetails;
}[] = [
  {
    image: collectionImages[6],
    details: { type: 'painting', paint: 'Oil', support: 'Canvas' },
  },
  {
    image: collectionImages[23],
    details: { type: 'painting', paint: 'Pastel', support: 'Paper' },
  },
  {
    image: artFormImages[0],
    details: {
      type: 'sculpture',
      material: 'Bronze',
      dimensions: 'Height: 70.2 cm',
    },
  },
  {
    image: artFormImages[1],
    details: {
      type: 'sculpture',
      material: 'Bronze',
      dimensions: '174 × 52.1 × 59.7 cm',
    },
  },
  {
    image: artFormImages[2],
    details: {
      type: 'ceramics',
      clayBody: 'Stoneware',
      finish: 'Black decoration under turquoise glaze (Cizhou-type ware)',
    },
  },
  {
    image: artFormImages[3],
    details: {
      type: 'photography',
      process: 'Albumen silver print from glass negative',
      dimensions: '40.0 × 52.4 cm',
    },
  },
  {
    image: artFormImages[4],
    details: {
      type: 'printmaking',
      technique: 'Woodblock print; ink and color',
      support: 'Paper',
    },
  },
  {
    image: artFormImages[5],
    details: {
      type: 'textile',
      fibers: 'Wool warp; wool, silk, silver, and gilt wefts',
      technique: 'Tapestry weaving',
    },
  },
];
