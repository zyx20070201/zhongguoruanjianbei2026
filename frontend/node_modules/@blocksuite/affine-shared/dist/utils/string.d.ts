/**
 * Checks if the name is a fuzzy match of the query.
 *
 * @example
 * ```ts
 * const name = 'John Smith';
 * const query = 'js';
 * const isMatch = isFuzzyMatch(name, query);
 * // isMatch: true
 * ```
 */
export declare function isFuzzyMatch(name: string, query: string): boolean;
/**
 * Calculate the score of the substring match.
 * s = [0.5, 1] if the query is a substring of the name
 * s = (0, 0.5) if there exists a common non-maximal length substring
 * s = 0 if there is no match
 *
 * s is greater if the query has a longer substring.
 */
export declare function substringMatchScore(name: string, query: string): number;
/**
 * Checks if the prefix is a markdown prefix.
 * Ex. 1. 2. 3. - * [] [ ] [x] # ## ### #### ##### ###### --- *** > ```
 */
export declare function isMarkdownPrefix(prefix: string): boolean;
//# sourceMappingURL=string.d.ts.map