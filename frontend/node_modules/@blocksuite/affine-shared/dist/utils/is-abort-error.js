export function isAbortError(error) {
    return error instanceof Error && error.name === 'AbortError';
}
//# sourceMappingURL=is-abort-error.js.map