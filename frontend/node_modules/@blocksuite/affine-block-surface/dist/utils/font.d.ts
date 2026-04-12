import type { FontFamily } from '@blocksuite/affine-model';
export declare function wrapFontFamily(fontFamily: FontFamily | string): string;
export declare const getFontFaces: () => FontFace[];
export declare const isSameFontFamily: (fontFamily: FontFamily | string) => (fontFace: FontFace) => boolean;
export declare function getFontFacesByFontFamily(fontFamily: FontFamily | string): FontFace[];
//# sourceMappingURL=font.d.ts.map