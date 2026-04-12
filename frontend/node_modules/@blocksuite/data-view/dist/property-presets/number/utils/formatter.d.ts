export type NumberFormat = 'number' | 'numberWithCommas' | 'percent' | 'currencyYen' | 'currencyINR' | 'currencyCNY' | 'currencyUSD' | 'currencyEUR' | 'currencyGBP';
export declare function formatNumber(value: number, format: NumberFormat, decimals?: number): string;
export declare function getLocaleDecimalSeparator(locale?: string): string;
export declare function parseNumber(value: string, decimalSeparator?: string): number;
//# sourceMappingURL=formatter.d.ts.map