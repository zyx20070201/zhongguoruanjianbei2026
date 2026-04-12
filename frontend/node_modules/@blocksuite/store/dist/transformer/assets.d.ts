interface BlobCRUD {
    get: (key: string) => Promise<Blob | null> | Blob | null;
    set: (key: string, value: Blob) => Promise<string> | string;
    delete: (key: string) => Promise<void> | void;
    list: () => Promise<string[]> | string[];
}
type AssetsManagerConfig = {
    blob: BlobCRUD;
};
export declare class AssetsManager {
    private readonly _assetsMap;
    private readonly _blob;
    private readonly _names;
    private readonly _pathBlobIdMap;
    constructor(options: AssetsManagerConfig);
    cleanup(): void;
    getAssets(): Map<string, Blob>;
    getPathBlobIdMap(): Map<string, string>;
    isEmpty(): boolean;
    readFromBlob(blobId: string): Promise<void>;
    writeToBlob(blobId: string): Promise<void>;
}
export {};
//# sourceMappingURL=assets.d.ts.map