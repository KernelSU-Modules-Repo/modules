declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it';

  interface TaskListsOptions {
    enabled?: boolean;
    label?: boolean;
    labelAfter?: boolean;
  }

  const taskLists: (md: MarkdownIt, options?: TaskListsOptions) => void;
  export default taskLists;
}

declare module 'markdown-it-anchor' {
  import type MarkdownIt from 'markdown-it';

  interface AnchorOptions {
    level?: number | number[];
    slugify?: (s: string) => string;
    uniqueSlugStartIndex?: number;
    permalink?: any;
    renderPermalink?: (slug: string, opts: AnchorOptions, state: any, idx: number) => void;
    permalinkClass?: string;
    permalinkSymbol?: string;
    permalinkBefore?: boolean;
    permalinkHref?: (slug: string) => string;
    permalinkAttrs?: (slug: string) => Record<string, string>;
  }

  interface MarkdownItAnchor {
    (md: MarkdownIt, options?: AnchorOptions): void;
    permalink: {
      headerLink: (opts?: any) => any;
      linkInsideHeader: (opts?: any) => any;
      ariaHidden: (opts?: any) => any;
      linkAfterHeader: (opts?: any) => any;
    };
  }

  const anchor: MarkdownItAnchor;
  export default anchor;
}

declare module 'markdown-it-github-alerts' {
  import type MarkdownIt from 'markdown-it';

  interface GitHubAlertsOptions {
    icons?: Record<string, string>;
    titles?: Record<string, string>;
  }

  const githubAlerts: (md: MarkdownIt, options?: GitHubAlertsOptions) => void;
  export default githubAlerts;
}

declare module 'markdown-it-emoji' {
  import type MarkdownIt from 'markdown-it';

  interface EmojiOptions {
    defs?: Record<string, string>;
    shortcuts?: Record<string, string | string[]>;
  }

  type EmojiPlugin = (md: MarkdownIt, options?: EmojiOptions) => void;

  export const bare: EmojiPlugin;
  export const light: EmojiPlugin;
  export const full: EmojiPlugin;
}
