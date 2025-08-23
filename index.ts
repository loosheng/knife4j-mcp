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

// Types for OpenAPI document structure
interface OpenAPIDocument {
  openapi?: string
  swagger?: string
  info: {
    title: string
    version: string
    description?: string
  }
  paths: Record<string, any>
  components?: Record<string, any>
  servers?: Array<{ url: string; description?: string }>
  [key: string]: any
}

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

// Documents manager class - encapsulates state and provides thread-safe access
class DocsManager {
  private docs: ApiDoc[] = []
  private initialized = false
  private initPromise: Promise<void> | null = null

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    
    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = this.loadDocs()
    await this.initPromise
    this.initialized = true
  }

  private async loadDocs(): Promise<void> {
    try {
      for (const url of docsUrls) {
        const openApiContent = await ofetch(url)
        const markdown = await parseOpenApiToMarkdown(openApiContent)
        const modules = extractModulesFromMarkdown(markdown)

        this.docs.push({
          markdown,
          modules,
        })
      }
    } catch (error) {
      console.error("Failed to initialize docs:", error)
      throw error
    }
  }

  getAllModules(): ApiDoc["modules"][0][] {
    return this.docs.flatMap(doc => doc.modules)
  }

  findModule(moduleName: string): { doc: ApiDoc; module: ApiDoc["modules"][0] } | null {
    for (const doc of this.docs) {
      const module = doc.modules.find(m => m.name === moduleName)
      if (module) {
        return { doc, module }
      }
    }
    return null
  }

  findApi(moduleName: string, apiName: string): { doc: ApiDoc; module: ApiDoc["modules"][0]; api: ApiDoc["modules"][0]["apis"][0] } | null {
    const result = this.findModule(moduleName)
    if (!result) return null
    
    const api = result.module.apis.find(a => a.name === apiName)
    if (!api) return null

    return { ...result, api }
  }

  findModules(moduleNames: string[]): { found: Array<{ doc: ApiDoc; module: ApiDoc["modules"][0]; name: string }>; notFound: string[] } {
    const found: Array<{ doc: ApiDoc; module: ApiDoc["modules"][0]; name: string }> = []
    const notFound: string[] = []

    for (const moduleName of moduleNames) {
      const result = this.findModule(moduleName)
      if (result) {
        found.push({ ...result, name: moduleName })
      } else {
        notFound.push(moduleName)
      }
    }

    return { found, notFound }
  }

  findApis(queries: Array<{ module_name: string; api_name: string }>): { 
    found: Array<{ doc: ApiDoc; module: ApiDoc["modules"][0]; api: ApiDoc["modules"][0]["apis"][0]; query: { module_name: string; api_name: string } }>;
    notFound: Array<{ module_name: string; api_name: string }>
  } {
    const found: Array<{ doc: ApiDoc; module: ApiDoc["modules"][0]; api: ApiDoc["modules"][0]["apis"][0]; query: { module_name: string; api_name: string } }> = []
    const notFound: Array<{ module_name: string; api_name: string }> = []

    for (const query of queries) {
      const result = this.findApi(query.module_name, query.api_name)
      if (result) {
        found.push({ ...result, query })
      } else {
        notFound.push(query)
      }
    }

    return { found, notFound }
  }
}

const docsManager = new DocsManager()

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

// Helper functions for OpenAPI processing

// Convert OpenAPI document to Markdown using tolerant parsing
async function parseOpenApiToMarkdown(openApiContent: unknown): Promise<string> {
  try {
    const markdown = await openapi2markdown(openApiContent as any, { lang: "zhCN" })
    console.log("✓ OpenAPI to Markdown conversion successful")
    return markdown.toString()
  } catch (error) {
    console.error("OpenAPI parsing failed:", error)
    throw new Error(`Failed to parse OpenAPI document: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Common function to extract section content from Markdown
function extractSectionContent(
  text: string,
  sectionName: string,
  headerLevel: string
): { content: string; startIndex: number; endIndex: number } | null {
  const sectionRegex = new RegExp(
    `^${headerLevel} ${escapeRegExp(sectionName)}(?:\\r?\\n|\\r|$)`,
    "m"
  )
  const sectionMatch = text.match(sectionRegex)

  if (!sectionMatch || sectionMatch.index === undefined) {
    return null
  }

  const startIndex = sectionMatch.index

  // Find the next section at the same level
  const remainingText = text.slice(startIndex + sectionMatch[0].length)
  const nextSectionMatch = remainingText.match(new RegExp(`^${headerLevel} `, "m"))
  const endIndex = nextSectionMatch && nextSectionMatch.index !== undefined
    ? startIndex + sectionMatch[0].length + nextSectionMatch.index
    : text.length

  return {
    content: text.substring(startIndex, endIndex).trim(),
    startIndex,
    endIndex
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
    const remainingMarkdown = markdown.slice(moduleStartIndex + moduleMatch[0].length)
    const nextModuleMatch = remainingMarkdown.match(/^## /m)
    const moduleEndIndex = nextModuleMatch && nextModuleMatch.index !== undefined
      ? moduleStartIndex + moduleMatch[0].length + nextModuleMatch.index
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
    
    // Match all third-level headings as API names
    const apiRegex = /### (.+?)(?:\r?\n|\r)([\s\S]*?)(?=\r?\n### |$)/g
    let apiMatch

    while ((apiMatch = apiRegex.exec(moduleContent)) !== null) {
      const apiName = apiMatch[1].trim()
      const apiContent = apiMatch[2].trim()

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

    modules.push({
      name: moduleName,
      description: moduleDescription,
      apis,
    })
  }

  return modules
}

// Get API details using the common section extraction function
function getApiDetailsFromMarkdown(
  markdown: string,
  moduleName: string,
  apiName: string
): string {
  // Find module section
  const moduleSection = extractSectionContent(markdown, moduleName, "##")
  if (!moduleSection) {
    return `Module not found: ${moduleName}`
  }

  // Find API section within the module
  const apiSection = extractSectionContent(moduleSection.content, apiName, "###")
  if (!apiSection) {
    return `API not found in module ${moduleName}: ${apiName}`
  }

  return apiSection.content
}

// Helper function: Escape special characters in regular expressions
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // $& means the whole matched string
}

// Tool 1: list_modules - List all available API documentation modules
server.tool(
  "list_modules",
  "List all available API documentation modules with overview",
  {},
  async () => {
    try {
      await docsManager.ensureInitialized()
      const allModules = docsManager.getAllModules()
      
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

// Tool 2: list_apis - List all APIs within the specified modules
server.tool(
  "list_apis",
  "List all APIs within the specified modules",
  {
    module_names: z.array(z.string()).describe("Array of module names to query"),
  },
  async (args: { module_names: string[] }) => {
    try {
      await docsManager.ensureInitialized()
      const { found, notFound } = docsManager.findModules(args.module_names)
      
      // Build output content
      const content = ["[multi-module apis start]"]
      
      // Add APIs for each found module
      for (const { module, name } of found) {
        content.push(`${name}:`)
        content.push(dump(module.apis).replace(/^/gm, '  ')) // Indent the YAML content
      }
      
      // Add not found modules if any
      if (notFound.length > 0) {
        content.push("[not found modules]:")
        content.push(dump(notFound).replace(/^/gm, '  '))
      }
      
      content.push("[multi-module apis end]")
      
      return {
        content: [
          {
            type: "text",
            text: content.join("\n"),
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

// Tool 3: show_api - Show complete documentation for multiple APIs
server.tool(
  "show_api",
  "Show complete documentation for multiple APIs",
  {
    api_queries: z.array(z.object({
      module_name: z.string().describe("Module name"),
      api_name: z.string().describe("API name"),
    })).describe("Array of API queries (module_name and api_name pairs)"),
  },
  async (args: { api_queries: Array<{ module_name: string; api_name: string }> }) => {
    try {
      await docsManager.ensureInitialized()
      const { found, notFound } = docsManager.findApis(args.api_queries)
      
      // Build output content
      const content = ["[multi-api details start]"]
      
      // Add details for each found API
      for (const { doc, query } of found) {
        const apiDetails = getApiDetailsFromMarkdown(
          doc.markdown,
          query.module_name,
          query.api_name
        )
        
        content.push(`${query.module_name}::${query.api_name}:`)
        content.push(apiDetails.replace(/^/gm, '  ')) // Indent the content
        content.push('') // Add empty line between APIs
      }
      
      // Add not found APIs if any
      if (notFound.length > 0) {
        content.push("[not found apis]:")
        for (const query of notFound) {
          content.push(`  - ${query.module_name}::${query.api_name}`)
        }
      }
      
      content.push("[multi-api details end]")
      
      return {
        content: [
          {
            type: "text",
            text: content.join("\n"),
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
