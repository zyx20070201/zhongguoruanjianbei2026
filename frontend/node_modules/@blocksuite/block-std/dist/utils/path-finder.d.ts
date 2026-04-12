export declare class PathFinder {
    static equals: (path1: readonly string[], path2: readonly string[]) => boolean;
    static id: (path: readonly string[]) => string;
    static includes: (path1: string[], path2: string[]) => boolean;
    static keyToPath: (key: string) => string[];
    static parent: (path: readonly string[]) => string[];
    static pathToKey: (path: readonly string[]) => string;
    private constructor();
}
//# sourceMappingURL=path-finder.d.ts.map