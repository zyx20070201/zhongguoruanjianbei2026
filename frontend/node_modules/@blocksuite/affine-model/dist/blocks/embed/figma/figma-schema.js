import { createEmbedBlockSchema } from '../../../utils/index.js';
import { EmbedFigmaModel, EmbedFigmaStyles, } from './figma-model.js';
const defaultEmbedFigmaProps = {
    style: EmbedFigmaStyles[0],
    url: '',
    caption: null,
    title: null,
    description: null,
};
export const EmbedFigmaBlockSchema = createEmbedBlockSchema({
    name: 'figma',
    version: 1,
    toModel: () => new EmbedFigmaModel(),
    props: () => defaultEmbedFigmaProps,
});
//# sourceMappingURL=figma-schema.js.map