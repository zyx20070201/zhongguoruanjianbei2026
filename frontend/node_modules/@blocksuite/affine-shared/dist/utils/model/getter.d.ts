import type { BlockComponent, EditorHost } from '@blocksuite/block-std';
import type { BlockModel, Doc } from '@blocksuite/store';
import { type NoteBlockModel } from '@blocksuite/affine-model';
export declare function findAncestorModel(model: BlockModel, match: (m: BlockModel) => boolean): BlockModel<object, object & {}> | null;
/**
 * Get block component by its model and wait for the doc element to finish updating.
 *
 */
export declare function asyncGetBlockComponent(editorHost: EditorHost, id: string): Promise<BlockComponent | null>;
export declare function findNoteBlockModel(model: BlockModel): NoteBlockModel | null;
export declare function getLastNoteBlock(doc: Doc): NoteBlockModel | null;
//# sourceMappingURL=getter.d.ts.map