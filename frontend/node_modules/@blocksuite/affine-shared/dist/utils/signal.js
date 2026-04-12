import { signal } from '@preact/signals-core';
export function createSignalFromObservable(observable$, initValue) {
    const newSignal = signal(initValue);
    const subscription = observable$.subscribe(value => {
        newSignal.value = value;
    });
    return {
        signal: newSignal,
        cleanup: () => subscription.unsubscribe(),
    };
}
export {} from '@preact/signals-core';
//# sourceMappingURL=signal.js.map