import { isAbortError } from '@blocksuite/affine-shared/utils';
import { assertExists } from '@blocksuite/global/utils';
import { nothing } from 'lit';
import { GithubIssueClosedFailureIcon, GithubIssueClosedSuccessIcon, GithubIssueOpenIcon, GithubPRClosedIcon, GithubPRDraftIcon, GithubPRMergedIcon, GithubPROpenIcon, } from './styles.js';
export async function queryEmbedGithubData(embedGithubModel, linkPreviewer, signal) {
    const [githubApiData, openGraphData] = await Promise.all([
        queryEmbedGithubApiData(embedGithubModel, signal),
        linkPreviewer.query(embedGithubModel.url, signal),
    ]);
    return { ...githubApiData, ...openGraphData };
}
export async function queryEmbedGithubApiData(embedGithubModel, signal) {
    const { owner, repo, githubType, githubId } = embedGithubModel;
    let githubApiData = {};
    // github's public api has a rate limit of 60 requests per hour
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/${githubType === 'issue' ? 'issues' : 'pulls'}/${githubId}`;
    const githubApiResponse = await fetch(apiUrl, {
        cache: 'no-cache',
        signal,
    }).catch(() => null);
    if (githubApiResponse && githubApiResponse.ok) {
        const githubApiJson = await githubApiResponse.json();
        const { state, state_reason, draft, merged, created_at, assignees } = githubApiJson;
        const assigneeLogins = assignees.map((assignee) => assignee.login);
        let status = state;
        if (merged) {
            status = 'merged';
        }
        else if (state === 'open' && draft) {
            status = 'draft';
        }
        githubApiData = {
            status,
            statusReason: state_reason,
            createdAt: created_at,
            assignees: assigneeLogins,
        };
    }
    return githubApiData;
}
export async function refreshEmbedGithubUrlData(embedGithubElement, signal) {
    let image = null, status = null, statusReason = null, title = null, description = null, createdAt = null, assignees = null;
    try {
        embedGithubElement.loading = true;
        const queryUrlData = embedGithubElement.service?.queryUrlData;
        assertExists(queryUrlData);
        const githubUrlData = await queryUrlData(embedGithubElement.model);
        ({
            image = null,
            status = null,
            statusReason = null,
            title = null,
            description = null,
            createdAt = null,
            assignees = null,
        } = githubUrlData);
        if (signal?.aborted)
            return;
        embedGithubElement.doc.updateBlock(embedGithubElement.model, {
            image,
            status,
            statusReason,
            title,
            description,
            createdAt,
            assignees,
        });
    }
    catch (error) {
        if (signal?.aborted || isAbortError(error))
            return;
        throw Error;
    }
    finally {
        embedGithubElement.loading = false;
    }
}
export async function refreshEmbedGithubStatus(embedGithubElement, signal) {
    const queryApiData = embedGithubElement.service?.queryApiData;
    assertExists(queryApiData);
    const githubApiData = await queryApiData(embedGithubElement.model, signal);
    if (!githubApiData.status || signal?.aborted)
        return;
    embedGithubElement.doc.updateBlock(embedGithubElement.model, {
        status: githubApiData.status,
        statusReason: githubApiData.statusReason,
        createdAt: githubApiData.createdAt,
        assignees: githubApiData.assignees,
    });
}
export function getGithubStatusIcon(type, status, statusReason) {
    if (type === 'issue') {
        if (status === 'open') {
            return GithubIssueOpenIcon;
        }
        else if (status === 'closed' && statusReason === 'completed') {
            return GithubIssueClosedSuccessIcon;
        }
        else if (status === 'closed' && statusReason === 'not_planned') {
            return GithubIssueClosedFailureIcon;
        }
        else {
            return nothing;
        }
    }
    else if (type === 'pr') {
        if (status === 'open') {
            return GithubPROpenIcon;
        }
        else if (status === 'draft') {
            return GithubPRDraftIcon;
        }
        else if (status === 'merged') {
            return GithubPRMergedIcon;
        }
        else if (status === 'closed') {
            return GithubPRClosedIcon;
        }
    }
    return nothing;
}
//# sourceMappingURL=utils.js.map