import { LifeCycleWatcher } from '../extension/index.js';
import { BlockServiceIdentifier } from '../identifier.js';
export class ServiceManager extends LifeCycleWatcher {
    static { this.key = 'serviceManager'; }
    mounted() {
        super.mounted();
        this.std.provider.getAll(BlockServiceIdentifier).forEach(service => {
            service.mounted();
        });
    }
    unmounted() {
        super.unmounted();
        this.std.provider.getAll(BlockServiceIdentifier).forEach(service => {
            service.unmounted();
        });
    }
}
//# sourceMappingURL=index.js.map