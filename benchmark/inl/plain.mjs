// benchmark/inl/plain.mjs -- inlining-budget-diff.sh driver: the 'plain' BlockedArray variant
// (benchmark/rivals/variant.mjs) through the shared loop of ./drive.mjs (g2b-3a TASK 2).
// MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>. Repo-only. ASCII only.

import { drive } from './drive.mjs';

await drive('plain');
