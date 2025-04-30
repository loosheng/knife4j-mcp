# knife4j-mcp

MCP server for [Knife4j](https://doc.xiaominfo.com/) OpenAPI documentation.

This project provides a Model Context Protocol (MCP) server that converts OpenAPI documentation to Markdown format, making it easily accessible to LLMs.

## Features

- Converts OpenAPI documentation to Markdown format
- Extracts modules and APIs from the documentation
- Provides detailed API information
- Supports multiple documentation sources

## Usage

### JSON config

```json
{
  "mcpServers": {
    "knife4j": {
      "command": "npx",
      "args": ["-y", "exa-mcp"],
      "env": {
        "DOCS_URL": "http://<your-knife4j-host>/v3/api-docs,http://<your-knife4j-host>/v2/api-docs"
      }
    }
  }
}
```

## Available Tools

The server provides three main tools:

1. `get_docs` - Get a list of all available document modules
2. `get_module_apis` - Get a list of all APIs under the specified module
3. `get_api_details` - Get detailed information about a specific API

## Development

```bash
# Install dependencies
bun install

# Run the server
bun run index.ts
```
## License

MIT
