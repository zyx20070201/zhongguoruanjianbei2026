import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../node_modules/@blocksuite', import.meta.url);
const relativeTargets = [
  'affine-block-embed/node_modules/@blocksuite/icons/dist/lit.mjs',
  'affine-components/node_modules/@blocksuite/icons/dist/lit.mjs',
  'affine-shared/node_modules/@blocksuite/icons/dist/lit.mjs',
  'blocks/node_modules/@blocksuite/icons/dist/lit.mjs',
  'data-view/node_modules/@blocksuite/icons/dist/lit.mjs'
];

const sourceLine = '  CheckBoxCheckSolid as CheckBoxCheckSolidIcon,';
const aliasLine = '  CheckBoxCheckSolid as CheckBoxCkeckSolidIcon,';

for (const relativeTarget of relativeTargets) {
  const filePath = path.join(root.pathname, relativeTarget);

  if (!fs.existsSync(filePath)) {
    continue;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  if (content.includes(aliasLine)) {
    continue;
  }

  if (!content.includes(sourceLine)) {
    continue;
  }

  fs.writeFileSync(filePath, content.replace(sourceLine, `${sourceLine}\n${aliasLine}`));
}
