# boringd

Control plane for **boring computers** — a Firecracker microVM sandbox platform.

`boringd` is a single Go binary that manages Firecracker microVMs on one bare-metal
Ubuntu 24.04 x86_64 host with `/dev/kvm`. It exposes a REST API to create/list/delete/fork
microVMs and a WebSocket endpoint to attach a live shell to the guest serial console.

## How it works

Each machine is one `firecracker` child process launched by boringd:

```
firecracker --api-sock /opt/boring/run/<id>.sock --id <id>
```

boringd owns the child's **stdin/stdout** pipes. The guest kernel boots with
`console=ttyS0`, so the guest serial console is wired to firecracker's stdio:

- bytes boringd writes to child **stdin**  → guest `/dev/ttyS0` (shell input)
- bytes the child writes to **stdout**     → guest serial console (shell output)

A per-machine **Console** runs one pump goroutine that reads the child's stdout, keeps a
bounded scrollback buffer, and fans each chunk out to every subscriber. The boot-timer and
every WebSocket client subscribe to the same stream, so nobody misses bytes. `boot_ms` is
measured from just-before `InstanceStart` until the guest prints `BORING_READY` on serial.

Cold boot is the guaranteed path. Snapshot restore (`mode:"snapshot"`) and `branch` (fork
from a live snapshot) are best-effort optimizations that fall back cleanly.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/healthz` | `{"ok":true,"machines":<int>,"kvm":<bool>}` (no auth) |
| POST | `/v1/machines` | body `{"template":"python","ttl_seconds":120}` → 201 machine |
| GET | `/v1/machines` | `{"machines":[...]}` |
| GET | `/v1/machines/{id}` | machine or 404 |
| DELETE | `/v1/machines/{id}` | 204 or 404 |
| POST | `/v1/machines/{id}/branch` | fork → 201 machine (501 if snapshot unavailable) |
| GET | `/v1/machines/{id}/tty` | WebSocket, binary frames both directions |

`<machine>` = `{"id","status","mode","boot_ms","template","created_at","expires_at"}`.
IDs look like `m-<8 hex>`.

## Auth

If `BORING_TOKEN` is set, all `/v1/*` routes require `Authorization: Bearer <token>`.
The WebSocket route also accepts `?token=<token>`. `/healthz` is always open.

## Environment variables

| Var | Default | Meaning |
| --- | --- | --- |
| `BORING_TOKEN` | *(unset)* | Bearer token; empty disables auth |
| `BORING_MAX` | `20` | max live machines (429 when full) |
| `BORING_FIRECRACKER_BIN` | `/opt/boring/bin/firecracker` | firecracker binary |
| `BORING_KERNEL` | `/opt/boring/kernel/vmlinux` | uncompressed kernel |
| `BORING_ROOTFS` | `/opt/boring/rootfs/rootfs.ext4` | base rootfs |
| `BORING_TEMPLATES` | `/opt/boring/templates` | snapshot template dir |
| `BORING_RUN` | `/opt/boring/run` | per-machine sockets/overlays |

TTL is clamped to `[15, 900]` seconds, default `120`.

## Run

```sh
go build -o boringd ./...
BORING_TOKEN=secret ./boringd            # listens on 0.0.0.0:8080
```

Flags: `-addr` (default `0.0.0.0:8080`), `-max`.

### Quick demo

```sh
# create
curl -s -XPOST localhost:8080/v1/machines \
  -H 'Authorization: Bearer secret' \
  -d '{"template":"python","ttl_seconds":120}'

# attach a shell (needs a ws client, e.g. websocat)
websocat "ws://localhost:8080/v1/machines/<id>/tty?token=secret"
#   then type:  python3 -c 'print(2**10)'

# fork it
curl -s -XPOST localhost:8080/v1/machines/<id>/branch -H 'Authorization: Bearer secret'
```

Build/vet:

```sh
go mod tidy && go build ./... && go vet ./...
```
