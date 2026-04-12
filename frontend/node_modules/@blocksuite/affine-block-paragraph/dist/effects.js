import { effects as ParagraphHeadingIconEffects } from './heading-icon.js';
import { ParagraphBlockComponent } from './paragraph-block.js';
export function effects() {
    ParagraphHeadingIconEffects();
    customElements.define('affine-paragraph', ParagraphBlockComponent);
}
//# sourceMappingURL=effects.js.map