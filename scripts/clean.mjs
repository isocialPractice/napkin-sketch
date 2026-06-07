// Removes the dist/ build output directory.
import { rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, '..', 'dist');

await rm(dist, { recursive: true, force: true });
console.log('napkin-sketch: cleaned dist/.');
