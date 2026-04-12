import { assertExists } from '@blocksuite/global/utils';
import { serializeYDoc, yDocToJSXNode } from '../../utils/jsx.js';
import { addOnFactory } from './shared.js';
export const test = addOnFactory(originalClass => class extends originalClass {
    /** @internal Only for testing */
    exportJSX(blockId, docId = this.meta.docMetas.at(0)?.id) {
        assertExists(docId);
        const doc = this.doc.spaces.get(docId);
        assertExists(doc);
        const docJson = serializeYDoc(doc);
        if (!docJson) {
            throw new Error(`Doc ${docId} doesn't exist`);
        }
        const blockJson = docJson.blocks;
        if (!blockId) {
            const rootId = Object.keys(blockJson).at(0);
            if (!rootId) {
                return null;
            }
            blockId = rootId;
        }
        if (!blockJson[blockId]) {
            return null;
        }
        return yDocToJSXNode(blockJson, blockId);
    }
});
//# sourceMappingURL=test.js.map