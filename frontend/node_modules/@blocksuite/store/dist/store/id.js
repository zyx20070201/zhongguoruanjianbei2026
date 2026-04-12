import { createAutoIncrementIdGenerator, createAutoIncrementIdGeneratorByClientId, nanoid, uuidv4, } from '../utils/id-generator.js';
export var IdGeneratorType;
(function (IdGeneratorType) {
    /**
     * **Warning**: This generator mode will crash the collaborative feature
     *  if multiple clients are adding new blocks.
     * Use this mode only if you know what you're doing.
     */
    IdGeneratorType["AutoIncrement"] = "autoIncrement";
    /**
     * This generator is trying to fix the real-time collaboration on debug mode.
     * This will make generator predictable and won't make conflict
     * @link https://docs.yjs.dev/api/faq#i-get-a-new-clientid-for-every-session-is-there-a-way-to-make-it-static-for-a-peer-accessing-the-doc
     */
    IdGeneratorType["AutoIncrementByClientId"] = "autoIncrementByClientId";
    /**
     * Default mode, generator for the unpredictable id
     */
    IdGeneratorType["NanoID"] = "nanoID";
    IdGeneratorType["UUIDv4"] = "uuidV4";
})(IdGeneratorType || (IdGeneratorType = {}));
export function pickIdGenerator(idGenerator, clientId) {
    if (typeof idGenerator === 'function') {
        return idGenerator;
    }
    switch (idGenerator) {
        case IdGeneratorType.AutoIncrement: {
            return createAutoIncrementIdGenerator();
        }
        case IdGeneratorType.AutoIncrementByClientId: {
            return createAutoIncrementIdGeneratorByClientId(clientId);
        }
        case IdGeneratorType.UUIDv4: {
            return uuidv4;
        }
        case IdGeneratorType.NanoID:
        default: {
            return nanoid;
        }
    }
}
//# sourceMappingURL=id.js.map