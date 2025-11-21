import { defineCollection, z } from 'astro:content';

const modulesCollection = defineCollection({
    type: 'data',
    schema: z.object({
        moduleId: z.string(),
        moduleName: z.string().optional().nullable(),
        url: z.string(),
        homepageUrl: z.string().optional().nullable(),
        sourceUrl: z.string().optional().nullable(),
        summary: z.string().optional().nullable(),
        latestRelease: z.string().optional().nullable(),
        latestBetaRelease: z.string().optional().nullable(),
        latestSnapshotRelease: z.string().optional().nullable(),
        latestReleaseTime: z.string().optional().nullable(),
        latestBetaReleaseTime: z.string().optional().nullable(),
        latestSnapshotReleaseTime: z.string().optional().nullable(),
        stargazerCount: z.number().optional().nullable(),
        authors: z.array(z.object({
            name: z.string(),
            link: z.string().optional().nullable()
        })).optional().nullable(),
        releases: z.array(z.object({
            tagName: z.string(),
            descriptionHTML: z.string().optional().nullable(),
            publishedAt: z.string().optional().nullable(),
            releaseAssets: z.array(z.object({
                name: z.string(),
                downloadUrl: z.string(),
                downloadCount: z.number()
            })).optional().nullable()
        })).optional().nullable()
    })
});

export const collections = {
    'modules': modulesCollection,
};
