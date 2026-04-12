import * as Y from 'yjs';
export type OnBoxedChange = (data: unknown) => void;
export declare class Boxed<T = unknown> {
    static from: <T_1>(map: Y.Map<T_1>, onChange?: OnBoxedChange) => Boxed<T_1>;
    static is: (value: unknown) => value is Boxed;
    private readonly _map;
    private _onChange?;
    getValue: () => T | undefined;
    setValue: (value: T) => T;
    get yMap(): Y.Map<T>;
    constructor(value: T, onChange?: OnBoxedChange);
    bind(onChange: OnBoxedChange): void;
}
//# sourceMappingURL=boxed.d.ts.map