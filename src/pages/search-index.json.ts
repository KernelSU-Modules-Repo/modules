import type { APIRoute } from "astro";
import modules from "../../.cache/modules.json";

export const GET: APIRoute = () => {
  const searchIndex = modules.map((m: any) => ({
    name: m.moduleId,
    description: m.moduleName,
    summary: m.summary,
    authors: m.authors?.map((a: any) => a.name).join(' ') || '',
    url: `/module/${m.moduleId}`,
  }));

  return new Response(JSON.stringify(searchIndex));
};
