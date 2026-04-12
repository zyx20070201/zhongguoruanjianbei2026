export class PathFinder {
    static { this.equals = (path1, path2) => {
        return PathFinder.pathToKey(path1) === PathFinder.pathToKey(path2);
    }; }
    static { this.id = (path) => {
        return path[path.length - 1];
    }; }
    // check if path1 includes path2
    static { this.includes = (path1, path2) => {
        return PathFinder.pathToKey(path1).startsWith(PathFinder.pathToKey(path2));
    }; }
    static { this.keyToPath = (key) => {
        return key.split('|');
    }; }
    static { this.parent = (path) => {
        return path.slice(0, path.length - 1);
    }; }
    static { this.pathToKey = (path) => {
        return path.join('|');
    }; }
    constructor() {
        // this is a static class
    }
}
//# sourceMappingURL=path-finder.js.map