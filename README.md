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

## Available Tools

The server provides three main tools with batch query capabilities:

### 1. `list_modules`
List all available API documentation modules with overview.

**Parameters**: None

**Output**: YAML format with module names, descriptions, and API counts.

### 2. `list_apis` 
List all APIs within multiple modules.

**Parameters**: 
- `module_names: string[]` - Array of module names to query

**Examples**:
```javascript
// Query single module
list_apis({ module_names: ["UserModule"] })

// Query multiple modules
list_apis({ module_names: ["UserModule", "ProductModule", "OrderModule"] })
```

**Output**: Multi-module format with found APIs and not-found modules listed separately.

### 3. `show_api`
Show complete documentation for multiple APIs.

**Parameters**:
- `api_queries: Array<{module_name: string, api_name: string}>` - Array of API queries

**Examples**:
```javascript
// Query single API
show_api({ 
  api_queries: [{ module_name: "UserModule", api_name: "Create User" }] 
})

// Query multiple APIs
show_api({ 
  api_queries: [
    { module_name: "UserModule", api_name: "Create User" },
    { module_name: "ProductModule", api_name: "Get Product" }
  ]
})
```

**Output**: Detailed documentation for each found API with not-found APIs listed separately.

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
