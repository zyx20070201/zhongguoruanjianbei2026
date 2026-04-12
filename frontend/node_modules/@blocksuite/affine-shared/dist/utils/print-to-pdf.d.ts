export declare function printToPdf(rootElement?: HTMLElement | null, options?: {
    /**
     * Callback that is called when ready to print.
     */
    beforeprint?: (iframe: HTMLIFrameElement) => Promise<void> | void;
    /**
     * Callback that is called after the print dialog is closed.
     * Notice: in some browser this may be triggered immediately.
     */
    afterprint?: () => Promise<void> | void;
}): Promise<void>;
//# sourceMappingURL=print-to-pdf.d.ts.map