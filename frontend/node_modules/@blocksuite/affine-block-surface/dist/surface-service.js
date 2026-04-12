import { BlockService } from '@blocksuite/block-std';
import { GfxControllerIdentifier } from '@blocksuite/block-std/gfx';
import { SurfaceBlockSchema } from './surface-model.js';
export class SurfaceBlockService extends BlockService {
    static { this.flavour = SurfaceBlockSchema.model.flavour; }
    get layer() {
        return this.std.get(GfxControllerIdentifier).layer;
    }
    mounted() {
        super.mounted();
        this.surface = this.doc.getBlockByFlavour('affine:surface')[0];
        if (!this.surface) {
            const disposable = this.doc.slots.blockUpdated.on(payload => {
                if (payload.flavour === 'affine:surface') {
                    disposable.dispose();
                    const surface = this.doc.getBlockById(payload.id);
                    if (!surface)
                        return;
                    this.surface = surface;
                }
            });
        }
    }
}
//# sourceMappingURL=surface-service.js.map