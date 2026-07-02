/**
 * @boring/sdk — TypeScript client for the boring computers Firecracker microVM API.
 *
 * Dependency-free: relies on the global `fetch` and `WebSocket` available in Node 24+.
 */

/** Boot mode reported by the daemon. */
export type MachineMode = 'coldboot' | 'snapshot';

/** Lifecycle status of a machine. */
export type MachineStatus = 'running';

/** A microVM as returned by the boringd REST API. Matches the wire contract exactly. */
export interface Machine {
	/** Machine id, formatted as `m-<8 hex>`. */
	id: string;
	status: MachineStatus;
	mode: MachineMode;
	/** Milliseconds from InstanceStart until the guest printed `BORING_READY`. */
	boot_ms: number;
	template: string;
	/** RFC3339 timestamp. */
	created_at: string;
	/** RFC3339 timestamp. */
	expires_at: string;
}

/** Options for {@link BoringClient.createMachine}. */
export interface CreateMachineOptions {
	template?: string;
	ttlSeconds?: number;
}

/** Configuration for {@link BoringClient}. */
export interface BoringClientOptions {
	/** Base URL of boringd, e.g. `http://localhost:8080`. Defaults to that value. */
	baseUrl?: string;
	/** Optional bearer token; sent as `Authorization: Bearer <token>` and as `?token=` on WS. */
	token?: string;
}

/** Error thrown when the API returns a non-2xx response. */
export class BoringApiError extends Error {
	readonly status: number;
	readonly body: string;

	constructor(status: number, body: string, message?: string) {
		super(message ?? `boring API error ${status}: ${body}`);
		this.name = 'BoringApiError';
		this.status = status;
		this.body = body;
	}
}

/**
 * A live serial-console session over a WebSocket.
 *
 * Bytes sent with {@link send} land on the guest's `/dev/ttyS0` (stdin); bytes the guest
 * writes to its serial console arrive via {@link onData}.
 */
export class TtySession {
	/** Resolves once the underlying WebSocket is open and ready for I/O. */
	readonly ready: Promise<void>;

	private readonly socket: WebSocket;
	private readonly dataHandlers = new Set<(bytes: Uint8Array) => void>();

	constructor(url: string) {
		this.socket = new WebSocket(url);
		this.socket.binaryType = 'arraybuffer';

		this.ready = new Promise<void>((resolve, reject) => {
			this.socket.addEventListener('open', () => resolve(), { once: true });
			this.socket.addEventListener(
				'error',
				() => reject(new Error('failed to open tty WebSocket')),
				{ once: true }
			);
		});

		this.socket.addEventListener('message', (event: MessageEvent) => {
			const bytes = toUint8Array(event.data);
			if (bytes === undefined) return;
			for (const handler of this.dataHandlers) handler(bytes);
		});
	}

	/** Register a handler for guest serial output. Returns an unsubscribe function. */
	onData(cb: (bytes: Uint8Array) => void): () => void {
		this.dataHandlers.add(cb);
		return () => this.dataHandlers.delete(cb);
	}

	/** Write bytes (or a UTF-8 string) to the guest serial input. */
	send(data: Uint8Array | string): void {
		const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
		this.socket.send(bytes);
	}

	/** Close the WebSocket. */
	close(): void {
		this.dataHandlers.clear();
		this.socket.close();
	}
}

/** Client for the boring computers microVM API. */
export class BoringClient {
	private readonly baseUrl: string;
	private readonly token?: string;

	constructor(options: BoringClientOptions = {}) {
		const base = options.baseUrl ?? 'http://localhost:8080';
		this.baseUrl = base.replace(/\/+$/, '');
		this.token = options.token;
	}

	/** Create a new microVM. */
	async createMachine(opts: CreateMachineOptions = {}): Promise<Machine> {
		const body: { template?: string; ttl_seconds?: number } = {};
		if (opts.template !== undefined) body.template = opts.template;
		if (opts.ttlSeconds !== undefined) body.ttl_seconds = opts.ttlSeconds;
		return this.request<Machine>('POST', '/v1/machines', body);
	}

	/** List all live machines. */
	async listMachines(): Promise<Machine[]> {
		const res = await this.request<{ machines: Machine[] }>('GET', '/v1/machines');
		return res.machines;
	}

	/** Fetch a single machine by id. */
	async getMachine(id: string): Promise<Machine> {
		return this.request<Machine>('GET', `/v1/machines/${encodeURIComponent(id)}`);
	}

	/** Destroy a machine. Resolves once the daemon has torn it down. */
	async destroyMachine(id: string): Promise<void> {
		await this.request<void>('DELETE', `/v1/machines/${encodeURIComponent(id)}`);
	}

	/** Fork a machine from its snapshot. May reject with a 501 if snapshotting is unavailable. */
	async branchMachine(id: string): Promise<Machine> {
		return this.request<Machine>('POST', `/v1/machines/${encodeURIComponent(id)}/branch`);
	}

	/** Open a live serial-console WebSocket to a machine. */
	connectTty(id: string): TtySession {
		const wsBase = this.baseUrl.replace(/^http/, 'ws');
		let url = `${wsBase}/v1/machines/${encodeURIComponent(id)}/tty`;
		if (this.token !== undefined) {
			url += `?token=${encodeURIComponent(this.token)}`;
		}
		return new TtySession(url);
	}

	private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const headers: Record<string, string> = {};
		if (this.token !== undefined) headers['Authorization'] = `Bearer ${this.token}`;
		if (body !== undefined) headers['Content-Type'] = 'application/json';

		const res = await fetch(`${this.baseUrl}${path}`, {
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined
		});

		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new BoringApiError(res.status, text);
		}

		// 204 No Content (and other empty bodies) resolve as undefined.
		if (res.status === 204) return undefined as T;
		const text = await res.text();
		if (text.length === 0) return undefined as T;
		return JSON.parse(text) as T;
	}
}

/** Coerce a WebSocket message payload into a Uint8Array of bytes. */
function toUint8Array(data: unknown): Uint8Array | undefined {
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (ArrayBuffer.isView(data)) {
		const view = data as ArrayBufferView;
		return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
	}
	if (typeof data === 'string') return new TextEncoder().encode(data);
	return undefined;
}
