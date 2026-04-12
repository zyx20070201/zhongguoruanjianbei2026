export class Listeners {
    constructor(target) {
        this.target = target;
        this.listeners = [];
        this.add = (eventName, handler, options) => {
            this.target.addEventListener(eventName, handler, options);
            this.listeners.push([eventName, handler, options]);
        };
        this.removeAll = () => {
            this.listeners.forEach(listener => this.target.removeEventListener(...listener));
        };
    }
}
//# sourceMappingURL=listeners.js.map