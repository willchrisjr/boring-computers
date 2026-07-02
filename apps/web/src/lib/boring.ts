import { env } from '$env/dynamic/public';

// In production, set PUBLIC_BORING_URL to the public boringd endpoint
// (e.g. https://162-43-188-89.sslip.io) so the browser talks to it directly.
// In dev it's unset and requests go through the Vite `/boring` proxy, which
// injects the token over the SSH tunnel to the box.
const PUB = env.PUBLIC_BORING_URL ?? '';

/** Base for REST calls: the public endpoint in prod, the `/boring` proxy in dev. */
export const apiBase = PUB || '/boring';

/** Build a ws(s):// URL for a boringd WebSocket path (e.g. /v1/machines/ID/tty). */
export function wsUrl(path: string): string {
	if (PUB) return PUB.replace(/^http/, 'ws') + path;
	const proto = location.protocol === 'https:' ? 'wss' : 'ws';
	return `${proto}://${location.host}/boring${path}`;
}
