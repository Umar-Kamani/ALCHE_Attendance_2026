import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buttonVariantClasses } from '../src/components/ui/Button';
import { statusToneClasses } from '../src/components/ui/StatusPill';

const SRC = resolve(process.cwd(), 'src');
const COLOUR_PATTERN = /#(?:[0-9a-fA-F]{3,4}){1,2}\b|rgba?\(|hsla?\(/;
const ALLOWED = resolve(SRC, 'styles/theme.css');

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

describe('design contract', () => {
  it('contains no raw colours outside the single theme file', async () => {
    const files = await walk(SRC);
    const violations: string[] = [];
    for (const file of files) {
      if (resolve(file) === ALLOWED) continue;
      const content = await readFile(file, 'utf8');
      if (COLOUR_PATTERN.test(content)) violations.push(relative(process.cwd(), file));
    }
    expect(violations).toEqual([]);
  });

  it('maps every semantic state to the sanctioned DESIGN palette', () => {
    expect(statusToneClasses.PRESENT).toBe('bg-mint text-forest');
    expect(statusToneClasses.FREE).toBe('bg-mint text-forest');
    expect(statusToneClasses.ON_SITE).toBe('bg-aqua text-ink');
    expect(statusToneClasses.OCCUPIED).toBe('bg-aqua text-ink');
    expect(statusToneClasses.MISSING_IN).toBe('bg-error-surface text-error-ink');
    expect(statusToneClasses.OVERDUE).toBe('bg-error-surface text-error-ink');
    expect(statusToneClasses.ABSENT).toBe('bg-shadow-dust text-slate');
    expect(statusToneClasses.INACTIVE).toBe('bg-shadow-dust text-slate');
    expect(statusToneClasses.NEUTRAL).toBe('bg-periwinkle-wash text-ink');
  });

  it('keeps filled and outlined buttons on the correct visual tokens', () => {
    expect(buttonVariantClasses.filled).toContain('bg-monday-violet');
    expect(buttonVariantClasses.filled).toContain('text-snow');
    expect(buttonVariantClasses.outlined).toContain('border-slate');
    expect(buttonVariantClasses.outlined).toContain('text-ink');
    expect(buttonVariantClasses.text).toContain('text-slate');
  });
});
