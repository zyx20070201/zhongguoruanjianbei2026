import { effect } from '@preact/signals-core';
import { SurfaceBlockModel } from '../gfx/model/surface/surface-model.js';
export function onSurfaceAdded(doc, callback) {
    let found = false;
    let foundId = '';
    const dispose = effect(() => {
        // if the surface is already found, no need to search again
        if (found && doc.getBlock(foundId)) {
            return;
        }
        for (const block of Object.values(doc.blocks.value)) {
            if (block.model instanceof SurfaceBlockModel) {
                callback(block.model);
                found = true;
                foundId = block.id;
                return;
            }
        }
        callback(null);
    });
    return dispose;
}
//# sourceMappingURL=gfx.js.map