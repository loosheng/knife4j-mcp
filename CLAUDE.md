# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server for Knife4j OpenAPI documentation. It converts OpenAPI specs to Markdown format and provides four MCP tools for LLMs to interact with API documentation, including fuzzy search capabilities.

## Core Architecture

### Single-file MCP Server (index.ts)
- **MCP Server**: Uses `@modelcontextprotocol/sdk` with both stdio and SSE transport modes
- **OpenAPI Processing**: Relies on `openapi2markdown@0.0.6` with built-in tolerant parsing (Chinese locale)
- **Document Storage**: Thread-safe `DocsManager` class with lazy initialization and concurrent request handling
- **Fuzzy Search**: Uses Fuse.js for flexible API discovery across modules
- **Transport Modes**: Supports both stdio (default) and SSE server mode with `--sse` flag

### Key Data Structures
- `ApiDoc`: Contains markdown content and structured module/API data with hierarchical organization
- `DocsManager`: Encapsulates state management with batch query methods (`findModules`, `findApis`)

### Four MCP Tools
1. `list_modules` - Lists all available API documentation modules with overview
2. `list_apis` - Lists APIs within specified modules (batch query support)
3. `show_api` - Shows complete documentation for specific APIs (batch query support)
4. `query_api` - Fuzzy one-shot search across modules/APIs with optional direct view

### Utility Functions
- `extractSectionContent()`: Unified function for parsing Markdown sections by header level
- `extractModulesFromMarkdown()`: Parses Markdown to extract module/API structure
- `getApiDetailsFromMarkdown()`: Extracts specific API documentation sections
- `escapeRegExp()`: Escapes special characters for regex operations

## Development Commands

```bash
# Install dependencies
bun install

# Build the project (compiles TypeScript to dist/)
bun run build

# Type checking without compilation
npx tsc --noEmit

# Run directly in stdio mode (development)
bun run index.ts

# Run in SSE mode for HTTP-based testing
bun run index.ts --sse

# Release workflow (version bump + publish to npm)
bun run release
```

## Environment Configuration

**Required Environment Variable:**
- `DOCS_URL`: Comma-separated list of OpenAPI documentation URLs
  - Example: `"http://localhost:8080/v3/api-docs,http://localhost:8080/v2/api-docs"`

## Server Modes

### Default (stdio mode)
Used for MCP client integration - communicates via stdin/stdout.

### SSE Mode (`--sse` flag)
Starts HTTP server on port 3000 (or PORT env var) with endpoints:
- `/sse` - Server-Sent Events transport
- `/messages` - POST message handling

## Batch Query Architecture

All tools support batch queries for efficient operations:
- **`list_apis`**: Takes `module_names: string[]` to query multiple modules at once
- **`show_api`**: Takes `api_queries: { module_name, api_name }[]` for multiple APIs
- **Partial Success Handling**: Returns found results even if some items are missing
- **Consistent Output Format**: Uses markers like `[multi-module apis start]`, `[not found modules]`

## Fuzzy Search Implementation (query_api)

Uses Fuse.js with weighted field matching:
- **Direct patterns**: Exact match for `Module::API` or `GET /path` syntax
- **Fuzzy matching**: Falls back to Fuse.js when no direct match (threshold: 0.38)
- **Field weights**: api (0.5), path (0.3), module (0.15), method (0.05)
- **Modes**: `auto` (full if 1 match), `summary` (list), `full` (first match details)

## Key Implementation Details

- Uses `ofetch` for HTTP requests to fetch OpenAPI specs
- Thread-safe document manager with promise-based initialization and deduplication
- Regex-based section parsing using `extractSectionContent()` utility
- Comprehensive error handling with structured MCP error responses
- Document initialization happens lazily on first tool invocation
- YAML output format with `js-yaml` for structured data responses