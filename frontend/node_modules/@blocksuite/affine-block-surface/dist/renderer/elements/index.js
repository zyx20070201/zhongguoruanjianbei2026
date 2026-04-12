import { brush } from './brush/index.js';
import { connector } from './connector/index.js';
import { group } from './group/index.js';
import { mindmap } from './mindmap.js';
import { shape } from './shape/index.js';
import { text } from './text/index.js';
export { normalizeShapeBound } from './shape/utils.js';
export const elementRenderers = {
    brush,
    connector,
    group,
    shape,
    text,
    mindmap,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
};
//# sourceMappingURL=index.js.map