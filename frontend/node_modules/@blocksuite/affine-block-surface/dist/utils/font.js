import { IS_FIREFOX } from '@blocksuite/global/env';
export function wrapFontFamily(fontFamily) {
    return `"${fontFamily}"`;
}
export const getFontFaces = IS_FIREFOX
    ? () => {
        const keys = document.fonts.keys();
        const fonts = [];
        let done = false;
        while (!done) {
            const item = keys.next();
            done = !!item.done;
            if (item.value) {
                fonts.push(item.value);
            }
        }
        return fonts;
    }
    : () => [...document.fonts.keys()];
export const isSameFontFamily = IS_FIREFOX
    ? (fontFamily) => (fontFace) => fontFace.family === `"${fontFamily}"`
    : (fontFamily) => (fontFace) => fontFace.family === fontFamily;
export function getFontFacesByFontFamily(fontFamily) {
    return (getFontFaces()
        .filter(isSameFontFamily(fontFamily))
        // remove duplicate font faces
        .filter((item, index, arr) => arr.findIndex(fontFace => fontFace.family === item.family &&
        fontFace.weight === item.weight &&
        fontFace.style === item.style) === index));
}
//# sourceMappingURL=font.js.map