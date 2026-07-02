# @boring/sdk

Tiny, dependency-free TypeScript client for the **boring computers** Firecracker microVM
API (`boringd`). Uses the global `fetch` and `WebSocket` shipped with Node 24+, so there is
nothing to install beyond the workspace itself.

## Install / build

This package lives in the monorepo workspace. From the repo root:

```sh
npm install           # once, at the root (do not run inside this package)
npm run build -w @boring/sdk   # emits dist/
```

Or from this directory:

```sh
npm run build   # tsc -> dist/
npm run check   # tsc --noEmit
```

## Usage

```ts
import { BoringClient } from '@boring/sdk';

const client = new BoringClient({
	baseUrl: 'http://localhost:8080',
	token: process.env.BORING_TOKEN
});

const vm = await client.createMachine({ template: 'python', ttlSeconds: 300 });
console.log(vm.id, vm.mode, vm.boot_ms);

const tty = client.connectTty(vm.id);
tty.onData((bytes) => process.stdout.write(bytes));
await tty.ready;
tty.send("python3 -c 'print(2 + 2)'\n");

// later
await client.destroyMachine(vm.id);
```

### API

- `new BoringClient({ baseUrl?, token? })`
- `createMachine(opts?: { template?, ttlSeconds? }): Promise<Machine>`
- `listMachines(): Promise<Machine[]>`
- `getMachine(id): Promise<Machine>`
- `destroyMachine(id): Promise<void>`
- `branchMachine(id): Promise<Machine>` — fork from snapshot (may reject 501)
- `connectTty(id): TtySession` — `.onData(cb)`, `.send(bytes|string)`, `.close()`, `.ready`

## Interactive demo

`demo.mjs` creates a `python` VM and gives you a live shell right in your terminal.

Point it at the box (typically over an SSH tunnel to the Latitude.sh server):

```sh
# forward the daemon port to your laptop
ssh -N -L 8080:localhost:8080 user@your-box &

# then run the demo
BORING_URL=http://localhost:8080 BORING_TOKEN=your-token node demo.mjs
```

You'll see the boot mode and `boot_ms`, then a live serial shell. Try `python3` inside it.
Press **Ctrl-]** (or **Ctrl-C**) to destroy the machine and exit cleanly.

Build the SDK first (`npm run build`) since the demo imports from `./dist/index.js`.
