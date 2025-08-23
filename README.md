# knife4j-mcp

MCP server for [Knife4j](https://doc.xiaominfo.com/) OpenAPI documentation.

This project provides a Model Context Protocol (MCP) server that converts OpenAPI documentation to Markdown format with robust fault-tolerant parsing, making it easily accessible to LLMs even when dealing with malformed or non-standard OpenAPI specifications.

## Features

- **Fault-Tolerant Parsing**: 4-layer fallback system ensures content is always extracted
  - Standard parsing with `openapi2markdown`
  - Auto-cleaning of problematic fields and retrying
  - Manual markdown construction from JSON structure
  - Fallback to basic document structure summary
- **Thread-Safe Architecture**: Concurrent request handling with lazy initialization
- **Multiple Documentation Sources**: Support for comma-separated OpenAPI URLs
- **Robust Error Handling**: Detailed logging and graceful degradation
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

The server provides three main tools with improved naming:

1. `list_modules` - List all available API documentation modules with overview
2. `list_apis` - List all APIs within a specific module
3. `show_api` - Show complete documentation for a specific API

## Fault-Tolerant Processing

The system handles problematic OpenAPI documents through multiple strategies:

- **Layer 1**: Standard `openapi2markdown` parsing
- **Layer 2**: Document sanitization (removes x-extensions, fixes non-ASCII refs)
- **Layer 3**: Manual markdown construction from JSON structure
- **Layer 4**: Basic document structure analysis

This ensures users receive useful content even from malformed specifications.

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
- **DocsManager Class**: Thread-safe document state management
- **Utility Functions**: Unified section parsing and error handling
- **Environment Configuration**: `DOCS_URL` for OpenAPI source URLs

## License

MIT
