import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { postgresTransitionSelectionSchema } from '@treeseed/sdk/deployment';

/** No credentials or file paths cross the manager boundary. Never echo invalid
 * JSON or schema values: an operator may accidentally select a secret file. */
export function readPostgresTransferSelection(file: string | undefined) {
  let descriptor: number | undefined;
  try {
    if (!file) throw new Error();
    descriptor = openSync(resolve(file), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16_384) throw new Error();
    const bytes = readFileSync(descriptor);
    try {
      if (bytes.length > 16_384) throw new Error();
      return postgresTransitionSelectionSchema.parse(JSON.parse(bytes.toString('utf8')));
    } finally { bytes.fill(0); }
  } catch {
    throw new Error('A regular JSON file containing an exact PostgreSQL transfer selection is required; no SQL, credentials, URLs or target paths are accepted.');
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}
