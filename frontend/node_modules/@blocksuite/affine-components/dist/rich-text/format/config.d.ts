import type { EditorHost } from '@blocksuite/block-std';
import type { TemplateResult } from 'lit';
export interface TextFormatConfig {
    id: string;
    name: string;
    icon: TemplateResult<1>;
    hotkey?: string;
    activeWhen: (host: EditorHost) => boolean;
    action: (host: EditorHost) => void;
}
export declare const textFormatConfigs: TextFormatConfig[];
//# sourceMappingURL=config.d.ts.map