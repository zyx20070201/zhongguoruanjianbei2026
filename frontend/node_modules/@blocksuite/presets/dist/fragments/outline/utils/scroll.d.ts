import type { EditorHost } from '@blocksuite/block-std';
import { DisposableGroup } from '@blocksuite/global/utils';
import type { AffineEditorContainer } from '../../../editors/editor-container.js';
export declare function scrollToBlock(editor: AffineEditorContainer, blockId: string): void;
export declare function isBlockBeforeViewportCenter(blockId: string, editorHost: EditorHost): boolean;
export declare const observeActiveHeadingDuringScroll: (getEditor: () => AffineEditorContainer, update: (activeHeading: string | null) => void) => DisposableGroup;
export declare function scrollToBlockWithHighlight(editor: AffineEditorContainer, blockId: string, timeout?: number): Promise<() => void>;
//# sourceMappingURL=scroll.d.ts.map