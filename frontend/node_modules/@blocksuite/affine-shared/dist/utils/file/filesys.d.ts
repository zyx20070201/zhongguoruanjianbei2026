interface OpenFilePickerOptions {
    types?: {
        description?: string | undefined;
        accept: Record<string, string | string[]>;
    }[] | undefined;
    excludeAcceptAllOption?: boolean | undefined;
    multiple?: boolean | undefined;
}
declare global {
    interface Window {
        showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
    }
}
/**
 * See https://web.dev/patterns/files/open-one-or-multiple-files/
 */
type AcceptTypes = 'Any' | 'Images' | 'Videos' | 'Audios' | 'Markdown' | 'Html' | 'Zip' | 'MindMap';
export declare function openFileOrFiles(options?: {
    acceptType?: AcceptTypes;
}): Promise<File | null>;
export declare function openFileOrFiles(options: {
    acceptType?: AcceptTypes;
    multiple: false;
}): Promise<File | null>;
export declare function openFileOrFiles(options: {
    acceptType?: AcceptTypes;
    multiple: true;
}): Promise<File[] | null>;
export declare function getImageFilesFromLocal(): Promise<File[]>;
export declare function downloadBlob(blob: Blob, name: string): void;
/**
 * Because the image block and attachment block have different props.
 * We need to save some data temporarily when converting between them to ensure no data is lost.
 *
 * For example, before converting from an image block to an attachment block,
 * we need to save the image's width and height.
 *
 * Similarly, when converting from an attachment block to an image block,
 * we need to save the attachment's name.
 *
 * See also https://github.com/toeverything/blocksuite/pull/4583#pullrequestreview-1610662677
 *
 * @internal
 */
export declare function withTempBlobData(): {
    saveAttachmentData: (sourceId: string, data: {
        name: string;
    }) => void;
    getAttachmentData: (blockId: string) => {
        name: string;
    } | undefined;
    saveImageData: (sourceId: string, data: {
        width: number | undefined;
        height: number | undefined;
    }) => void;
    getImageData: (blockId: string) => {
        width: number | undefined;
        height: number | undefined;
    } | undefined;
};
export {};
//# sourceMappingURL=filesys.d.ts.map