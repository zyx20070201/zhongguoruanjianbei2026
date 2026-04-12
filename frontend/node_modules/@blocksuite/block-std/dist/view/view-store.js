import { LifeCycleWatcher } from '../extension/index.js';
export class ViewStore extends LifeCycleWatcher {
    constructor() {
        super(...arguments);
        this._blockMap = new Map();
        this._fromId = (blockId) => {
            const id = blockId ?? this.std.doc.root?.id;
            if (!id) {
                return null;
            }
            return this._blockMap.get(id) ?? null;
        };
        this._widgetMap = new Map();
        this.deleteBlock = (node) => {
            this._blockMap.delete(node.id);
        };
        this.deleteWidget = (node) => {
            const id = node.dataset.widgetId;
            const widgetIndex = `${node.model.id}|${id}`;
            this._widgetMap.delete(widgetIndex);
        };
        this.getBlock = (id) => {
            return this._blockMap.get(id) ?? null;
        };
        this.getWidget = (widgetName, hostBlockId) => {
            const widgetIndex = `${hostBlockId}|${widgetName}`;
            return this._widgetMap.get(widgetIndex) ?? null;
        };
        this.setBlock = (node) => {
            this._blockMap.set(node.model.id, node);
        };
        this.setWidget = (node) => {
            const id = node.dataset.widgetId;
            const widgetIndex = `${node.model.id}|${id}`;
            this._widgetMap.set(widgetIndex, node);
        };
        this.walkThrough = (fn, blockId) => {
            const top = this._fromId(blockId);
            if (!top) {
                return;
            }
            const iterate = (parent) => (node, index) => {
                const result = fn(node, index, parent);
                if (result === true) {
                    return;
                }
                const children = node.model.children;
                children.forEach(child => {
                    const childNode = this._blockMap.get(child.id);
                    if (childNode) {
                        iterate(node)(childNode, children.indexOf(child));
                    }
                });
            };
            top.model.children.forEach(child => {
                const childNode = this._blockMap.get(child.id);
                if (childNode) {
                    iterate(childNode)(childNode, top.model.children.indexOf(child));
                }
            });
        };
    }
    static { this.key = 'viewStore'; }
    unmounted() {
        this._blockMap.clear();
        this._widgetMap.clear();
    }
}
//# sourceMappingURL=view-store.js.map