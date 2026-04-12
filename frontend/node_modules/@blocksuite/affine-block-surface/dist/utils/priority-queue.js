export class PriorityQueue {
    constructor(_compare) {
        this._compare = _compare;
        this.heap = [];
    }
    bubbleDown() {
        let index = 0;
        const length = this.heap.length;
        const element = this.heap[0];
        for (;;) {
            const leftChildIndex = 2 * index + 1;
            const rightChildIndex = 2 * index + 2;
            let swap = -1;
            let leftChild, rightChild;
            if (leftChildIndex < length) {
                leftChild = this.heap[leftChildIndex];
                if (this._compare(leftChild.priority, element.priority) < 0) {
                    swap = leftChildIndex;
                }
            }
            if (rightChildIndex < length) {
                leftChild = this.heap[leftChildIndex];
                rightChild = this.heap[rightChildIndex];
                if ((swap === null &&
                    this._compare(rightChild.priority, element.priority) < 0) ||
                    (swap !== null &&
                        this._compare(rightChild.priority, leftChild.priority) < 0)) {
                    swap = rightChildIndex;
                }
            }
            if (swap === -1)
                break;
            this.heap[index] = this.heap[swap];
            this.heap[swap] = element;
            index = swap;
        }
    }
    bubbleUp(index = this.heap.length - 1) {
        const element = this.heap[index];
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            const parent = this.heap[parentIndex];
            if (this._compare(parent.priority, element.priority) <= 0)
                break;
            this.heap[parentIndex] = element;
            this.heap[index] = parent;
            index = parentIndex;
        }
    }
    dequeue() {
        const min = this.heap[0];
        const end = this.heap.pop();
        if (this.heap.length > 0 && end) {
            this.heap[0] = end;
            this.bubbleDown();
        }
        return min?.value ?? null;
    }
    empty() {
        return this.heap.length === 0;
    }
    enqueue(value, priority) {
        const node = { value, priority };
        this.heap.push(node);
        this.bubbleUp();
    }
}
//# sourceMappingURL=priority-queue.js.map