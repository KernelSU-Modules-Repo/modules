import fs from 'fs';
import path from 'path';
import { GraphQLClient, gql } from 'graphql-request';
import ellipsize from 'ellipsize';
import MarkdownIt from 'markdown-it';
import markdownItTaskLists from 'markdown-it-task-lists';
import markdownItFootnote from 'markdown-it-footnote';
import markdownItGitHubAlerts from 'markdown-it-github-alerts';
import { full as markdownItEmoji } from 'markdown-it-emoji';
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
})
  .use(markdownItTaskLists, { enabled: true, label: true, labelAfter: true })
  .use(markdownItFootnote)
  .use(markdownItGitHubAlerts)
  .use(markdownItEmoji);

// Skip reason types for detailed error reporting
enum SkipReason {
  INVALID_NAME = 'INVALID_NAME',
  NO_DESCRIPTION = 'NO_DESCRIPTION',
  NO_VALID_RELEASES = 'NO_VALID_RELEASES',
  RESERVED_NAME = 'RESERVED_NAME',
  NO_ZIP_ASSET = 'NO_ZIP_ASSET',
  MODULE_ID_MISMATCH = 'MODULE_ID_MISMATCH',
  MISSING_VERSION = 'MISSING_VERSION',
  MISSING_MODULE_PROP = 'MISSING_MODULE_PROP',
}

type SkipInfo = {
  reason: SkipReason;
  message: string;
  details?: Record<string, any>;
};

type ConvertResult =
  | { success: true; module: ModuleJson }
  | { success: false; skipInfo: SkipInfo };

const SKIP_REASON_MESSAGES: Record<SkipReason, { title: string; body: string }> = {
  [SkipReason.INVALID_NAME]: {
    title: 'Invalid module name format',
    body: 'Repository name must start with a letter and can only contain letters, numbers, dots (.), underscores (_), and hyphens (-).\n\nPlease rename the repository to match the required format: `^[a-zA-Z][a-zA-Z0-9._-]+$`',
  },
  [SkipReason.NO_DESCRIPTION]: {
    title: 'Missing repository description',
    body: 'The repository is missing a description. Please add a description in the repository settings.\n\nThe description will be displayed as the module name in the module list.',
  },
  [SkipReason.NO_VALID_RELEASES]: {
    title: 'No valid releases found',
    body: 'The repository has no releases that meet the requirements.\n\nA valid release must:\n- Not be a draft\n- Be immutable (locked)\n- Contain a `.zip` attachment\n\nPlease create a proper release and upload the module zip file.',
  },
  [SkipReason.RESERVED_NAME]: {
    title: 'Repository name is reserved',
    body: 'This repository name is reserved for system use and will not be included as a module.',
  },
  [SkipReason.NO_ZIP_ASSET]: {
    title: 'Release missing ZIP attachment',
    body: 'No `.zip` attachment was found in the release.\n\nPlease ensure you upload the module zip file to the release.',
  },
  [SkipReason.MODULE_ID_MISMATCH]: {
    title: 'module.prop id does not match repository name',
    body: 'The `id` field in `module.prop` inside the zip file must exactly match the repository name.\n\n**Current status:**\n- Repository name: `{repoName}`\n- module.prop id: `{moduleId}`\n\nPlease update the `id` field in `module.prop` or rename the repository.',
  },
  [SkipReason.MISSING_VERSION]: {
    title: 'module.prop missing version information',
    body: 'The `module.prop` in the zip file is missing required version fields.\n\n**Current status:**\n- version: `{version}`\n- versionCode: `{versionCode}`\n\nPlease ensure `module.prop` contains valid `version` and `versionCode` fields.',
  },
  [SkipReason.MISSING_MODULE_PROP]: {
    title: 'ZIP file missing module.prop',
    body: 'No `module.prop` file was found in the release zip file.\n\nThis is a required file for KernelSU modules. Please ensure the zip package root directory contains a valid `module.prop`.',
  },
};

const PAGINATION = 10;
const GRAPHQL_TOKEN = process.env.GRAPHQL_TOKEN;
const ISSUE_LABEL = 'module-validation';

// Create GitHub Issue for module validation errors (incremental build only)
async function createValidationIssue(repoName: string, skipInfo: SkipInfo): Promise<void> {
  const template = SKIP_REASON_MESSAGES[skipInfo.reason];
  let body = template.body;

  // Replace placeholders with actual values
  if (skipInfo.details) {
    for (const [key, value] of Object.entries(skipInfo.details)) {
      body = body.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value ?? 'N/A'));
    }
  }

  body += `\n\n---\n*This issue was automatically created by the build system to notify module authors of issues that need to be fixed.*\n*Please close this issue after fixing the problem. The next build will automatically retry.*`;

  const ghEnv = { ...process.env, GH_TOKEN: GRAPHQL_TOKEN };

  try {
    // Check if similar issue already exists
    const { stdout: existingIssues } = await execAsync(
      `gh issue list --repo "KernelSU-Modules-Repo/${repoName}" --label "${ISSUE_LABEL}" --state open --json title,number --limit 10`,
      { encoding: 'utf8', env: ghEnv }
    );

    const issues = JSON.parse(existingIssues || '[]');
    const existingIssue = issues.find((i: any) => i.title === template.title);

    if (existingIssue) {
      console.log(`Issue already exists for ${repoName}: #${existingIssue.number}`);
      return;
    }

    // Create new issue
    await execAsync(
      `gh issue create --repo "KernelSU-Modules-Repo/${repoName}" --title "${template.title}" --body "${body.replace(/"/g, '\\"')}" --label "${ISSUE_LABEL}"`,
      { encoding: 'utf8', env: ghEnv }
    );

    console.log(`Created issue for ${repoName}: ${template.title}`);
  } catch (err: any) {
    console.error(`Failed to create issue for ${repoName}: ${err.message}`);
  }
}

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

const RESERVED_NAMES = ['.github', 'submission', 'developers', 'modules', 'org.kernelsu.example', "module_release"];

async function convert2json(repo: GraphQlRepository): Promise<ConvertResult> {
  // Check reserved names first
  if (RESERVED_NAMES.includes(repo.name)) {
    const msg = `Skipped ${repo.name}: reserved name`;
    console.log(msg);
    return {
      success: false,
      skipInfo: {
        reason: SkipReason.RESERVED_NAME,
        message: msg,
      },
    };
  }

  // Check name format
  if (!repo.name.match(/^[a-zA-Z][a-zA-Z0-9._-]+$/)) {
    const msg = `Skipped ${repo.name}: invalid name format (must match ^[a-zA-Z][a-zA-Z0-9._-]+$)`;
    console.log(msg);
    return {
      success: false,
      skipInfo: {
        reason: SkipReason.INVALID_NAME,
        message: msg,
        details: { repoName: repo.name },
      },
    };
  }

  // Check description
  if (!repo.description) {
    const msg = `Skipped ${repo.name}: missing repository description`;
    console.log(msg);
    return {
      success: false,
      skipInfo: {
        reason: SkipReason.NO_DESCRIPTION,
        message: msg,
      },
    };
  }

  // Merge latestRelease into releases if not present
  if (repo.latestRelease && !repo.releases.edges.find(r => r.node.tagName === repo.latestRelease?.tagName)) {
    repo.releases.edges.push({ node: repo.latestRelease });
  }

  // Filter releases first
  const filteredReleases = repo.releases.edges.filter(({ node }) =>
    !node.isDraft &&
    node.immutable &&
    node.releaseAssets?.edges.some(({ node: asset }) => asset.contentType === 'application/zip')
  );

  // Track release-level skip reasons for reporting
  const releaseSkipReasons: Array<{ tagName: string; reason: SkipReason; details?: Record<string, any> }> = [];

  // Transform releases and extract version info from zip files concurrently
  const startTime = Date.now();
  const releasesResults = await pMap(
    filteredReleases,
    async ({ node }) => {
      const zipAsset = node.releaseAssets.edges.find(({ node: asset }) => asset.contentType === 'application/zip');

      if (!zipAsset) {
        console.log(`Skipped release ${node.tagName} (${repo.name}): no zip asset found`);
        releaseSkipReasons.push({ tagName: node.tagName, reason: SkipReason.NO_ZIP_ASSET });
        return null;
      }

      const moduleProps = await extractModulePropsFromZip(zipAsset.node.downloadUrl);

      // Check if module.prop exists (empty props means extraction failed)
      if (Object.keys(moduleProps).length === 0) {
        console.log(`Skipped release ${node.tagName} (${repo.name}): failed to read module.prop`);
        releaseSkipReasons.push({ tagName: node.tagName, reason: SkipReason.MISSING_MODULE_PROP });
        return null;
      }

      // Skip release if id doesn't match repository name
      if (moduleProps.id !== repo.name) {
        console.log(`Skipped release ${node.tagName} (${repo.name}): module.prop id (${moduleProps.id}) does not match repo name`);
        releaseSkipReasons.push({
          tagName: node.tagName,
          reason: SkipReason.MODULE_ID_MISMATCH,
          details: { repoName: repo.name, moduleId: moduleProps.id },
        });
        return null;
      }

      // Skip release if version or versionCode is missing
      if (!moduleProps.version || !moduleProps.versionCode) {
        console.log(`Skipped release ${node.tagName} (${repo.name}): missing version (${moduleProps.version}) or versionCode (${moduleProps.versionCode})`);
        releaseSkipReasons.push({
          tagName: node.tagName,
          reason: SkipReason.MISSING_VERSION,
          details: { version: moduleProps.version, versionCode: moduleProps.versionCode },
        });
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

  // Check if we have any valid releases
  if (releases.length === 0) {
    // Determine the most relevant skip reason
    let skipInfo: SkipInfo;

    if (filteredReleases.length === 0) {
      // No releases passed initial filter (draft/immutable/zip check)
      const msg = `Skipped ${repo.name}: no valid releases (requires non-draft, immutable, with zip asset)`;
      console.log(msg);
      skipInfo = {
        reason: SkipReason.NO_VALID_RELEASES,
        message: msg,
      };
    } else if (releaseSkipReasons.length > 0) {
      // Use the most recent release's skip reason
      const latestSkip = releaseSkipReasons[0];
      const msg = `Skipped ${repo.name}: ${latestSkip.reason} (latest release: ${latestSkip.tagName})`;
      console.log(msg);
      skipInfo = {
        reason: latestSkip.reason,
        message: msg,
        details: latestSkip.details,
      };
    } else {
      const msg = `Skipped ${repo.name}: no valid releases`;
      console.log(msg);
      skipInfo = {
        reason: SkipReason.NO_VALID_RELEASES,
        message: msg,
      };
    }

    return { success: false, skipInfo };
  }

  console.log(`Found module ${repo.name}`);

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
    success: true,
    module: {
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
    },
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

    const convertResult = await convert2json(result.repository);

    if (!convertResult.success) {
      // Create issue for validation error (incremental build only)
      console.log(`Module validation failed, creating issue...`);
      await createValidationIssue(modulePackage, convertResult.skipInfo);
      console.error(`Incremental build failed: ${convertResult.skipInfo.message}`);
      process.exit(1);
    }

    // Load existing modules and update
    let modules: ModuleJson[] = JSON.parse(fs.readFileSync(modulesCachePath, 'utf-8'));
    modules = modules.filter(m => m.moduleId !== modulePackage);
    modules.unshift(convertResult.module);

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

    // Filter successful results and extract modules
    const modules = modulesResults
      .filter((r): r is { success: true; module: ModuleJson } => r.success)
      .map(r => r.module);

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
