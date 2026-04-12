import type { JSXElement } from '../../utils/jsx.js';
export interface TestAddon {
    importDocSnapshot: (json: unknown, docId: string) => Promise<void>;
    exportJSX: (blockId?: string, docId?: string) => JSXElement;
}
export declare const test: import("./shared.js").AddOnReturn<keyof TestAddon>;
//# sourceMappingURL=test.d.ts.map