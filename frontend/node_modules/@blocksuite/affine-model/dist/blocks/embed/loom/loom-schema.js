import { createEmbedBlockSchema } from '../../../utils/index.js';
import { EmbedLoomModel, EmbedLoomStyles, } from './loom-model.js';
const defaultEmbedLoomProps = {
    style: EmbedLoomStyles[0],
    url: '',
    caption: null,
    image: null,
    title: null,
    description: null,
    videoId: null,
};
export const EmbedLoomBlockSchema = createEmbedBlockSchema({
    name: 'loom',
    version: 1,
    toModel: () => new EmbedLoomModel(),
    props: () => defaultEmbedLoomProps,
});
//# sourceMappingURL=loom-schema.js.map