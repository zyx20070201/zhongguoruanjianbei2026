import type { AttributePart } from 'lit';
import { type PartInfo } from 'lit/directive.js';
export type DataName = {
    dataset: string;
    attribute: string;
};
export declare const createDataDirective: <T extends DataName[]>(...names: T) => (...values: { [K in keyof T]: string; }) => import("lit-html/directive.js").DirectiveResult<{
    new (partInfo: PartInfo): {
        render(..._ids: { [K in keyof T]: string; }): unknown;
        update(part: AttributePart, ids: string[]): unknown;
        readonly _$isConnected: boolean;
    };
}>;
//# sourceMappingURL=data-directive.d.ts.map