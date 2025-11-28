import fs from 'fs';
import path from 'path';
import { GraphQLClient, gql } from 'graphql-request';
import ellipsize from 'ellipsize';
import MarkdownIt from 'markdown-it';

// Type definitions
type ReleaseAsset = {
  name: string;
  contentType: string;
  downloadUrl: string;
  downloadCount: number;
  size: number;
};

type GraphQlRelease = {
  name: string;
  url: string;
  isDraft: boolean;
  description: string;
  descriptionHTML: string;
  createdAt: string;
  publishedAt: string;
  updatedAt: string;
  tagName: string;
  isPrerelease: boolean;
  isLatest: boolean;
  releaseAssets: {
    edges: Array<{ node: ReleaseAsset }>;
  };
};

type GraphQlRepository = {
  name: string;
  description: string;
  url: string;
  homepageUrl?: string;
  collaborators: {
    edges: Array<{
      node: {
        login: string;
        name?: string;
      };
    }>;
  };
  readme?: { text: string };
  moduleJson?: { text: string };
  latestRelease?: GraphQlRelease;
  releases: {
    edges: Array<{ node: GraphQlRelease }>;
  };
  updatedAt: string;
  createdAt: string;
  stargazerCount: number;
};

type GraphQlRepositoryWrapped = {
  node: GraphQlRepository;
  cursor: string;
};

type ModuleRelease = {
  name: string;
  url: string;
  descriptionHTML: string;
  createdAt: string;
  publishedAt: string;
  updatedAt: string;
  tagName: string;
  isPrerelease: boolean;
  releaseAssets: ReleaseAsset[];
};

type ModuleJson = {
  moduleId: string;
  moduleName: string;
  url: string;
  homepageUrl: string | null;
  authors: Array<{ name: string; link: string }>;
  latestRelease: string | null;
  latestReleaseTime: string;
  latestBetaReleaseTime: string;
  latestSnapshotReleaseTime: string;
  releases: ModuleRelease[];
  readme: string | null;
  readmeHTML: string | null;
  summary: string | null;
  sourceUrl: string | null;
  updatedAt: string;
  createdAt: string;
  stargazerCount: number;
};

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

function replacePrivateImage(markdown: string, html: string): string {
  if (!markdown) return html;
  const publicMatches = new Map<string, string>();
  for (const match of markdown.matchAll(REGEX_PUBLIC_IMAGES)) {
    publicMatches.set(match[0], match[1]);
  }
  for (const [url, id] of publicMatches) {
    const regexPrivateImages = new RegExp(`https:\\/\\/private-user-images\\.githubusercontent\\.com\\/\\d+\\/\\d+-${id}\\..*?(?=")`, 'g');
    html = html.replaceAll(regexPrivateImages, url);
  }
  return html;
}

function convert2json(repo: GraphQlRepository): ModuleJson | null {
  // Merge latestRelease into releases if not present
  if (repo.latestRelease && !repo.releases.edges.find(r => r.node.tagName === repo.latestRelease?.tagName)) {
    repo.releases.edges.push({ node: repo.latestRelease });
  }

  // Filter and transform releases
  const releases: ModuleRelease[] = repo.releases.edges
    .filter(({ node }) =>
      !node.isDraft &&
      node.tagName.match(/^\d+-.+$/) &&
      node.releaseAssets?.edges.some(({ node: asset }) => asset.contentType === 'application/zip')
    )
    .map(({ node }) => ({
      name: node.name,
      url: node.url,
      descriptionHTML: replacePrivateImage(node.description, node.descriptionHTML),
      createdAt: node.createdAt,
      publishedAt: node.publishedAt,
      updatedAt: node.updatedAt,
      tagName: node.tagName,
      isPrerelease: node.isPrerelease,
      releaseAssets: node.releaseAssets.edges.map(({ node: asset }) => ({
        name: asset.name,
        contentType: asset.contentType,
        downloadUrl: asset.downloadUrl,
        downloadCount: asset.downloadCount,
        size: asset.size,
      })),
    }));

  // Check if this is a valid module
  const isModule = !!(
    repo.name.match(/^[a-zA-Z][a-zA-Z0-9._-]+$/) &&
    repo.description &&
    releases.length &&
    !['.github', 'submission', 'developers', 'modules', 'org.kernelsu.example'].includes(repo.name)
  );

  if (!isModule) {
    console.log(`skipped ${repo.name}`);
    return null;
  }
  console.log(`found ${repo.name}`);

  // Find latest releases by type
  const latestRelease = releases.find(v => !v.isPrerelease);
  const latestBetaRelease = releases.find(v => v.isPrerelease && !v.name.match(/^(snapshot|nightly).*/i)) || latestRelease;
  const latestSnapshotRelease = releases.find(v => v.isPrerelease && v.name.match(/^(snapshot|nightly).*/i)) || latestBetaRelease;

  // Generate README HTML
  const readmeText = repo.readme?.text?.trim() || null;
  const readmeHTML = readmeText ? md.render(readmeText) : null;

  // Parse module.json for additional metadata
  let summary: string | null = null;
  let sourceUrl: string | null = null;
  let additionalAuthors: Array<{ type?: string; name: string; link?: string }> = [];

  if (repo.moduleJson) {
    try {
      const moduleData = JSON.parse(repo.moduleJson.text);
      if (moduleData.summary && typeof moduleData.summary === 'string') {
        summary = ellipsize(moduleData.summary.trim(), 512).trim();
      }
      if (moduleData.sourceUrl && typeof moduleData.sourceUrl === 'string') {
        sourceUrl = moduleData.sourceUrl.replace(/[\r\n]/g, '').trim();
      }
      if (moduleData.additionalAuthors instanceof Array) {
        additionalAuthors = moduleData.additionalAuthors.filter((a: any) => a && typeof a === 'object');
      }
    } catch (e: any) {
      console.log(`Failed to parse module.json for ${repo.name}: ${e.message}`);
    }
  }

  // Build authors list
  const collaborators = repo.collaborators.edges.map(({ node }) => ({
    name: node.name || node.login,
    login: node.login,
  }));

  const authorsToRemove = new Set(
    additionalAuthors.filter(a => a.type === 'remove').map(a => a.name)
  );

  let authors = collaborators
    .filter(c => !authorsToRemove.has(c.name) && !authorsToRemove.has(c.login))
    .map(c => ({ name: c.name, link: `https://github.com/${c.login}` }));

  const existingNames = new Set(authors.map(a => a.name));
  for (const author of additionalAuthors.filter(a => a.type === 'add' || !a.type)) {
    if (!existingNames.has(author.name)) {
      authors.push({ name: author.name, link: author.link || '' });
      existingNames.add(author.name);
    }
  }

  return {
    moduleId: repo.name,
    moduleName: repo.description,
    url: repo.url,
    homepageUrl: repo.homepageUrl || null,
    authors,
    latestRelease: latestRelease?.name || null,
    latestReleaseTime: latestRelease?.publishedAt || '1970-01-01T00:00:00Z',
    latestBetaReleaseTime: latestBetaRelease?.publishedAt || '1970-01-01T00:00:00Z',
    latestSnapshotReleaseTime: latestSnapshotRelease?.publishedAt || '1970-01-01T00:00:00Z',
    releases,
    readme: readmeText,
    readmeHTML,
    summary,
    sourceUrl,
    updatedAt: repo.updatedAt,
    createdAt: repo.createdAt,
    stargazerCount: repo.stargazerCount,
  };
}

async function main() {
  const cacheDir = path.resolve('.cache');
  const graphqlCachePath = path.join(cacheDir, 'graphql.json');
  const modulesCachePath = path.join(cacheDir, 'modules.json');

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const modulePackage = process.env.REPO
    ? process.env.REPO.includes('/') ? process.env.REPO.split('/')[1] : process.env.REPO
    : null;

  let mergedRepositories: GraphQlRepositoryWrapped[] = [];

  if (modulePackage && fs.existsSync(modulesCachePath)) {
    // Incremental update: fetch single module
    console.log(`Querying GitHub API for module ${modulePackage}`);
    const result: any = await client.request(makeRepositoryQuery(modulePackage));

    if (!result.repository) {
      console.error('Repository not found');
      return;
    }

    const module = convert2json(result.repository);
    if (!module) return;

    // Load existing modules and update
    let modules: ModuleJson[] = JSON.parse(fs.readFileSync(modulesCachePath, 'utf-8'));
    modules = modules.filter(m => m.moduleId !== modulePackage);
    modules.unshift(module);

    // Sort by latest release time
    modules.sort((a, b) => {
      const aTime = Math.max(
        Date.parse(a.latestReleaseTime),
        Date.parse(a.latestBetaReleaseTime),
        Date.parse(a.latestSnapshotReleaseTime)
      );
      const bTime = Math.max(
        Date.parse(b.latestReleaseTime),
        Date.parse(b.latestBetaReleaseTime),
        Date.parse(b.latestSnapshotReleaseTime)
      );
      return bTime - aTime;
    });

    fs.writeFileSync(modulesCachePath, JSON.stringify(modules));
    console.log(`Updated module ${modulePackage}`);
  } else {
    // Full fetch: get all repositories
    let cursor: string | null = null;
    let page = 1;
    let total = 0;

    while (true) {
      console.log(`Querying GitHub API, page ${page}, total ${Math.ceil(total / PAGINATION) || 'unknown'}, cursor: ${cursor}`);
      const result: any = await client.request(makeRepositoriesQuery(cursor));

      mergedRepositories = mergedRepositories.concat(result.organization.repositories.edges);

      if (!result.organization.repositories.pageInfo.hasNextPage) break;
      cursor = result.organization.repositories.pageInfo.endCursor;
      total = result.organization.repositories.totalCount;
      page++;
    }

    // Save raw GraphQL response for incremental updates
    fs.writeFileSync(graphqlCachePath, JSON.stringify({ repositories: mergedRepositories }, null, 2));

    // Convert to modules
    let modules: ModuleJson[] = [];
    for (const { node } of mergedRepositories) {
      const module = convert2json(node);
      if (module) modules.push(module);
    }

    // Sort by latest release time
    modules.sort((a, b) => {
      const aTime = Math.max(
        Date.parse(a.latestReleaseTime),
        Date.parse(a.latestBetaReleaseTime),
        Date.parse(a.latestSnapshotReleaseTime)
      );
      const bTime = Math.max(
        Date.parse(b.latestReleaseTime),
        Date.parse(b.latestBetaReleaseTime),
        Date.parse(b.latestSnapshotReleaseTime)
      );
      return bTime - aTime;
    });

    fs.writeFileSync(modulesCachePath, JSON.stringify(modules));
    console.log(`Generated ${modules.length} modules`);
  }
}

main().catch(console.error);
