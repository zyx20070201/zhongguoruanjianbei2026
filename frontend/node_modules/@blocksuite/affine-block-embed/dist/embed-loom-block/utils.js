import { isAbortError } from '@blocksuite/affine-shared/utils';
const LoomOEmbedEndpoint = 'https://www.loom.com/v1/oembed';
export async function queryEmbedLoomData(embedLoomModel, signal) {
    const url = embedLoomModel.url;
    const loomEmbedData = await queryLoomOEmbedData(url, signal);
    return loomEmbedData;
}
export async function queryLoomOEmbedData(url, signal) {
    let loomOEmbedData = {};
    const oEmbedUrl = `${LoomOEmbedEndpoint}?url=${url}`;
    const oEmbedResponse = await fetch(oEmbedUrl, { signal }).catch(() => null);
    if (oEmbedResponse && oEmbedResponse.ok) {
        const oEmbedJson = await oEmbedResponse.json();
        const { title, description, thumbnail_url: image } = oEmbedJson;
        loomOEmbedData = {
            title,
            description,
            image,
        };
    }
    return loomOEmbedData;
}
export async function refreshEmbedLoomUrlData(embedLoomElement, signal) {
    let title = null, description = null, image = null;
    try {
        embedLoomElement.loading = true;
        const queryUrlData = embedLoomElement.service?.queryUrlData;
        if (!queryUrlData)
            return;
        const loomUrlData = await queryUrlData(embedLoomElement.model);
        ({ title = null, description = null, image = null } = loomUrlData);
        if (signal?.aborted)
            return;
        embedLoomElement.doc.updateBlock(embedLoomElement.model, {
            title,
            description,
            image,
        });
    }
    catch (error) {
        if (signal?.aborted || isAbortError(error))
            return;
    }
    finally {
        embedLoomElement.loading = false;
    }
}
//# sourceMappingURL=utils.js.map