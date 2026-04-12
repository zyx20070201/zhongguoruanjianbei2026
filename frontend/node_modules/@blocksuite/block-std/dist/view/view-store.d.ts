import type { BlockComponent, WidgetComponent } from './element/index.js';
import { LifeCycleWatcher } from '../extension/index.js';
export declare class ViewStore extends LifeCycleWatcher {
    static readonly key = "viewStore";
    private readonly _blockMap;
    private _fromId;
    private readonly _widgetMap;
    deleteBlock: (node: BlockComponent) => void;
    deleteWidget: (node: WidgetComponent) => void;
    getBlock: (id: string) => BlockComponent | null;
    getWidget: (widgetName: string, hostBlockId: string) => WidgetComponent | null;
    setBlock: (node: BlockComponent) => void;
    setWidget: (node: WidgetComponent) => void;
    walkThrough: (fn: (nodeView: BlockComponent, index: number, parent: BlockComponent) => undefined | null | true, blockId?: string | undefined | null) => void;
    unmounted(): void;
}
//# sourceMappingURL=view-store.d.ts.map