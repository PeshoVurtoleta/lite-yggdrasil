/**
 * @zakkster/lite-yggdrasil -- ambient type smoke test (tsc -p test/types/tsconfig.json).
 *
 * Pre-release scaffold: the only export is `VERSION`. ASCII-only.
 */

import { VERSION } from '../../Yggdrasil.js';

// VERSION is a string.
const v: string = VERSION;
void v;

// @ts-expect-error -- VERSION is not a number.
const n: number = VERSION;
void n;
