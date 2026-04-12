import type { ExtensionType } from '@blocksuite/block-std';
export declare class SpecBuilder {
    private _value;
    get value(): ExtensionType[];
    constructor(spec: ExtensionType[]);
    extend(extensions: ExtensionType[]): void;
}
//# sourceMappingURL=spec-builder.d.ts.map