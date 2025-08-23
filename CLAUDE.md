# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server for Knife4j OpenAPI documentation. It converts OpenAPI specs to Markdown format with fault-tolerant parsing and provides three main tools for LLMs to interact with API documentation.

## Core Architecture

### Single-file MCP Server (index.ts)
- **MCP Server**: Uses `@modelcontextprotocol/sdk` with both stdio and SSE transport modes
- **OpenAPI Processing**: 4-layer fault-tolerant parsing system for robust document processing
- **Document Storage**: Thread-safe `DocsManager` class with lazy initialization and concurrent request handling
- **Transport Modes**: Supports both stdio (default) and SSE server mode with `--sse` flag

### Key Data Structures
- `OpenAPIDocument`: TypeScript interface for OpenAPI document structure
- `ApiDoc`: Contains markdown content and structured module/API data with hierarchical organization
- `DocsManager`: Encapsulates state management with methods for finding modules and APIs

### Fault-Tolerant Parsing Architecture
The system implements a 4-layer fallback strategy:

1. **Standard Parsing**: Uses `openapi2markdown` library with Chinese locale
2. **Sanitized Parsing**: Removes problematic fields (x-extensions, non-ASCII refs) and retries
3. **Manual Construction**: Builds Markdown from JSON structure when automated parsing fails
4. **Fallback Summary**: Generates basic document structure overview as last resort

### Three MCP Tools (Renamed for Clarity)
1. `list_modules` - Lists all available API documentation modules with overview
2. `list_apis` - Lists APIs within a specific module  
3. `show_api` - Shows complete documentation for a specific API

### Common Utility Functions
- `extractSectionContent()`: Unified function for parsing Markdown sections by header level
- `sanitizeOpenApiDoc()`: Cleans problematic OpenAPI fields that cause parsing failures
- `buildMarkdownFromJson()`: Manual Markdown construction from OpenAPI JSON
- `generateJsonSummary()`: Fallback document structure analysis

## Development Commands

```bash
# Install dependencies
bun install

# Build the project (compiles TypeScript to dist/)
bun run build

# Type checking without compilation
npx tsc --noEmit

# Run directly (development)
bun run index.ts

# Release workflow
bun run release
```

## Environment Configuration

**Required Environment Variable:**
- `DOCS_URL`: Comma-separated list of OpenAPI documentation URLs
  - Example: `"http://localhost:8080/v3/api-docs,http://localhost:8080/v2/api-docs"`

## Server Modes

### Default (stdio mode)
Used for MCP client integration - communicates via stdin/stdout

### SSE Mode (`--sse` flag)
Starts HTTP server on port 3000 (or PORT env var) with:
- `/sse` endpoint for Server-Sent Events transport
- `/messages` endpoint for POST message handling

## Error Handling Strategy

The system prioritizes content delivery over format perfection:
- Multiple parsing strategies ensure users always receive useful information
- Detailed error logging helps with debugging problematic documents
- Graceful degradation from perfect parsing to basic structure summaries
- Console logging shows which parsing layer succeeded for transparency

## Key Implementation Details

- Uses `ofetch` for HTTP requests to fetch OpenAPI specs
- Thread-safe document manager with promise-based initialization
- Regex-free section parsing using `extractSectionContent()` utility
- Comprehensive error handling with structured MCP error responses
- Document initialization happens lazily with concurrent request deduplication