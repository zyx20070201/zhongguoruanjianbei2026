import { html, nothing } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { join } from 'lit/directives/join.js';
import { repeat } from 'lit/directives/repeat.js';
export function groupsToActions(groups, context) {
    return groups
        .filter(group => group.when?.(context) ?? true)
        .map(({ items }) => items
        .filter(item => item.when?.(context) ?? true)
        .map(({ type, label, tooltip, icon, action, disabled, generate }) => {
        if (action && typeof action === 'function') {
            return {
                type,
                label,
                tooltip,
                icon,
                action: () => {
                    action(context)?.catch(console.error);
                },
                disabled: typeof disabled === 'function' ? disabled(context) : disabled,
            };
        }
        if (generate && typeof generate === 'function') {
            const result = generate(context);
            if (!result)
                return;
            return {
                type,
                label,
                tooltip,
                icon,
                ...result,
            };
        }
        return;
    })
        .filter(item => !!item));
}
export function renderActions(fatMenuItems, action, selectedName) {
    return join(fatMenuItems
        .filter(g => g.length)
        .map(g => g.filter(a => a !== nothing))
        .filter(g => g.length)
        .map(items => repeat(items, item => item.type, item => item.render?.(item) ??
        html `
              <editor-menu-action
                class=${ifDefined(item.type === 'delete' ? 'delete' : undefined)}
                aria-label=${ifDefined(item.label)}
                ?data-selected=${selectedName === item.label}
                ?disabled=${item.disabled}
                @click=${item.action ? item.action : () => action?.(item)}
              >
                ${item.icon}${item.label
            ? html `<span class="label">${item.label}</span>`
            : nothing}
              </editor-menu-action>
            `)), () => html `
      <editor-toolbar-separator
        data-orientation="horizontal"
      ></editor-toolbar-separator>
    `);
}
export function cloneGroups(groups) {
    return groups.map(group => ({ ...group, items: [...group.items] }));
}
export function renderGroups(groups, context) {
    return renderActions(groupsToActions(groups, context));
}
export function renderToolbarSeparator() {
    return html `<editor-toolbar-separator></editor-toolbar-separator>`;
}
//# sourceMappingURL=utils.js.map