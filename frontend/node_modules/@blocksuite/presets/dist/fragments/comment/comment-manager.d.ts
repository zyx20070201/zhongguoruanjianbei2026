import type { EditorHost, TextSelection } from '@blocksuite/block-std';
import { type Y } from '@blocksuite/store';
export interface CommentMeta {
    id: string;
    date: number;
}
export interface CommentRange {
    start: {
        id: string;
        index: Y.RelativePosition;
    };
    end: {
        id: string;
        index: Y.RelativePosition;
    };
}
export interface CommentContent {
    quote: string;
    author: string;
    text: Y.Text;
}
export type Comment = CommentMeta & CommentRange & CommentContent;
export declare class CommentManager {
    readonly host: EditorHost;
    private get _command();
    get commentsMap(): Y.Map<Y.Map<unknown>>;
    constructor(host: EditorHost);
    addComment(selection: TextSelection, payload: Pick<CommentContent, 'author' | 'text'>): Comment;
    getComments(): Comment[];
    parseTextSelection(selection: TextSelection): {
        quote: CommentContent['quote'];
        range: CommentRange;
    } | null;
}
//# sourceMappingURL=comment-manager.d.ts.map