export function createEmbedBlockMarkdownAdapterMatcher(flavour, { toMatch = () => false, fromMatch = o => o.node.flavour === flavour, toBlockSnapshot = {}, fromBlockSnapshot = {
    enter: (o, context) => {
        const { walkerContext } = context;
        // Parse as link
        if (typeof o.node.props.title !== 'string' ||
            typeof o.node.props.url !== 'string') {
            return;
        }
        walkerContext
            .openNode({
            type: 'paragraph',
            children: [],
        }, 'children')
            .openNode({
            type: 'link',
            url: o.node.props.url,
            children: [
                {
                    type: 'text',
                    value: o.node.props.title,
                },
            ],
        }, 'children')
            .closeNode()
            .closeNode();
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
//# sourceMappingURL=markdown.js.map