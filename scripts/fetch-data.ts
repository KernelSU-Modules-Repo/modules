import fs from 'fs';
import path from 'path';
import { GraphQLClient, gql } from 'graphql-request';
import ellipsize from 'ellipsize';
import MarkdownIt from 'markdown-it';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Concurrent execution helper with limit
async function pMap<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number = 5
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const promise = Promise.resolve().then(() => mapper(item, i)).then(result => {
      results[i] = result;
    });

    const executing_promise = promise.then(() => {
      executing.splice(executing.indexOf(executing_promise), 1);
    });

    executing.push(executing_promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

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
  immutable: boolean;
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
  version: string;
  versionCode: string;
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
  metamodule: boolean;
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
      immutable
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
          immutable
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
            immutable
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
                immutable
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

async function extractModulePropsFromZip(downloadUrl: string): Promise<Record<string, string>> {
  try {
    // Extract module.prop content from zip URL (internal network, stable)
    const { stdout: modulePropContent } = await execAsync(`runzip -p "${downloadUrl}" module.prop`, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 // 64KB buffer
    });

    // Parse module.prop content
    const props: Record<string, string> = {};
    if (!modulePropContent) return props;

    const lines = modulePropContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim();
        const value = trimmed.substring(eqIndex + 1).trim();
        props[key] = value;
      }
    }

    return props;
  } catch (err: any) {
    console.error(`Failed to extract props from ${downloadUrl}: ${err.message}`);
    return {};
  }
}

async function convert2json(repo: GraphQlRepository): Promise<ModuleJson | null> {
  // Merge latestRelease into releases if not present
  if (repo.latestRelease && !repo.releases.edges.find(r => r.node.tagName === repo.latestRelease?.tagName)) {
    repo.releases.edges.push({ node: repo.latestRelease });
  }

  // Filter releases first
  const filteredReleases = repo.releases.edges.filter(({ node }) =>
    !node.isDraft &&
    node.immutable &&
    node.tagName.match(/^\d+-.+$/) &&
    node.releaseAssets?.edges.some(({ node: asset }) => asset.contentType === 'application/zip')
  );

  // Transform releases and extract version info from zip files concurrently
  const startTime = Date.now();
  const releasesResults = await pMap(
    filteredReleases,
    async ({ node }) => {
      const zipAsset = node.releaseAssets.edges.find(({ node: asset }) => asset.contentType === 'application/zip');

      if (!zipAsset) {
        console.log(`Skipping release ${node.tagName} for ${repo.name}: no zip asset found`);
        return null;
      }

      const moduleProps = await extractModulePropsFromZip(zipAsset.node.downloadUrl);

      // Skip release if id doesn't match repository name
      if (moduleProps.id !== repo.name) {
        console.log(`Skipping release ${node.tagName} for ${repo.name}: module.prop id (${moduleProps.id}) doesn't match repository name`);
        return null;
      }

      // Skip release if version or versionCode is missing
      if (!moduleProps.version || !moduleProps.versionCode) {
        console.log(`Skipping release ${node.tagName} for ${repo.name}: missing version (${moduleProps.version}) or versionCode (${moduleProps.versionCode})`);
        return null;
      }

      return {
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
        version: moduleProps.version,
        versionCode: moduleProps.versionCode,
      };
    },
    100 // 100 concurrent downloads per repository
  );
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  if (filteredReleases.length > 0) {
    console.log(`Processed ${filteredReleases.length} releases for ${repo.name} in ${elapsed}s`);
  }

  // Filter out null results
  const releases = releasesResults.filter((r): r is ModuleRelease => r !== null);

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
  let metamodule = false;

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
      if (moduleData.metamodule === true) {
        metamodule = true;
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
    metamodule,
  };
}

async function main() {
  const cacheDir = path.resolve('.data-cache');
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

    const module = await convert2json(result.repository);
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

    // Convert to modules with concurrency control
    console.log(`Processing ${mergedRepositories.length} repositories...`);
    const overallStartTime = Date.now();
    const modulesResults = await pMap(
      mergedRepositories,
      async ({ node }, index) => {
        console.log(`[${index + 1}/${mergedRepositories.length}] Processing ${node.name}...`);
        return await convert2json(node);
      },
      20 // 20 concurrent repositories
    );
    const totalElapsed = ((Date.now() - overallStartTime) / 1000).toFixed(2);
    console.log(`Completed processing all repositories in ${totalElapsed}s`);

    // Filter out null results
    const modules = modulesResults.filter((m): m is ModuleJson => m !== null);

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
