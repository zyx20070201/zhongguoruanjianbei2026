import { BlockSuiteError } from '@blocksuite/global/exceptions';
export declare class MigrationError extends BlockSuiteError {
    constructor(description: string);
}
export declare class SchemaValidateError extends BlockSuiteError {
    constructor(flavour: string, message: string);
}
//# sourceMappingURL=error.d.ts.map