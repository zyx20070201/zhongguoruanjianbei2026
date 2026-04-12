export function findInfiniteLoop(root, nodeMap) {
    const visited = new Set();
    const loop = [];
    const traverse = (node, traverseChain = [], detached = false) => {
        if (visited.has(node.id)) {
            loop.push({
                detached,
                chain: traverseChain,
            });
            return;
        }
        visited.add(node.id);
        traverseChain.push(node);
        node.children.forEach(child => traverse(child, traverseChain.slice(), detached));
    };
    traverse(root);
    nodeMap.forEach(node => {
        if (visited.has(node.id)) {
            return;
        }
        traverse(node, [], true);
    });
    return loop;
}
//# sourceMappingURL=utils.js.map