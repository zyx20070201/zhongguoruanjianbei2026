import { LifeCycleWatcher } from '@blocksuite/block-std';
import { createIdentifier } from '@blocksuite/global/di';
import { IS_FIREFOX } from '@blocksuite/global/env';
const initFontFace = IS_FIREFOX
    ? ({ font, weight, url, style }) => new FontFace(`"${font}"`, `url(${url})`, {
        weight,
        style,
    })
    : ({ font, weight, url, style }) => new FontFace(font, `url(${url})`, {
        weight,
        style,
    });
export class FontLoaderService extends LifeCycleWatcher {
    constructor() {
        super(...arguments);
        this.fontFaces = [];
    }
    static { this.key = 'font-loader'; }
    get ready() {
        return Promise.all(this.fontFaces.map(fontFace => fontFace.loaded));
    }
    load(fonts) {
        this.fontFaces.push(...fonts.map(font => {
            const fontFace = initFontFace(font);
            document.fonts.add(fontFace);
            fontFace.load().catch(console.error);
            return fontFace;
        }));
    }
    mounted() {
        const config = this.std.getOptional(FontConfigIdentifier);
        if (config) {
            this.load(config);
        }
    }
    unmounted() {
        this.fontFaces.forEach(fontFace => document.fonts.delete(fontFace));
        this.fontFaces.splice(0, this.fontFaces.length);
    }
}
export const FontConfigIdentifier = createIdentifier('AffineFontConfig');
export const FontConfigExtension = (fontConfig) => ({
    setup: di => {
        di.addImpl(FontConfigIdentifier, () => fontConfig);
    },
});
//# sourceMappingURL=font-loader-service.js.map