import Polka from "polka"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import { z } from "zod"
import { dump } from "js-yaml"
import { version } from "./package.json"
import { openapi2markdown } from "openapi2markdown"
import { ofetch } from "ofetch"

// Check environment variables
const DOCS_URL = process.env.DOCS_URL
if (!DOCS_URL) {
  throw new Error("DOCS_URL environment variable is not set")
}

// Parse multiple URLs
const docsUrls = DOCS_URL.split(",").map((url) => url.trim())

// Store document content
type ApiDoc = {
  markdown: string
  modules: {
    name: string
    description: string
    apis: {
      name: string
      path: string
      method: string
      summary: string
    }[]
  }[]
}

let apiDocs: ApiDoc[] = []

// Initialize MCP server
const server = new McpServer(
  {
    name: "knife4j-mcp",
    version,
  },
  {
    capabilities: {
      logging: {},
    },
  }
)

// Extract modules and API information from OpenAPI document
async function parseOpenApiToMarkdown(openApiContent: any): Promise<string> {
  try {
    // Use openapi2markdown library to convert OpenAPI to Markdown
    const markdown = await openapi2markdown(openApiContent, { lang: "zhCN" })
    return markdown.toString()
  } catch (error: any) {
    console.error("Failed to parse OpenAPI document:", error)
    return `# Parsing Failed\n\nUnable to parse OpenAPI document: ${error.message}`
  }
}

// Extract modules and API information from Markdown
function extractModulesFromMarkdown(markdown: string): ApiDoc["modules"] {
  // Parsing logic, adapted to the provided Markdown structure
  const modules: ApiDoc["modules"] = []

  // Use regular expressions to match second-level headings as modules
  const moduleRegex = /^## (.+?)(?:\r?\n|\r|$)/gm
  let moduleMatch

  while ((moduleMatch = moduleRegex.exec(markdown)) !== null) {
    const moduleName = moduleMatch[1].trim()
    const moduleStartIndex = moduleMatch.index

    // Find the start position of the next module
    const nextModuleRegex = /^## /gm
    nextModuleRegex.lastIndex = moduleStartIndex + moduleMatch[0].length
    const nextModuleMatch = nextModuleRegex.exec(markdown)
    const moduleEndIndex = nextModuleMatch
      ? nextModuleMatch.index
      : markdown.length

    // Extract module content
    const moduleContent = markdown
      .substring(moduleStartIndex, moduleEndIndex)
      .trim()

    // Extract module description (first paragraph of text after the module title, until the first third-level heading)
    const descriptionMatch = moduleContent.match(
      /^## .+?\r?\n\r?\n([\s\S]+?)(?=\r?\n### |$)/
    )
    const moduleDescription = descriptionMatch ? descriptionMatch[1].trim() : ""

    // Extract API list
    const apis = []

    if (apis.length === 0) {
      // Match all third-level headings as API names
      const fallbackApiRegex = /### (.+?)(?:\r?\n|\r)([\s\S]*?)(?=\r?\n### |$)/g
      let fallbackApiMatch

      while (
        (fallbackApiMatch = fallbackApiRegex.exec(moduleContent)) !== null
      ) {
        const apiName = fallbackApiMatch[1].trim()
        const apiContent = fallbackApiMatch[2].trim()

        // Try to extract HTTP method and path from API content
        const methodPathMatch = apiContent.match(
          /```http\r?\n([A-Z]+) ([^\r\n]+)/
        )
        const method = methodPathMatch ? methodPathMatch[1].trim() : "Unknown"
        const path = methodPathMatch ? methodPathMatch[2].trim() : "Unknown"

        apis.push({
          name: apiName,
          path: path,
          method: method,
          summary: apiName,
        })
      }
    }

    modules.push({
      name: moduleName,
      description: moduleDescription,
      apis,
    })
  }

  return modules
}

// Get API details
function getApiDetailsFromMarkdown(
  markdown: string,
  moduleName: string,
  apiName: string
): string {
  // Find module section - using more relaxed regular expressions
  const moduleRegex = new RegExp(
    `^## ${escapeRegExp(moduleName)}(?:\\r?\\n|\\r|$)`,
    "m"
  )
  const moduleMatch = markdown.match(moduleRegex)

  if (!moduleMatch || moduleMatch.index === undefined) {
    return `Module not found: ${moduleName}`
  }

  const moduleStartIndex = moduleMatch.index

  // Find the start position of the next module
  const nextModuleRegex = /^## /gm
  nextModuleRegex.lastIndex = moduleStartIndex + moduleMatch[0].length
  const nextModuleMatch = nextModuleRegex.exec(markdown)
  const moduleEndIndex = nextModuleMatch
    ? nextModuleMatch.index
    : markdown.length

  // Extract module content
  const moduleContent = markdown.substring(moduleStartIndex, moduleEndIndex)

  // Find API section - using more relaxed regular expressions
  const apiRegex = new RegExp(
    `^### ${escapeRegExp(apiName)}(?:\\r?\\n|\\r|$)`,
    "m"
  )
  const apiMatch = moduleContent.match(apiRegex)

  if (!apiMatch || apiMatch.index === undefined) {
    return `API not found in module ${moduleName}: ${apiName}`
  }

  const apiStartIndex = apiMatch.index

  // Find the start position of the next API
  const nextApiRegex = /^### /gm
  nextApiRegex.lastIndex = apiStartIndex + apiMatch[0].length
  const nextApiMatch = nextApiRegex.exec(moduleContent)
  const apiEndIndex = nextApiMatch ? nextApiMatch.index : moduleContent.length

  // Extract API content
  return moduleContent.substring(apiStartIndex, apiEndIndex).trim()
}

// Helper function: Escape special characters in regular expressions
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // $& means the whole matched string
}

// Initialization function: Get and parse all documents
async function initializeDocs() {
  try {
    for (const url of docsUrls) {
      const openApiContent = await ofetch(url)
      const markdown = await parseOpenApiToMarkdown(openApiContent)
      const modules = extractModulesFromMarkdown(markdown)

      apiDocs.push({
        markdown,
        modules,
      })
    }
  } catch (error) {
    throw error
  }
}

// Tool 1: get_docs - Get a list of all available document modules
server.tool(
  "get_docs",
  "Get a list of all available document modules",
  {},
  async () => {
    try {
      // Ensure documents are initialized
      if (apiDocs.length === 0) {
        await initializeDocs()
      }

      // Collect all modules
      const allModules = apiDocs.flatMap((doc) => doc.modules)
      return {
        content: [
          {
            type: "text",
            text: [
              "[docs list start]",
              dump(
                allModules.map((module) => ({
                  name: module.name,
                  description: module.description,
                  api_count: module.apis.length,
                }))
              ),
              "[docs list end]",
            ].join("\n"),
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      }
    }
  }
)

// Tool 2: get_module_apis - Get a list of all APIs under the specified module
server.tool(
  "get_module_apis",
  "Get a list of all APIs under the specified module",
  {
    module_name: z.string().describe("Module name"),
  },
  async (args: { module_name: string }) => {
    try {
      // Ensure documents are initialized
      if (apiDocs.length === 0) {
        await initializeDocs()
      }

      // Find the specified module
      for (const doc of apiDocs) {
        const module = doc.modules.find((m) => m.name === args.module_name)
        if (module) {
          return {
            content: [
              {
                type: "text",
                text: module
                  ? [
                      "[module apis start]",
                      dump(module.apis),
                      "[module apis end]",
                    ].join("\n")
                  : `Module not found: ${args.module_name}`,
              },
            ],
          }
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Module not found: ${args.module_name}`,
          },
        ],
        isError: true,
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      }
    }
  }
)

// Tool 3: get_api_details - Get detailed information about a specific API
server.tool(
  "get_api_details",
  "Get detailed information about a specific API",
  {
    module_name: z.string().describe("Module name"),
    api_name: z.string().describe("API name"),
  },
  async (args: { module_name: string; api_name: string }) => {
    try {
      // Ensure documents are initialized
      if (apiDocs.length === 0) {
        await initializeDocs()
      }

      // Find the specified module and API
      for (const doc of apiDocs) {
        const module = doc.modules.find((m) => m.name === args.module_name)
        if (module) {
          const api = module.apis.find((a) => a.name === args.api_name)
          if (api) {
            const apiDetails = getApiDetailsFromMarkdown(
              doc.markdown,
              args.module_name,
              args.api_name
            )
            return {
              content: [
                {
                  type: "text",
                  text: [
                    "[api details start]",
                    apiDetails,
                    "[api details end]",
                  ].join("\n"),
                },
              ],
            }
          }
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `API not found in module ${args.module_name}: ${args.api_name}`,
          },
        ],
        isError: true,
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      }
    }
  }
)

// Start the server
if (process.argv.includes("--sse")) {
  const transports = new Map<string, SSEServerTransport>()
  const port = Number(process.env.PORT || "3000")

  const app = Polka()

  app.get("/sse", async (_req, res) => {
    const transport = new SSEServerTransport("/messages", res)
    transports.set(transport.sessionId, transport)
    res.on("close", () => {
      transports.delete(transport.sessionId)
    })
    await server.connect(transport)
  })

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string
    const transport = transports.get(sessionId)
    if (transport) {
      await transport.handlePostMessage(req, res)
    } else {
      res.status(400).send("No transport found for sessionId")
    }
  })

  app.listen(port)
  console.log(`SSE server running at: http://localhost:${port}/sse`)
} else {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
