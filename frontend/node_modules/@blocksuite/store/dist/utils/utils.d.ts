import type { z } from 'zod';
import type { BlockModel, BlockSchema } from '../schema/base.js';
import type { YBlock } from '../store/doc/block/index.js';
import type { BlockProps } from '../store/doc/block-collection.js';
export declare function syncBlockProps(schema: z.infer<typeof BlockSchema>, model: BlockModel, yBlock: YBlock, props: Partial<BlockProps>): void;
export declare const hash: (str: string) => number;
//# sourceMappingURL=utils.d.ts.map