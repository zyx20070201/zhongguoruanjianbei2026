import { createEmbedBlockSchema } from '../../../utils/index.js';
import { EmbedYoutubeModel, EmbedYoutubeStyles, } from './youtube-model.js';
const defaultEmbedYoutubeProps = {
    style: EmbedYoutubeStyles[0],
    url: '',
    caption: null,
    image: null,
    title: null,
    description: null,
    creator: null,
    creatorUrl: null,
    creatorImage: null,
    videoId: null,
};
export const EmbedYoutubeBlockSchema = createEmbedBlockSchema({
    name: 'youtube',
    version: 1,
    toModel: () => new EmbedYoutubeModel(),
    props: () => defaultEmbedYoutubeProps,
});
//# sourceMappingURL=youtube-schema.js.map