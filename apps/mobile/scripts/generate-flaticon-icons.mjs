import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';

// Keep licensed outlines out of source control; recreate only the four app icons.
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const source = {
  package: '@flaticon/flaticon-uicons',
  version: '3.3.1',
  tarball: 'https://registry.npmjs.org/@flaticon/flaticon-uicons/-/flaticon-uicons-3.3.1.tgz',
  integrity: 'sha512-WN2zuECCdjuGBQrjzN0kpeSygzC5fgF8Q7pDR+FUuGtYWczSdIhIwoD+/fKBEfwqKfNIMZ1WouidevGQ4OJORg==',
  fontFile: 'css/uicons-regular-rounded-KDJ23353.woff',
  fontSha256: 'c9e3358cf771c721cd813ba8eafacf328e15f593570d8152176e5609f0da5efe',
  convertedWith: 'fontkit 2.0.4',
};
const codepoints = {
  newspaper: 'f9a5',
  camping: 'f34a',
  'calendar-check': 'f324',
  user: 'fea0',
};

const packageFile = require.resolve(`${source.package}/package.json`);
const installed = JSON.parse(readFileSync(packageFile, 'utf8'));
if (installed.version !== source.version) {
  throw new Error(`Expected ${source.package}@${source.version}; run npm ci.`);
}
const packageRoot = dirname(packageFile);
const bytes = readFileSync(join(packageRoot, source.fontFile));
if (createHash('sha256').update(bytes).digest('hex') !== source.fontSha256) {
  throw new Error('Flaticon font integrity check failed. Do not use modified outlines.');
}

const css = readFileSync(join(packageRoot, 'css/regular/rounded.css'), 'utf8');
const font = fontkit.create(bytes);
if (font.unitsPerEm !== 300) throw new Error('Unexpected Flaticon coordinate grid.');
const paths = {};
for (const [name, hex] of Object.entries(codepoints)) {
  const definition = new RegExp(`\\.fi-rr-${name}:before\\s*\\{content:\\s*["']\\\\([0-9a-f]+)["']`, 'i');
  if (css.match(definition)?.[1].toLowerCase() !== hex) {
    throw new Error(`Flaticon codepoint changed for ${name}.`);
  }
  const codepoint = Number.parseInt(hex, 16);
  if (!font.hasGlyphForCodePoint(codepoint)) throw new Error(`Missing icon: ${name}`);
  paths[name] = font.glyphForCodePoint(codepoint).path.toSVG();
  if (!paths[name]) throw new Error(`Empty icon: ${name}`);
}

const output = join(root, 'assets/icons/flaticon/regular-rounded.json');
const json = `${JSON.stringify({
  source,
  viewBox: '0 0 300 300',
  transform: 'translate(0 300) scale(1 -1)',
  codepoints,
  paths,
}, null, 2)}\n`;
mkdirSync(dirname(output), { recursive: true });
let existing;
try {
  existing = readFileSync(output, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (existing !== json) writeFileSync(output, json);
console.log('Flaticon: verified source and generated 4 Regular Rounded icons.');
