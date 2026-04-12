import { Slot } from '@blocksuite/global/utils';
import type { BlockService } from '../extension/service.js';
import type { BlockComponent, WidgetComponent } from '../view/index.js';
export type BlockSpecSlots<Service extends BlockService = BlockService> = {
    mounted: Slot<{
        service: Service;
    }>;
    unmounted: Slot<{
        service: Service;
    }>;
    viewConnected: Slot<{
        component: BlockComponent;
        service: Service;
    }>;
    viewDisconnected: Slot<{
        component: BlockComponent;
        service: Service;
    }>;
    widgetConnected: Slot<{
        component: WidgetComponent;
        service: Service;
    }>;
    widgetDisconnected: Slot<{
        component: WidgetComponent;
        service: Service;
    }>;
};
export declare const getSlots: () => BlockSpecSlots;
//# sourceMappingURL=slots.d.ts.map