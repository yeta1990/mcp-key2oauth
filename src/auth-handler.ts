import { Hono } from "hono";
import type { Env } from "./types";
import { extractSlugFromResource } from "./slug";
import { getSlugConfig, createSlug } from "./slug-manager";
import { sha256Short } from "./validation";
import { renderPastePage, renderHomePage } from "./html";

const app = new Hono<{ Bindings: Env }>();

app.get("/authorize", async (c) => {
  const url = new URL(c.req.url);
  const rawParams = Object.fromEntries(url.searchParams.entries());
  console.log("AUTHORIZE GET raw params:", JSON.stringify(rawParams));

  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  console.log("AUTHORIZE GET parsed info:", JSON.stringify(oauthReqInfo));

  const slug = extractSlugFromResource(oauthReqInfo.resource);
  if (!slug) {
    return c.text(
      "Missing or invalid resource parameter. Cannot identify target MCP server.",
      400
    );
  }

  const config = await getSlugConfig(c.env, slug);
  if (!config) {
    return c.text("Unknown MCP server slug.", 404);
  }

  const serialized = btoa(JSON.stringify(oauthReqInfo));
  return c.html(renderPastePage(config, serialized));
});

app.post("/authorize", async (c) => {
  const text = await c.req.text();
  console.log("AUTHORIZE POST raw body:", text.substring(0, 200));
  
  // Manual parse
  const params = new URLSearchParams(text);
  const apiKey = params.get("api_key")?.trim();
  const oauthParamsB64 = params.get("oauth_params") as string;

  if (!apiKey) {
    return c.text("API key is required.", 400);
  }
  if (!oauthParamsB64) {
    return c.text("Missing OAuth parameters.", 400);
    console.log("oauthParamsB64 is undefined. keys:", Array.from(params.keys()).join(","));
  }

  let oauthReqInfo: any;
  try {
    oauthReqInfo = JSON.parse(atob(oauthParamsB64));
  } catch {
    return c.text("Invalid OAuth parameters.", 400);
  }

  const slug = extractSlugFromResource(oauthReqInfo.resource);
  if (!slug) {
    return c.text("Invalid resource in OAuth parameters.", 400);
  }

  const config = await getSlugConfig(c.env, slug);
  if (!config) {
    return c.text("Unknown MCP server slug.", 404);
  }

  const keyHash = await sha256Short(apiKey);
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: `${slug}_${keyHash}`,
    metadata: { slug },
    scope: oauthReqInfo.scope || [],
    props: { apiKey, slug },
  });

  return c.redirect(redirectTo);
});

app.post("/api/slugs", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.upstream_url || typeof body.upstream_url !== "string") {
    return c.json({ error: "upstream_url is required" }, 400);
  }

  try {
    const { slug, config } = await createSlug(c.env, {
      upstream_url: body.upstream_url,
      display_name: body.display_name,
      auth_header_name: body.auth_header_name,
      auth_header_prefix: body.auth_header_prefix,
    });

    const origin = new URL(c.req.url).origin;
    return c.json({
      slug,
      mcp_endpoint: `${origin}/${slug}/mcp`,
      display_name: config.display_name,
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

app.get("/", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.html(renderHomePage(origin));
});

app.get("/debug/:slug", async (c) => {
  const slug = c.req.param("slug");
  const config = await getSlugConfig(c.env, slug);
  if (!config) return c.json({ error: "slug not found" }, 404);
  return c.json({ slug, config, keyMask: config.auth_header_prefix + "***" });
});

export { app as authApp };
