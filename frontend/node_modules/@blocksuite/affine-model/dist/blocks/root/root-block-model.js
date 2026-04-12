import { BlockModel, defineBlockSchema } from '@blocksuite/store';
export class RootBlockModel extends BlockModel {
    constructor() {
        super();
        this.created.once(() => {
            this.doc.slots.rootAdded.on(id => {
                const model = this.doc.getBlockById(id);
                if (model instanceof RootBlockModel) {
                    const newDocMeta = this.doc.collection.meta.getDocMeta(model.doc.id);
                    if (!newDocMeta || newDocMeta.title !== model.title.toString()) {
                        this.doc.collection.setDocMeta(model.doc.id, {
                            title: model.title.toString(),
                        });
                    }
                }
            });
        });
    }
}
export const RootBlockSchema = defineBlockSchema({
    flavour: 'affine:page',
    props: (internal) => ({
        title: internal.Text(),
    }),
    metadata: {
        version: 2,
        role: 'root',
    },
    toModel: () => new RootBlockModel(),
});
//# sourceMappingURL=root-block-model.js.map