export function createEmbedBlockPlainTextAdapterMatcher(flavour, { toMatch = () => false, fromMatch = o => o.node.flavour === flavour, toBlockSnapshot = {}, fromBlockSnapshot = {
    enter: (o, context) => {
        const { textBuffer } = context;
        // Parse as link
        if (typeof o.node.props.title !== 'string' ||
            typeof o.node.props.url !== 'string') {
            return;
        }
        const buffer = `[${o.node.props.title}](${o.node.props.url})`;
        if (buffer.length > 0) {
            textBuffer.content += buffer;
            textBuffer.content += '\n';
        }
    },
}, } = {}) {
    return {
        flavour,
        toMatch,
        fromMatch,
        toBlockSnapshot,
        fromBlockSnapshot,
    };
}
//# sourceMappingURL=plain-text.js.map