export declare function almostEqual(a: number, b: number, epsilon?: number): boolean;
export declare function clamp(value: number, min: number, max: number): number;
export declare function rangeWrap(n: number, min: number, max: number): number;
/**
 * Format bytes as human-readable text.
 *
 * @param bytes Number of bytes.
 * @param si True to use metric (SI) units, aka powers of 1000. False to use
 *           binary (IEC), aka powers of 1024.
 * @param dp Number of decimal places to display.
 *
 * @return Formatted string.
 *
 * Credit: https://stackoverflow.com/questions/10420352/converting-file-size-in-bytes-to-human-readable-string
 */
export declare function humanFileSize(bytes: number, si?: boolean, dp?: number): string;
//# sourceMappingURL=math.d.ts.map