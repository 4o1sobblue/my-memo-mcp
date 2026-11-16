import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { OAUTH_RESOURCE_URL } from '../src/oauth-config.js';

interface DatabaseBinding { binding: string; database_name: string; database_id: string }
interface Environment {
  name: string;
  vars: {
    EXPECTED_HOSTNAME: string;
    RESOURCE_URL?: string;
    GITHUB_CLIENT_ID?: string;
    ALLOWED_GITHUB_USER_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
  };
  d1_databases: DatabaseBinding[];
  kv_namespaces?: Array<{ binding: string; id: string }>;
}

const configPath = new URL('../wrangler.jsonc', import.meta.url);
assert.ok(existsSync(configPath), 'Copy wrangler.example.jsonc to wrangler.jsonc and fill in env.oauth before running this check');
const config = JSON.parse(readFileSync(configPath, 'utf8')) as { env?: { oauth?: Environment } };
const oauth = config.env?.oauth;
assert.ok(oauth, 'The Wrangler config needs an env.oauth environment');
assert.doesNotMatch(JSON.stringify(oauth), /<[^>]+>/, 'Replace all example placeholders in env.oauth before checking public settings');
const oauthDb = oauth.d1_databases.find((item) => item.binding === 'DB');

assert.ok(oauthDb, 'The OAuth Worker needs a DB binding');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
assert.match(oauthDb.database_id, uuid, 'Replace the D1 ID with the UUID returned by Wrangler');
assert.notEqual(oauthDb.database_id, '00000000-0000-0000-0000-000000000000', 'A public D1 cannot use the local placeholder ID');

const resource = new URL(OAUTH_RESOURCE_URL);
assert.equal(resource.protocol, 'https:');
assert.equal(resource.pathname, '/mcp');
assert.equal(resource.search, '', 'The sample resource URL must not contain a query');
assert.equal(resource.hash, '', 'The sample resource URL must not contain a fragment');
assert.equal(resource.username + resource.password, '', 'The resource URL must not contain credentials');
assert.equal(oauth.vars.RESOURCE_URL, OAUTH_RESOURCE_URL, 'OAuth metadata and Worker RESOURCE_URL must match');
assert.equal(oauth.vars.EXPECTED_HOSTNAME, resource.hostname, 'OAuth hostname must match metadata');
assert.ok(oauth.kv_namespaces?.some((item) => item.binding === 'OAUTH_KV' && item.id), 'OAuth KV binding is required');
assert.match(oauth.kv_namespaces!.find((item) => item.binding === 'OAUTH_KV')!.id, /^[0-9a-f]{32}$/i, 'Replace the OAuth KV namespace ID');
assert.ok(oauth.vars.GITHUB_CLIENT_ID, 'GitHub client ID is required');
assert.match(oauth.vars.ALLOWED_GITHUB_USER_ID ?? '', /^\d+$/, 'Allowed GitHub user ID must be numeric');
assert.equal(oauth.vars.GITHUB_CLIENT_SECRET, undefined, 'GitHub client secret must be a Worker secret, not a config var');

console.log('Config checks: PASS (D1, resource URL, hostname, KV, GitHub settings)');
