import { Slot } from '@blocksuite/global/utils';
export const getSlots = () => {
    return {
        mounted: new Slot(),
        unmounted: new Slot(),
        viewConnected: new Slot(),
        viewDisconnected: new Slot(),
        widgetConnected: new Slot(),
        widgetDisconnected: new Slot(),
    };
};
//# sourceMappingURL=slots.js.map