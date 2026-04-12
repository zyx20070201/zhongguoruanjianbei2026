export type IdGenerator = () => string;
export declare function createAutoIncrementIdGenerator(): IdGenerator;
export declare function createAutoIncrementIdGeneratorByClientId(clientId: number): IdGenerator;
export declare const uuidv4: IdGenerator;
export declare const nanoid: IdGenerator;
//# sourceMappingURL=id-generator.d.ts.map