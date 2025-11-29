import type { APIRoute } from "astro";
import modules from "../../.data-cache/modules.json";

export const GET: APIRoute = () => {
  return new Response(
    JSON.stringify(
      modules.map((m: any) => {
        // Return module with restructured latest release info
        const {
          readme,
          readmeHTML,
          releases,
          latestRelease,
          latestReleaseTime,
          latestBetaReleaseTime,
          latestSnapshotReleaseTime,
          ...rest
        } = m;

        const newLatestRelease = (latestRelease || releases?.[0]) ? {
          name: latestRelease || null,
          time: latestReleaseTime || null,
          version: releases?.[0]?.version || null,
          versionCode: releases?.[0]?.versionCode || null,
          downloadUrl: releases?.[0]?.releaseAssets?.[0]?.downloadUrl || null,
        } : null;

        return {
          ...rest,
          latestRelease: newLatestRelease,
        };
      })
    )
  );
};
