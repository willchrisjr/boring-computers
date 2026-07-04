import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';

// boringd control plane. Reads BORING_URL / BORING_TOKEN from apps/web/.env (or
// the shell). Point BORING_URL at your own boringd — directly, or at a local
// port forwarded to a private box over an SSH tunnel. If that boringd needs a
// token, set BORING_TOKEN and it's injected here server-side (never the browser).
export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const BORING_URL = env.BORING_URL || process.env.BORING_URL || 'http://localhost:8080';
	const BORING_TOKEN = env.BORING_TOKEN || process.env.BORING_TOKEN || '';

	return {
		plugins: [
			tailwindcss(),
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				adapter: adapter()
			})
		],
		server: {
			proxy: {
				// Browser -> /boring/* -> boringd (token injected here, HTTP + WS).
				'/boring': {
					target: BORING_URL,
					changeOrigin: true,
					ws: true,
					rewrite: (p: string) => p.replace(/^\/boring/, ''),
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					configure: (proxy: any) => {
						if (!BORING_TOKEN) return;
						const auth = `Bearer ${BORING_TOKEN}`;
						proxy.on('proxyReq', (r: { setHeader: (k: string, v: string) => void }) =>
							r.setHeader('authorization', auth)
						);
						proxy.on('proxyReqWs', (r: { setHeader: (k: string, v: string) => void }) =>
							r.setHeader('authorization', auth)
						);
					}
				}
			}
		},
		test: {
			expect: { requireAssertions: true },
			projects: [
				{
					extends: './vite.config.ts',
					test: {
						name: 'client',
						browser: {
							enabled: true,
							provider: playwright(),
							instances: [{ browser: 'chromium', headless: true }]
						},
						include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
						exclude: ['src/lib/server/**']
					}
				},
				{
					extends: './vite.config.ts',
					test: {
						name: 'server',
						environment: 'node',
						include: ['src/**/*.{test,spec}.{js,ts}'],
						exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
					}
				}
			]
		}
	};
});
