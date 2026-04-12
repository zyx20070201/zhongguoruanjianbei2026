export function almostEqual(a, b, epsilon = 0.0001) {
    return Math.abs(a - b) < epsilon;
}
export function clamp(value, min, max) {
    if (value < min)
        return min;
    if (value > max)
        return max;
    return value;
}
export function rangeWrap(n, min, max) {
    max = max - min;
    n = (n - min + max) % max;
    return min + (Number.isNaN(n) ? 0 : n);
}
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
export function humanFileSize(bytes, si = true, dp = 1) {
    const thresh = si ? 1000 : 1024;
    if (Math.abs(bytes) < thresh) {
        return bytes + ' bytes';
    }
    const units = si
        ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
        : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    let u = -1;
    const r = 10 ** dp;
    do {
        bytes /= thresh;
        ++u;
    } while (Math.round(Math.abs(bytes) * r) / r >= thresh &&
        u < units.length - 1);
    return bytes.toFixed(dp) + ' ' + units[u];
}
//# sourceMappingURL=math.js.map