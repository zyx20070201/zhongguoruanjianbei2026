import { BlockComponent } from '@blocksuite/block-std';
import type { SurfaceBlockModel } from './surface-model.js';
import type { SurfaceBlockService } from './surface-service.js';
export declare class SurfaceBlockVoidComponent extends BlockComponent<SurfaceBlockModel, SurfaceBlockService> {
    render(): symbol;
}
declare global {
    interface HTMLElementTagNameMap {
        'affine-surface-void': SurfaceBlockVoidComponent;
    }
}
//# sourceMappingURL=surface-block-void.d.ts.map