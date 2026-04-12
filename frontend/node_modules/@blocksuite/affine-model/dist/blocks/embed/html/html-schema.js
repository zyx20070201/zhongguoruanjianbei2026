import { createEmbedBlockSchema } from '../../../utils/index.js';
import { EmbedHtmlModel, EmbedHtmlStyles, } from './html-model.js';
const defaultEmbedHtmlProps = {
    style: EmbedHtmlStyles[0],
    caption: null,
    html: undefined,
    design: undefined,
};
export const EmbedHtmlBlockSchema = createEmbedBlockSchema({
    name: 'html',
    version: 1,
    toModel: () => new EmbedHtmlModel(),
    props: () => defaultEmbedHtmlProps,
});
//# sourceMappingURL=html-schema.js.map