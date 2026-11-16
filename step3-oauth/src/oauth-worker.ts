import { createMcpHandler, hostHeaderValidationResponse, originValidationResponse } from '@modelcontextprotocol/server';
import {
  AuthorizationError,
  CimdFetchError,
  OAuthProvider,
  authorizationErrorRedirect,
  insufficientScope,
  type ConsentDescription,
  type OAuthHelpers,
  type OAuthResourceAuth,
} from '@cloudflare/workers-oauth-provider';
import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { createMemoServer } from './memos.js';
import { D1MemoStore } from './d1-store.js';
import { OAUTH_RESOURCE_URL } from './oauth-config.js';

interface Env {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  EXPECTED_HOSTNAME: string;
  RESOURCE_URL: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  ALLOWED_GITHUB_USER_ID: string;
}

const SUPPORTED_SCOPES = ['memos:access'];

function hasUnsupportedScope(scopes: string[]): boolean {
  return scopes.some((scope) => !SUPPORTED_SCOPES.includes(scope));
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function consentPage(details: ConsentDescription, handle: string): string {
  const scopes = details.scope
    .map((scope) => `<li>${escapeHtml(scope)}</li>`)
    .join('');
  return `<!doctype html>
<html lang="ja"><meta charset="utf-8"><title>My Memo MCP の認可</title>
<h1>My Memo MCP へのアクセスを許可しますか？</h1>
<p>接続元: ${escapeHtml(details.clientName)}</p>
<p>公開元: ${escapeHtml(details.clientDomain ?? '未検証のクライアント')}</p>
<p>認可結果の送信先: ${escapeHtml(details.redirectHost)}</p>
${details.redirectIsLoopback ? '<p>送信先はこの端末上のアプリです。自分で接続を開始した場合だけ続けてください。</p>' : ''}
<p>要求されている権限:</p><ul>${scopes}</ul>
<form method="post" action="/authorize">
<input type="hidden" name="handle" value="${escapeHtml(handle)}">
<button name="decision" value="approve">許可してGitHubでログイン</button>
<button name="decision" value="deny">拒否</button>
</form></html>`;
}

async function authorize(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === 'GET') {
      const authRequest = await oauth.parseAuthRequest(request);
      if (hasUnsupportedScope(authRequest.scope)) {
        return Response.redirect(authorizationErrorRedirect(authRequest, 'invalid_scope'), 302);
      }
      const details = await oauth.describeConsent(authRequest);
      const consent = await oauth.beginConsent(authRequest);
      consent.headers.set('Content-Type', 'text/html; charset=utf-8');
      return new Response(consentPage(details, consent.handle), { headers: consent.headers });
    }

    if (request.method === 'POST') {
      const form = await request.formData();
      const handle = String(form.get('handle') ?? '');
      if (form.get('decision') !== 'approve') {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }

      const approved = await oauth.approveConsent(request, handle);
      const verifier = `${crypto.randomUUID()}${crypto.randomUUID()}`;
      const upstream = await oauth.beginUpstream(approved.request, {
        data: { verifier },
        headers: approved.headers,
      });
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const githubUrl = new URL('https://github.com/login/oauth/authorize');
      githubUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      githubUrl.searchParams.set('redirect_uri', new URL('/callback', env.RESOURCE_URL).href);
      githubUrl.searchParams.set('state', upstream.state);
      githubUrl.searchParams.set('code_challenge', challenge);
      githubUrl.searchParams.set('code_challenge_method', 'S256');
      githubUrl.searchParams.set('scope', '');
      upstream.headers.set('Location', githubUrl.href);
      return new Response(null, { status: 302, headers: upstream.headers });
    }

    return new Response('Method not allowed', { status: 405 });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) {
      return Response.redirect(error.redirectTo, 302);
    }
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      return new Response('認可リクエストを確認できませんでした', { status: 400 });
    }
    throw error;
  }
}

async function callback(request: Request, env: Env): Promise<Response> {
  const { request: original, data, headers } =
    await env.OAUTH_PROVIDER.finishUpstream<{ verifier: string }>(request);
  if (hasUnsupportedScope(original.scope)) {
    headers.set('Location', authorizationErrorRedirect(original, 'invalid_scope'));
    return new Response(null, { status: 302, headers });
  }
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (url.searchParams.has('error') || !code) {
    headers.set('Location', authorizationErrorRedirect(original, 'access_denied'));
    return new Response(null, { status: 302, headers });
  }

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: new URL('/callback', env.RESOURCE_URL).href,
      code_verifier: data.verifier,
    }),
  });
  if (!tokenResponse.ok) return new Response('GitHubのトークン交換に失敗しました', { status: 502, headers });
  const tokenData = await tokenResponse.json() as { access_token?: string };
  if (!tokenData.access_token) return new Response('GitHubのトークンを取得できませんでした', { status: 502, headers });

  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${tokenData.access_token}`,
      'User-Agent': 'my-memo-mcp-verification',
    },
  });
  if (!userResponse.ok) return new Response('GitHubの利用者情報を取得できませんでした', { status: 502, headers });
  const user = await userResponse.json() as { id?: number };
  if (!user.id || String(user.id) !== env.ALLOWED_GITHUB_USER_ID) {
    headers.set('Location', authorizationErrorRedirect(original, 'access_denied'));
    return new Response(null, { status: 302, headers });
  }

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: original,
    userId: String(user.id),
    metadata: {},
    scope: original.scope,
    props: { userId: String(user.id) },
  });
  headers.set('Location', redirectTo);
  return new Response(null, { status: 302, headers });
}

const apiHandler = {
  async fetch(request: Request, env: Env, ctx: { auth: OAuthResourceAuth }): Promise<Response> {
    const rejected = hostHeaderValidationResponse(request, [env.EXPECTED_HOSTNAME])
      ?? originValidationResponse(request, [env.EXPECTED_HOSTNAME]);
    if (rejected) return rejected;
    if (!ctx.auth.scope.includes('memos:access')) return insufficientScope(ctx.auth, ['memos:access']);
    const handler = createMcpHandler(() => createMemoServer(new D1MemoStore(env.DB)));
    return handler.fetch(request);
  },
};

const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/authorize') return authorize(request, env);
    if (path === '/callback') {
      try {
        return await callback(request, env);
      } catch (error) {
        // Missing, expired, or unbound upstream state must not become a server error.
        if (error instanceof AuthorizationError) {
          return new Response('ログインの状態を確認できません。接続を最初からやり直してください。', {
            status: 400,
            headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
        throw error;
      }
    }
    return new Response('Not found', { status: 404 });
  },
};

export default new OAuthProvider<Env>({
  apiRoute: '/mcp',
  apiHandler,
  defaultHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/oauth/token',
  scopesSupported: SUPPORTED_SCOPES,
  requiredScopes: ['memos:access'],
  clientIdMetadataDocumentEnabled: true,
  resourceMetadata: {
    resource: OAUTH_RESOURCE_URL,
    authorization_servers: [new URL(OAUTH_RESOURCE_URL).origin],
  },
});
