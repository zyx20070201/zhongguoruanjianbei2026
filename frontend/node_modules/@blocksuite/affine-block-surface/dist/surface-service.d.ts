import { BlockService } from '@blocksuite/block-std';
import { type SurfaceBlockModel } from './surface-model.js';
export declare class SurfaceBlockService extends BlockService {
    static readonly flavour: "affine:surface";
    surface: SurfaceBlockModel;
    get layer(): import("@blocksuite/block-std/gfx").LayerManager;
    mounted(): void;
}
//# sourceMappingURL=surface-service.d.ts.map