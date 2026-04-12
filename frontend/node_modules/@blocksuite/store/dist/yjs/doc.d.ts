import type { Transaction } from 'yjs';
import * as Y from 'yjs';
export type BlockSuiteDocAllowedValue = Record<string, unknown> | unknown[] | Y.Text;
export type BlockSuiteDocData = Record<string, BlockSuiteDocAllowedValue>;
export declare class BlockSuiteDoc extends Y.Doc {
    private _spaces;
    get spaces(): Y.Map<Y.Doc>;
    getArrayProxy<Key extends keyof BlockSuiteDocData & string, Value extends unknown[] = BlockSuiteDocData[Key] extends unknown[] ? BlockSuiteDocData[Key] : never>(key: Key): Value;
    getMapProxy<Key extends keyof BlockSuiteDocData & string, Value extends Record<string, unknown> = BlockSuiteDocData[Key] extends Record<string, unknown> ? BlockSuiteDocData[Key] : never>(key: Key): Value;
    toJSON(): Record<string, any>;
    transact<T>(f: (arg0: Transaction) => T, origin?: number | string): T;
}
//# sourceMappingURL=doc.d.ts.map