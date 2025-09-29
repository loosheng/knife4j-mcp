# knife4j-mcp

MCP server for [Knife4j](https://doc.xiaominfo.com/) OpenAPI documentation.

This project provides a Model Context Protocol (MCP) server that converts OpenAPI documentation to Markdown format with built-in tolerant parsing, making it easily accessible to LLMs for batch operations and comprehensive API exploration.

## Features

- **Built-in Tolerant Parsing**: Uses `openapi2markdown@0.0.6` with automatic error recovery
- **Batch Query Support**: Query multiple modules and APIs in single requests
- **Thread-Safe Architecture**: Concurrent request handling with lazy initialization
- **Multiple Documentation Sources**: Support for comma-separated OpenAPI URLs
- **Unified Output Format**: Consistent response structure with partial success handling
- **Type-Safe Implementation**: Full TypeScript support with proper interfaces
- **Fuzzy One-shot Search**: `query_api` powered by Fuse.js for fast discovery

## Usage

### JSON config

```json
{
  "mcpServers": {
    "knife4j": {
      "command": "npx",
      "args": ["-y", "knife4j-mcp"],
      "env": {
        "DOCS_URL": "http://<your-knife4j-host>/v3/api-docs,http://<your-knife4j-host>/v2/api-docs"
      }
    }
  }
}
```

### Server Modes

**Default (stdio mode)**: For MCP client integration
```bash
npx knife4j-mcp
```

**SSE Mode**: For HTTP-based access
```bash
npx knife4j-mcp --sse
```
Server runs on port 3000 (or PORT env var) with endpoints:
- `/sse` - Server-Sent Events transport
- `/messages` - POST message handling

## Tools & When To Use

Choose the smallest tool that fits the job. All responses use stable markers for easy parsing.

### 1) `query_api` — one-shot fuzzy search
- Use when: you're unsure of exact names and want search + optional full view.
- Matches: `Module::API`, `GET /path`, or fuzzy keywords.
- Modes: `auto` (default, show full when exactly one match), `summary` (always list), `full` (always show first match details).
- Params: `{ q: string, mode?: 'auto'|'summary'|'full', limit?: number }`

Examples:
```js
// Fuzzy search, summary list
query_api({ q: "user list", limit: 5 })

// Exact match by method+path, return full details
query_api({ q: "GET /users/{id}", mode: "full" })

// Module::API direct lookup
query_api({ q: "UserService::ListUsers" })
```

### 2) `list_modules` — overview first
- Use when: you need a top-level map before drilling down.
- Params: none
- Output markers: `[docs list start] ... [docs list end]`

### 3) `list_apis` — enumerate APIs in known modules
- Use when: module names are known and you need candidates.
- Params: `{ module_names: string[] }`

Examples:
```js
list_apis({ module_names: ["UserModule"] })
list_apis({ module_names: ["UserModule", "ProductModule", "OrderModule"] })
```
- Output markers: `[multi-module apis start] ... [multi-module apis end]` (including `[not found modules]`)

### 4) `show_api` — render full Markdown for known APIs
- Use when: you already know exact module+API names.
- Params: `{ api_queries: { module_name, api_name }[] }`

Examples:
```js
show_api({ api_queries: [{ module_name: "UserModule", api_name: "Create User" }] })
show_api({ api_queries: [
  { module_name: "UserModule", api_name: "Create User" },
  { module_name: "ProductModule", api_name: "Get Product" },
] })
```
- Output markers: `[multi-api details start] ... [multi-api details end]` (including `[not found apis]`)

## Batch Query Benefits

- **Reduced Network Overhead**: Query multiple resources in single request
- **Partial Success Handling**: Returns found results even if some items are missing
- **Consistent Interface**: All tools follow the same array-based input pattern
- **Better Performance**: Eliminates need for multiple sequential MCP calls

## Development

```bash
# Install dependencies
bun install

# Build the project
bun run build

# Type checking
npx tsc --noEmit

# Run the server directly
bun run index.ts

# Run in SSE mode for testing
bun run index.ts --sse
```

## Architecture

- **Single-file MCP Server**: Complete implementation in `index.ts`
- **DocsManager Class**: Thread-safe document state management with batch query methods
- **Simplified Parsing**: Relies on `openapi2markdown@0.0.6` built-in tolerant parsing
- **Utility Functions**: Unified section parsing and error handling
- **Environment Configuration**: `DOCS_URL` for OpenAPI source URLs

## Migration from Single Query

If you were using the previous single-query format, update your calls:

```javascript
// Old format (no longer supported)
list_apis({ module_name: "UserModule" })
show_api({ module_name: "UserModule", api_name: "Create User" })

// New format (array-based)
list_apis({ module_names: ["UserModule"] })
show_api({ api_queries: [{ module_name: "UserModule", api_name: "Create User" }] })
```

## License

MIT
