import type { nothing, TemplateResult } from 'lit';
export type MenuItemPart = {
    action: () => void;
    disabled?: boolean;
    render?: (item: MenuItem) => TemplateResult<1>;
};
export type MenuItem = {
    type: string;
    label?: string;
    tooltip?: string;
    icon?: TemplateResult<1>;
} & MenuItemPart;
export type AdvancedMenuItem<T> = Omit<MenuItem, 'action' | 'disabled'> & {
    action?: (context: T) => void | Promise<void>;
    disabled?: boolean | ((context: T) => boolean);
    when?: (context: T) => boolean;
    generate?: (context: T) => MenuItemPart | void;
};
export type MenuItemGroup<T> = {
    type: string;
    items: AdvancedMenuItem<T>[];
    when?: (context: T) => boolean;
};
export type FatMenuItems = (MenuItem | typeof nothing)[][];
//# sourceMappingURL=types.d.ts.map