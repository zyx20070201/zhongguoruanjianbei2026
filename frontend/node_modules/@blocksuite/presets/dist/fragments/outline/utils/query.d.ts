import type { BlockModel, Doc } from '@blocksuite/store';
import { type NoteBlockModel, type NoteDisplayMode, type ParagraphBlockModel, type RootBlockModel } from '@blocksuite/blocks';
type OutlineNoteItem = {
    note: NoteBlockModel;
    /**
     * the index of the note inside its parent's children property
     */
    index: number;
    /**
     * the number displayed on the outline panel
     */
    number: number;
};
export declare function getNotesFromDoc(doc: Doc, modes: NoteDisplayMode[]): OutlineNoteItem[];
export declare function isRootBlock(block: BlockModel): block is RootBlockModel;
export declare function isHeadingBlock(block: BlockModel): block is ParagraphBlockModel;
export declare function getHeadingBlocksFromNote(note: NoteBlockModel, ignoreEmpty?: boolean): BlockModel<object, object & {}>[];
export declare function getHeadingBlocksFromDoc(doc: Doc, modes: NoteDisplayMode[], ignoreEmpty?: boolean): BlockModel<object, object & {}>[];
export {};
//# sourceMappingURL=query.d.ts.map