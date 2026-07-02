#!/usr/bin/env node
// Interactive demo for @boring/sdk.
//
//   BORING_URL=http://localhost:8080 BORING_TOKEN=secret node demo.mjs
//
// Creates a `python` microVM, prints boot_ms + mode, and drops you into a live
// serial shell. Press Ctrl-] (or Ctrl-C) to destroy the VM and exit.

import { BoringClient } from './dist/index.js';

const baseUrl = process.env.BORING_URL ?? 'http://localhost:8080';
const token = process.env.BORING_TOKEN || undefined;

const client = new BoringClient({ baseUrl, token });

const stdout = process.stdout;
const stdin = process.stdin;

let machineId = null;
let tty = null;
let cleaningUp = false;

async function cleanup(code) {
	if (cleaningUp) return;
	cleaningUp = true;

	if (stdin.isTTY) {
		try {
			stdin.setRawMode(false);
		} catch {}
	}
	stdin.pause();

	if (tty) {
		try {
			tty.close();
		} catch {}
	}
	if (machineId) {
		stdout.write(`\r\n[boring] destroying ${machineId}...\r\n`);
		try {
			await client.destroyMachine(machineId);
		} catch (err) {
			stdout.write(`[boring] destroy failed: ${err?.message ?? err}\r\n`);
		}
	}
	process.exit(code ?? 0);
}

process.on('SIGINT', () => void cleanup(0));
process.on('SIGTERM', () => void cleanup(0));

async function main() {
	stdout.write(`[boring] connecting to ${baseUrl}\r\n`);

	const machine = await client.createMachine({ template: 'python', ttlSeconds: 300 });
	machineId = machine.id;
	stdout.write(
		`[boring] machine ${machine.id} is ${machine.status} ` +
			`(mode=${machine.mode}, boot_ms=${machine.boot_ms})\r\n`
	);
	stdout.write(`[boring] attaching serial console — press Ctrl-] to quit\r\n\r\n`);

	tty = client.connectTty(machine.id);
	tty.onData((bytes) => stdout.write(bytes));
	await tty.ready;

	if (stdin.isTTY) stdin.setRawMode(true);
	stdin.resume();

	// Ctrl-] is byte 0x1d — the classic "escape the shell" key.
	stdin.on('data', (chunk) => {
		if (chunk.length === 1 && chunk[0] === 0x1d) {
			void cleanup(0);
			return;
		}
		tty.send(new Uint8Array(chunk));
	});
}

main().catch(async (err) => {
	stdout.write(`[boring] error: ${err?.message ?? err}\r\n`);
	await cleanup(1);
});
