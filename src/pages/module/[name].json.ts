import type { APIRoute } from "astro";
import modules from "../../../.cache/modules.json";

export const GET: APIRoute = ({ params }) => {
  const module = modules.find((m: any) => m.moduleId === params.name);
  return new Response(JSON.stringify(module || null));
};

export function getStaticPaths() {
  return modules.map((m: any) => ({
    params: { name: m.moduleId },
  }));
}
