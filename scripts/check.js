import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import pug from 'pug';
import { rootDirectory } from '../lib/config.js';

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter(
        (entry) =>
          !['node_modules', '.git', 'uploads', 'coverage'].includes(entry.name),
      )
      .map((entry) => {
        const filename = path.join(directory, entry.name);
        return entry.isDirectory() ? filesIn(filename) : [filename];
      }),
  );
  return files.flat();
}

let count = 0;
for (const filename of await filesIn(rootDirectory)) {
  if (filename.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', filename], {
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      console.error(result.stderr);
      process.exit(1);
    }
    count++;
  } else if (filename.endsWith('.pug')) {
    pug.compileFile(filename);
    count++;
  }
}
console.log(`Syntax and template checks passed (${count} files).`);
