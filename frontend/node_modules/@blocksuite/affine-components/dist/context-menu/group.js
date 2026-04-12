import { unsafeCSSVarV2 } from '@blocksuite/affine-shared/theme';
import { IS_MOBILE } from '@blocksuite/global/env';
import { html } from 'lit';
export const menuGroupItems = {
    group: (config) => (menu, index) => {
        const items = menu.renderItems(config.items);
        if (!items.length) {
            return;
        }
        if (IS_MOBILE) {
            return html ` <div
        style="
          display: flex;
          flex-direction: column;
          background-color: ${unsafeCSSVarV2('layer/background/primary')};
          padding: 4px;
          border-radius: 12px;
"
      >
        ${items}
      </div>`;
        }
        const result = html ` ${index === 0
            ? ''
            : html ` <div
            style="height: 0.5px;background-color: var(--affine-divider-color);margin: 4px 0"
          ></div>`}
      <div style="display: flex;flex-direction: column;gap:4px">${items}</div>`;
        return result;
    },
};
//# sourceMappingURL=group.js.map