# @boring/mcp

An [MCP](https://modelcontextprotocol.io) server that lets any AI spin up and
drive a real Linux computer — a Firecracker microVM from
[boring computers](https://boringcomputers.com).

Tools: `launch_computer`, `run_command` (run one shell command, get output +
exit code back — deterministic, no agent), `run_task` (give it a plain-English
task and an agent writes + runs the code, returning a live preview URL if it
starts a server), `screenshot`, `preview_url`, `fork_computer`,
`list_computers`, `stop_computer`.

It talks to **your own boringd** — there is no public hosted endpoint. Set
`BORING_URL` to wherever yours runs (defaults to `http://localhost:8080`, which
is right if boringd is on the same machine or reached over an SSH tunnel; the
Mac/Lima local setup forwards to `http://localhost:8088`). If your boringd sets
`BORING_TOKEN`, pass the same value so the server can authenticate.

> Not published to npm yet — run it from source.

## Run

```bash
git clone https://github.com/michaelshimeles/boring-computers
cd boring-computers && npm install
BORING_URL=http://localhost:8080 node packages/mcp/index.mjs
```

## Claude Desktop

Add to `claude_desktop_config.json`, then ask _"launch a computer and build me a
snake game."_

```json
{
	"mcpServers": {
		"boring-computers": {
			"command": "node",
			"args": ["/absolute/path/to/boring-computers/packages/mcp/index.mjs"],
			"env": { "BORING_URL": "http://localhost:8080" }
		}
	}
}
```
