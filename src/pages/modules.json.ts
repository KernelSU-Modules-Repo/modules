import type { APIRoute } from "astro";
import modules from "../../.data-cache/modules.json";

export const GET: APIRoute = () => {
  return new Response(
    JSON.stringify(
      modules.map((m: any) => {
        // Return module with only the latest release download URL
        const { readme, readmeHTML, releases, ...rest } = m;
        return {
          ...rest,
          latestReleaseDownloadUrl: releases?.[0]?.releaseAssets?.[0]?.downloadUrl || null,
        };
      })
    )
  );
};
