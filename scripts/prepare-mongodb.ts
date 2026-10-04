import { readConfig } from '../server/src/config.js';
import { prepareMongoArtworks } from '../server/src/mongodb.js';
await prepareMongoArtworks(readConfig());
console.log('MongoDB artwork schema verified.');
