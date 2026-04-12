export type MaybeDate = Date | string | number | undefined;
/**
 * Parse the given date to Date object
 * @param date
 * @returns
 */
export declare function toDate(date?: MaybeDate): Date;
/**
 * get the first day of the month of the given date
 * @param maybeDate
 */
export declare function getFirstDayOfMonth(maybeDate: MaybeDate): Date;
/**
 * get the last day of the month of the given date
 * @param maybeDate
 * @example
 * getLastDayOfMonth('2021-01-01') // 2021-01-31
 */
export declare function getLastDayOfMonth(maybeDate: MaybeDate): Date;
export declare function getMonthMatrix(maybeDate: MaybeDate): Date[][];
export declare function clamp(num1: number, num2: number, value: number): number;
//# sourceMappingURL=utils.d.ts.map