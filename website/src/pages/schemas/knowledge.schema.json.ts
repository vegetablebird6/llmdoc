import type { APIRoute } from "astro";

import knowledgeSchema from "../../../../cli/schemas/knowledge.schema.json";

export const prerender = true;

export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(knowledgeSchema, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/schema+json; charset=utf-8"
    }
  });
