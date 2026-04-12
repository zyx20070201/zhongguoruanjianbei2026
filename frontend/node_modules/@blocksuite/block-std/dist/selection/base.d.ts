export type BaseSelectionOptions = {
    blockId: string;
};
export declare abstract class BaseSelection {
    static readonly group: string;
    static readonly type: string;
    readonly blockId: string;
    get group(): string;
    get type(): BlockSuite.SelectionType;
    constructor({ blockId }: BaseSelectionOptions);
    static fromJSON(_: Record<string, unknown>): BaseSelection;
    abstract equals(other: BaseSelection): boolean;
    is<T extends BlockSuite.SelectionType>(type: T): this is BlockSuite.SelectionInstance[T];
    abstract toJSON(): Record<string, unknown>;
}
//# sourceMappingURL=base.d.ts.map