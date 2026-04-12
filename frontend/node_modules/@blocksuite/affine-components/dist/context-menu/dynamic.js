import { html } from 'lit';
export const menuDynamicItems = {
    dynamic: (config) => menu => {
        const items = menu.renderItems(config());
        if (!items.length) {
            return;
        }
        const result = html `${items}`;
        return result;
    },
};
//# sourceMappingURL=dynamic.js.map