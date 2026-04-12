import { createEmbedBlockSchema } from '../../../utils/index.js';
import { EmbedGithubModel, EmbedGithubStyles, } from './github-model.js';
const defaultEmbedGithubProps = {
    style: EmbedGithubStyles[1],
    owner: '',
    repo: '',
    githubType: 'issue',
    githubId: '',
    url: '',
    caption: null,
    image: null,
    status: null,
    statusReason: null,
    title: null,
    description: null,
    createdAt: null,
    assignees: null,
};
export const EmbedGithubBlockSchema = createEmbedBlockSchema({
    name: 'github',
    version: 1,
    toModel: () => new EmbedGithubModel(),
    props: () => defaultEmbedGithubProps,
});
//# sourceMappingURL=github-schema.js.map