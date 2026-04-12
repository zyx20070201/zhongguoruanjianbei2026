export type InsertToPosition = 'end' | 'start' | {
    id: string;
    before: boolean;
};
export declare function insertPositionToIndex<T extends {
    id: string;
}>(position: InsertToPosition, arr: T[]): number;
export declare function insertPositionToIndex<T>(position: InsertToPosition, arr: T[], key: (value: T) => string): number;
export declare const arrayMove: <T>(arr: T[], from: (t: T) => boolean, to: (arr: T[]) => number) => T[];
//# sourceMappingURL=insert.d.ts.map