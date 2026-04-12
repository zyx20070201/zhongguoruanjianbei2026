import { nothing } from 'lit';
import { WidgetBase } from '../../../../core/widget/widget-base.js';
export declare class DataViewHeaderToolsSort extends WidgetBase {
    static styles: import("lit").CSSResult;
    sortUtils$: import("@preact/signals-core").ReadonlySignal<import("../../../../core/sort/utils.js").SortUtils | undefined>;
    hasSort: import("@preact/signals-core").ReadonlySignal<boolean>;
    private get readonly();
    private clickSort;
    connectedCallback(): void;
    render(): import("lit-html").TemplateResult<1> | typeof nothing;
    toggleShowQuickSettingBar(show?: boolean): void;
}
declare global {
    interface HTMLElementTagNameMap {
        'data-view-header-tools-sort': DataViewHeaderToolsSort;
    }
}
//# sourceMappingURL=sort.d.ts.map