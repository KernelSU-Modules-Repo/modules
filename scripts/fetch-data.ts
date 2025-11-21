import fs from 'fs';
import path from 'path';
import { GraphQLClient, gql } from 'graphql-request';
import ellipsize from 'ellipsize';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true
});

const PAGINATION = 10;
const GRAPHQL_TOKEN = process.env.GRAPHQL_TOKEN;

if (!GRAPHQL_TOKEN) {
  console.error('Error: GRAPHQL_TOKEN environment variable is not set.');
  process.exit(1);
}

const client = new GraphQLClient('https://api.github.com/graphql', {
  headers: {
    authorization: `Bearer ${GRAPHQL_TOKEN}`,
  },
});

const makeRepositoryQuery = (name: string) => gql`
{
  repository(owner: "KernelSU-Modules-Repo", name: "${name}") {
    name
    description
    url
    homepageUrl
    collaborators(affiliation: DIRECT, first: 100) {
      edges {
        node {
          login
          name
        }
      }
    }
    readme: object(expression: "HEAD:README.md") {
      ... on Blob {
        text
      }
    }
    moduleJson: object(expression: "HEAD:module.json") {
      ... on Blob {
        text
      }
    }
    latestRelease {
      name
      url
      isDraft
      description
      descriptionHTML
      createdAt
      publishedAt
      updatedAt
      tagName
      isPrerelease
      releaseAssets(first: 50) {
        edges {
          node {
            name
            contentType
            downloadUrl
            downloadCount
            size
          }
        }
      }
    }
    releases(first: 20) {
      edges {
        node {
          name
          url
          isDraft
          description
          descriptionHTML
          createdAt
          publishedAt
          updatedAt
          tagName
          isPrerelease
          isLatest
          releaseAssets(first: 50) {
            edges {
              node {
                name
                contentType
                downloadUrl
                downloadCount
                size
              }
            }
          }
        }
      }
    }
    updatedAt
    createdAt
    stargazerCount
  }
}
`;

const makeRepositoriesQuery = (cursor: string | null) => {
  const arg = cursor ? `, after: "${cursor}"` : '';
  return gql`
{
  organization(login: "KernelSU-Modules-Repo") {
    repositories(first: ${PAGINATION}${arg}, orderBy: {field: UPDATED_AT, direction: DESC}, privacy: PUBLIC) {
      edges {
        node {
          name
          description
          url
          homepageUrl
          collaborators(affiliation: DIRECT, first: 100) {
            edges {
              node {
                login
                name
              }
            }
          }
          readme: object(expression: "HEAD:README.md") {
            ... on Blob {
              text
            }
          }
          moduleJson: object(expression: "HEAD:module.json") {
            ... on Blob {
              text
            }
          }
          latestRelease {
            name
            url
            isDraft
            description
            descriptionHTML
            createdAt
            publishedAt
            updatedAt
            tagName
            isPrerelease
            releaseAssets(first: 50) {
              edges {
                node {
                  name
                  contentType
                  downloadUrl
                  downloadCount
                  size
                }
              }
            }
          }
          releases(first: 20) {
            edges {
              node {
                name
                url
                isDraft
                description
                descriptionHTML
                createdAt
                publishedAt
                updatedAt
                tagName
                isPrerelease
                isLatest
                releaseAssets(first: 50) {
                  edges {
                    node {
                      name
                      contentType
                      downloadUrl
                      downloadCount
                      size
                    }
                  }
                }
              }
            }
          }
          updatedAt
          createdAt
          stargazerCount
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      totalCount
    }
  }
}`;
};

const REGEX_PUBLIC_IMAGES = /https:\/\/github\.com\/[a-zA-Z0-9-]+\/[\w\-.]+\/assets\/\d+\/([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})/g;

function replacePrivateImage(markdown: string, html: string) {
  if (!markdown) return html;
  const publicMatches = new Map();
  for (const match of markdown.matchAll(REGEX_PUBLIC_IMAGES)) {
    publicMatches.set(match[0], match[1]);
  }
  for (const [url, id] of publicMatches) {
    const regexPrivateImages = new RegExp(`https:\\/\\/private-user-images\\.githubusercontent\\.com\\/\\d+\\/\\d+-${id}\\..*?(?=")`, 'g');
    html = html.replaceAll(regexPrivateImages, url);
  }
  return html;
}

function parseRepositoryObject(repo: any) {
  // Process module.json
  if (repo.moduleJson) {
    try {
      const moduleData = JSON.parse(repo.moduleJson.text);

      if (moduleData.summary && typeof moduleData.summary === 'string') {
        repo.summary = ellipsize(moduleData.summary.trim(), 512).trim();
      }

      if (moduleData.sourceUrl && typeof moduleData.sourceUrl === 'string') {
        repo.sourceUrl = moduleData.sourceUrl.replace(/[\r\n]/g, '').trim();
      }

      if (moduleData.additionalAuthors instanceof Array) {
        const validAuthors = [];
        const authorsToRemove = new Set<string>();

        for (const author of moduleData.additionalAuthors) {
          if (author && typeof author === 'object') {
            if (author.type === 'remove' && author.name) {
              authorsToRemove.add(author.name);
              continue;
            }

            const validAuthor: any = {};
            for (const key of Object.keys(author)) {
              if (['type', 'name', 'link'].includes(key)) {
                validAuthor[key] = author[key];
              }
            }
            validAuthors.push(validAuthor);
          }
        }
        repo.additionalAuthors = validAuthors;

        // Filter out removed authors from collaborators
        if (repo.collaborators && repo.collaborators.edges) {
          repo.collaborators.edges = repo.collaborators.edges.filter(({ node }: any) =>
            !authorsToRemove.has(node.login) && !authorsToRemove.has(node.name)
          );
        }
      }
    } catch (e: any) {
      console.log(`Failed to parse module.json for ${repo.name}: ${e.message}`);
    }
  }

  if (repo.readme) {
    repo.readme = repo.readme.text;
  }

  if (repo.scope) {
    try {
      repo.scope = JSON.parse(repo.scope.text);
    } catch (e) {
      repo.scope = null;
    }
  }

  if (repo.releases) {
    if (repo.latestRelease) {
      repo.releases.edges = [{ node: repo.latestRelease }, ...repo.releases.edges];
    }
    repo.releases.edges = repo.releases.edges
      .filter(({ node: { releaseAssets, isDraft, isLatest, tagName } }: any) =>
        !isLatest && !isDraft && releaseAssets && tagName.match(/^\d+-.+$/) && releaseAssets.edges
          .some(({ node: { contentType } }: any) => contentType === 'application/zip'));
  }

  repo.isModule = !!(repo.name.match(/^[a-zA-Z][a-zA-Z0-9._-]+$/) &&
    repo.description &&
    repo.releases &&
    repo.releases.edges.length &&
    !['.github', 'submission', 'developers', 'modules'].includes(repo.name));

  if (repo.isModule) {
    for (const release of repo.releases.edges) {
      release.node.descriptionHTML = replacePrivateImage(release.node.description, release.node.descriptionHTML || '');
    }
    repo.latestRelease = repo.releases.edges.find(({ node: { isPrerelease } }: any) => !isPrerelease);
    repo.latestReleaseTime = '1970-01-01T00:00:00Z';
    if (repo.latestRelease) {
      repo.latestRelease = repo.latestRelease.node;
      repo.latestReleaseTime = repo.latestRelease.publishedAt;
      repo.latestRelease.isLatest = true;
    }
    repo.latestBetaRelease = repo.releases.edges.find(({ node: { isPrerelease, name } }: any) => isPrerelease && !name.match(/^(snapshot|nightly).*/i)) || { node: repo.latestRelease };
    repo.latestBetaReleaseTime = '1970-01-01T00:00:00Z';
    if (repo.latestBetaRelease) {
      repo.latestBetaRelease = repo.latestBetaRelease.node;
      repo.latestBetaReleaseTime = repo.latestBetaRelease.publishedAt;
      repo.latestBetaRelease.isLatestBeta = true;
    }
    repo.latestSnapshotRelease = repo.releases.edges.find(({ node: { isPrerelease, name } }: any) => isPrerelease && name.match(/^(snapshot|nightly).*/i)) || { node: repo.latestBetaRelease };
    repo.latestSnapshotReleaseTime = '1970-01-01T00:00:00Z';
    if (repo.latestSnapshotRelease) {
      repo.latestSnapshotRelease = repo.latestSnapshotRelease.node;
      repo.latestSnapshotReleaseTime = repo.latestSnapshotRelease.publishedAt;
      repo.latestSnapshotRelease.isLatestSnapshot = true;
    }
  } else {
    console.log(`Repo ${repo.name} rejected.`);
  }
  console.log(`Got repo: ${repo.name}, is module: ${repo.isModule}`);
  return repo;
}

function flatten(object: any) {
  for (const key of Object.keys(object)) {
    if (object[key] !== null && object[key] !== undefined && typeof object[key] === 'object') {
      if (object[key].edges) {
        object[key] = object[key].edges.map((edge: any) => edge.node);
      }
    }
    if (object[key] !== null && object[key] !== undefined && typeof object[key] === 'object') {
      flatten(object[key]);
    }
  }
}

async function main() {
  let cursor = null;
  let page = 1;
  let total = 0;
  let mergedResult: any = {
    data: {
      organization: {
        repositories: {
          edges: []
        }
      }
    }
  };

  const repo_name = process.env.REPO ? process.env.REPO.split('/')[1] : null;
  const cachePath = path.resolve('../cached_graphql.json'); // Use parent directory cache for now or migrate it

  if (repo_name && fs.existsSync(cachePath)) {
    const data = fs.readFileSync(cachePath, 'utf-8');
    mergedResult = JSON.parse(data);
    mergedResult.data.organization.repositories.edges = mergedResult.data.organization.repositories.edges.filter((value: any) => value.node.name !== repo_name);

    console.log(`Fetching ${repo_name} from GitHub API`);
    const result: any = await client.request(makeRepositoryQuery(repo_name));
    mergedResult.data.organization.repositories.edges.unshift({ 'node': result.repository });
  } else {
    while (true) {
      console.log(`Querying GitHub API, page ${page}, total ${Math.ceil(total / PAGINATION) || 'unknown'}, cursor: ${cursor}`);
      const result: any = await client.request(makeRepositoriesQuery(cursor));

      mergedResult.data.organization.repositories.edges =
        mergedResult.data.organization.repositories.edges.concat(result.organization.repositories.edges);

      if (!result.organization.repositories.pageInfo.hasNextPage) {
        break;
      }
      cursor = result.organization.repositories.pageInfo.endCursor;
      total = result.organization.repositories.totalCount;
      page++;
    }
  }

  // Save cache
  fs.writeFileSync(cachePath, JSON.stringify(mergedResult, null, 2));

  // Process and Generate Output
  const modules = [];
  const rawRepos = mergedResult.data.organization.repositories.edges.map((edge: any) => edge.node);

  for (let repo of rawRepos) {
    // Deep copy to avoid mutating cache
    repo = JSON.parse(JSON.stringify(repo));
    repo = parseRepositoryObject(repo);

    if (repo.isModule) {
      // Generate Readme HTML
      if (repo.readme) {
        repo.readmeHTML = md.render(repo.readme);
      }
      modules.push(repo);
    }
  }

  const rootPath = path.resolve('./public');
  if (!fs.existsSync(rootPath)) fs.mkdirSync(rootPath, { recursive: true });

  const contentPath = path.resolve('./src/content/modules');
  if (!fs.existsSync(contentPath)) fs.mkdirSync(contentPath, { recursive: true });

  const finalModules = [];

  for (const repo of modules) {
    // Flatten edges first
    if (repo.collaborators && repo.collaborators.edges) {
      repo.collaborators = repo.collaborators.edges.map((e: any) => e.node);
    }
    if (repo.releases && repo.releases.edges) {
      repo.releases = repo.releases.edges.map((e: any) => e.node);
      repo.releases.forEach((release: any) => {
        if (release.releaseAssets && release.releaseAssets.edges) {
          release.releaseAssets = release.releaseAssets.edges.map((e: any) => e.node);
        }
      });
    }

    // Deduplicate authors
    // 1. Filter out 'remove' types from collaborators
    // 2. Remove duplicates from additionalAuthors if they are already in collaborators
    if (repo.additionalAuthors) {
      const authorsToRemove = new Set(repo.additionalAuthors.filter((a: any) => a.type === 'remove').map((a: any) => a.name));

      if (repo.collaborators) {
        repo.collaborators = repo.collaborators.filter((c: any) => !authorsToRemove.has(c.name) && !authorsToRemove.has(c.login));
      }

      // Filter additionalAuthors to only keep 'add' (or undefined type) and remove duplicates
      const existingNames = new Set(repo.collaborators ? repo.collaborators.map((c: any) => c.name || c.login) : []);
      repo.additionalAuthors = repo.additionalAuthors.filter((a: any) => {
        if (a.type === 'remove') return false;
        if (existingNames.has(a.name)) return false;
        existingNames.add(a.name);
        return true;
      });
    }

    const modulePath = path.join(rootPath, 'module');
    if (!fs.existsSync(modulePath)) fs.mkdirSync(modulePath, { recursive: true });

    const latestRelease = repo.latestRelease;
    const latestBetaRelease = repo.latestBetaRelease;
    const latestSnapshotRelease = repo.latestSnapshotRelease;

    // Prepare repo object for individual JSON (Full releases list)
    const repoForJson = JSON.parse(JSON.stringify(repo));

    repoForJson.latestRelease = latestRelease ? latestRelease.tagName : undefined;
    repoForJson.latestBetaRelease = latestBetaRelease && repoForJson.latestRelease !== latestBetaRelease.tagName ? latestBetaRelease.tagName : undefined;
    repoForJson.latestSnapshotRelease = latestSnapshotRelease && repoForJson.latestBetaRelease !== latestSnapshotRelease.tagName && repoForJson.latestRelease !== latestSnapshotRelease.tagName ? latestSnapshotRelease.tagName : undefined;

    fs.writeFileSync(`${modulePath}/${repo.name}.json`, JSON.stringify(repoForJson, null, 2));
    // Also write to src/content/modules for Astro Content Collections
    fs.writeFileSync(`${contentPath}/${repo.name}.json`, JSON.stringify(repoForJson, null, 2));

    // Prepare repo object for modules.json list (Single release in array)
    // Modify repo in place for the list
    repo.latestRelease = latestRelease ? latestRelease.tagName : undefined;
    repo.latestBetaRelease = latestBetaRelease && repo.latestRelease !== latestBetaRelease.tagName ? latestBetaRelease.tagName : undefined;
    repo.latestSnapshotRelease = latestSnapshotRelease && repo.latestBetaRelease !== latestSnapshotRelease.tagName && repo.latestRelease !== latestSnapshotRelease.tagName ? latestSnapshotRelease.tagName : undefined;

    repo.releases = latestRelease ? [latestRelease] : [];
    if (repo.latestBetaRelease) {
      repo.betaReleases = [latestBetaRelease];
    }
    if (repo.latestSnapshotRelease) {
      repo.snapshotReleases = [latestSnapshotRelease];
    }

    // Clean up
    delete repo.readme;
    delete repo.moduleJson;
    delete repo.childGitHubReadme;

    finalModules.push(repo);
  }

  fs.writeFileSync(`${rootPath}/modules.json`, JSON.stringify(finalModules, null, 2));

  // Generate lightweight search index
  const searchIndex = finalModules.map(m => ({
    name: m.name,
    description: m.description,
    summary: m.summary,
    authors: [
      ...(m.collaborators?.map((c: any) => c.name || c.login) || []),
      ...(m.additionalAuthors?.map((a: any) => a.name) || [])
    ].join(' '),
    url: `/module/${m.name}`
  }));
  fs.writeFileSync(`${rootPath}/search-index.json`, JSON.stringify(searchIndex));

  console.log(`Generated ${finalModules.length} modules and search index.`);
}

main().catch(console.error);
