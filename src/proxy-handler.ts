import type { Env, ProxyProps } from "./types";
import { getSlugConfig } from "./slug-manager";

export const proxyHandler = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const { apiKey, slug } = (ctx as any).props as ProxyProps;
    console.log("PROXY", JSON.stringify({ slug, apiKeyPrefix: apiKey.substring(0, 20) }));

    const config = await getSlugConfig(env, slug);
    if (!config) {
      console.log("PROXY config not found for slug:", slug);
      return new Response(
        JSON.stringify({ error: "Slug configuration not found" }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
    console.log("PROXY config upstream:", config.upstream_url);

    const requestUrl = new URL(request.url);
    const upstreamUrl = new URL(config.upstream_url);

    const mcpPrefix = `/${slug}/mcp`;
    const extraPath = requestUrl.pathname.slice(mcpPrefix.length);
    if (extraPath) {
      upstreamUrl.pathname =
        upstreamUrl.pathname.replace(/\/$/, "") + extraPath;
    }
    upstreamUrl.search = requestUrl.search;

    const headers = new Headers(request.headers);
    headers.set(
      config.auth_header_name,
      config.auth_header_prefix + apiKey
    );
    headers.delete("host");

    const upstream = await fetch(upstreamUrl.toString(), {
      method: request.method,
      headers,
      body: request.body,
      // @ts-expect-error CF Workers support duplex for streaming request bodies
      duplex: "half",
    });

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("transfer-encoding");

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  },
};
