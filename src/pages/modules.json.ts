import type { APIRoute } from "astro";
import modules from "../../.cache/modules.json";

export const GET: APIRoute = () => {
  return new Response(
    JSON.stringify(
      modules.map((m: any) => {
        // Return module with only the latest release for list view
        const { readme, readmeHTML, ...rest } = m;
        return {
          ...rest,
          releases: m.releases?.slice(0, 1) || [],
        };
      })
    )
  );
};
