// User rule + ADR-001: only root README.md may be tracked as Markdown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('only README.md tracked among *.md', () => {
  const md = execFileSync('git', ['ls-files', '--cached', '--', '*.md', '*.MD'], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
  assert.deepEqual(md.filter((f) => f !== 'README.md'), []);
});
