type PriorityQueueNode<T, K> = {
    value: T;
    priority: K;
};
export declare class PriorityQueue<T, K> {
    private _compare;
    heap: PriorityQueueNode<T, K>[];
    constructor(_compare: (a: K, b: K) => number);
    bubbleDown(): void;
    bubbleUp(index?: number): void;
    dequeue(): T | null;
    empty(): boolean;
    enqueue(value: T, priority: K): void;
}
export {};
//# sourceMappingURL=priority-queue.d.ts.map