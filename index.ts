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

// Helper functions for fault-tolerant OpenAPI processing

// Clean OpenAPI document by removing problematic fields
function sanitizeOpenApiDoc(doc: any): any {
  if (!doc || typeof doc !== 'object') return doc

  const cleaned = JSON.parse(JSON.stringify(doc))

  // Remove custom extension fields that might cause parsing issues
  const problematicFields = [
    'x-test123', 'x-openapi', 'x-markdownFiles', 'x-ignoreParameters',
    'x-order', 'x-java-class', 'x-tags'
  ]

  function cleanObject(obj: any): void {
    if (!obj || typeof obj !== 'object') return

    // Remove problematic extension fields
    problematicFields.forEach(field => {
      if (field in obj) {
        delete obj[field]
      }
    })

    // Fix schema references with non-ASCII characters
    if (obj.$ref && typeof obj.$ref === 'string') {
      // Replace non-ASCII characters in schema references
      obj.$ref = obj.$ref.replace(/[^\x00-\x7F]/g, 'Schema')
    }

    // Recursively clean nested objects and arrays
    Object.values(obj).forEach(value => {
      if (Array.isArray(value)) {
        value.forEach(cleanObject)
      } else if (value && typeof value === 'object') {
        cleanObject(value)
      }
    })
  }

  cleanObject(cleaned)
  return cleaned
}

// Build markdown manually from OpenAPI JSON when automated parsing fails
function buildMarkdownFromJson(doc: any): string {
  const lines: string[] = []
  
  try {
    // Document title and info
    if (doc.info) {
      lines.push(`# ${doc.info.title || 'API Documentation'}`)
      lines.push('')
      if (doc.info.description) {
        lines.push(doc.info.description)
        lines.push('')
      }
      if (doc.info.version) {
        lines.push(`**Version:** ${doc.info.version}`)
        lines.push('')
      }
    }

    // Process paths/endpoints
    if (doc.paths && typeof doc.paths === 'object') {
      lines.push('## API Endpoints')
      lines.push('')

      // Group by tags if available
      const pathsByTag: Record<string, Array<{path: string, method: string, info: any}>> = {}
      
      Object.entries(doc.paths).forEach(([path, pathInfo]: [string, any]) => {
        if (!pathInfo || typeof pathInfo !== 'object') return

        Object.entries(pathInfo).forEach(([method, methodInfo]: [string, any]) => {
          if (!methodInfo || typeof methodInfo !== 'object') return
          
          const tags = methodInfo.tags || ['Default']
          const tag = tags[0] || 'Default'
          
          if (!pathsByTag[tag]) {
            pathsByTag[tag] = []
          }
          
          pathsByTag[tag].push({
            path,
            method: method.toUpperCase(),
            info: methodInfo
          })
        })
      })

      // Generate markdown for each tag group
      Object.entries(pathsByTag).forEach(([tag, endpoints]) => {
        lines.push(`### ${tag}`)
        lines.push('')

        endpoints.forEach(({ path, method, info }) => {
          const summary = info.summary || info.operationId || `${method} ${path}`
          lines.push(`#### ${summary}`)
          lines.push('')
          lines.push('```http')
          lines.push(`${method} ${path}`)
          lines.push('```')
          lines.push('')
          
          if (info.description) {
            lines.push(info.description)
            lines.push('')
          }
        })
      })
    }

    // Add components info if available
    if (doc.components?.schemas) {
      lines.push('## Data Schemas')
      lines.push('')
      const schemaCount = Object.keys(doc.components.schemas).length
      lines.push(`This API defines ${schemaCount} data schema(s).`)
      lines.push('')
    }

    return lines.join('\n')
  } catch (error) {
    console.error('Error building markdown from JSON:', error)
    return generateJsonSummary(doc)
  }
}

// Generate basic JSON structure summary as fallback
function generateJsonSummary(doc: any): string {
  const lines: string[] = []
  
  try {
    lines.push('# Document Structure Summary')
    lines.push('')
    
    if (doc && typeof doc === 'object') {
      const keys = Object.keys(doc)
      lines.push('**Top-level fields:**')
      keys.forEach(key => {
        const value = doc[key]
        const type = Array.isArray(value) ? 'array' : typeof value
        const count = Array.isArray(value) ? ` (${value.length} items)` : 
                     (type === 'object' && value) ? ` (${Object.keys(value).length} properties)` : ''
        lines.push(`- ${key}: ${type}${count}`)
      })
      lines.push('')

      // Add specific info if available
      if (doc.info?.title) {
        lines.push(`**Title:** ${doc.info.title}`)
      }
      if (doc.info?.version) {
        lines.push(`**Version:** ${doc.info.version}`)
      }
      if (doc.paths) {
        const pathCount = Object.keys(doc.paths).length
        lines.push(`**API Paths:** ${pathCount}`)
      }
      if (doc.components?.schemas) {
        const schemaCount = Object.keys(doc.components.schemas).length
        lines.push(`**Schemas:** ${schemaCount}`)
      }
    } else {
      lines.push('Invalid document structure')
    }

    return lines.join('\n')
  } catch (error) {
    return `# Parse Error\n\nUnable to analyze document structure: ${error}`
  }
}

// Extract modules and API information from OpenAPI document with fault tolerance
async function parseOpenApiToMarkdown(openApiContent: unknown): Promise<string> {
  // Layer 1: Try standard parsing
  try {
    const markdown = await openapi2markdown(openApiContent as any, { lang: "zhCN" })
    console.log("✓ Standard OpenAPI parsing successful")
    return markdown.toString()
  } catch (layer1Error) {
    console.log("✗ Standard parsing failed, trying cleanup approach...")
    
    // Layer 2: Try parsing after cleanup
    try {
      const cleanedContent = sanitizeOpenApiDoc(openApiContent)
      const markdown = await openapi2markdown(cleanedContent, { lang: "zhCN" })
      console.log("✓ Cleaned OpenAPI parsing successful")
      return `# Auto-Cleaned Document\n\n> This document was automatically cleaned to resolve parsing issues.\n\n${markdown.toString()}`
    } catch (layer2Error) {
      console.log("✗ Cleaned parsing failed, building manually...")
      
      // Layer 3: Build markdown manually
      try {
        const manualMarkdown = buildMarkdownFromJson(openApiContent)
        console.log("✓ Manual markdown construction successful")
        return `# Manually Parsed Document\n\n> Standard parsing failed, document was manually processed.\n\n${manualMarkdown}`
      } catch (layer3Error) {
        console.log("✗ Manual parsing failed, using fallback summary...")
        
        // Layer 4: Generate basic summary
        try {
          const summary = generateJsonSummary(openApiContent)
          console.log("✓ Fallback summary generated")
          return `# Document Processing Report\n\n> All automated parsing methods failed, showing basic structure.\n\n**Errors encountered:**\n- Standard parsing: ${layer1Error instanceof Error ? layer1Error.message : String(layer1Error)}\n- Cleaned parsing: ${layer2Error instanceof Error ? layer2Error.message : String(layer2Error)}\n- Manual parsing: ${layer3Error instanceof Error ? layer3Error.message : String(layer3Error)}\n\n${summary}`
        } catch (layer4Error) {
          console.error("All parsing layers failed:", {
            layer1: layer1Error,
            layer2: layer2Error,
            layer3: layer3Error,
            layer4: layer4Error
          })
          return `# Complete Parsing Failure\n\nAll parsing attempts failed:\n\n1. **Standard parsing error:** ${layer1Error instanceof Error ? layer1Error.message : String(layer1Error)}\n2. **Cleaned parsing error:** ${layer2Error instanceof Error ? layer2Error.message : String(layer2Error)}\n3. **Manual parsing error:** ${layer3Error instanceof Error ? layer3Error.message : String(layer3Error)}\n4. **Summary generation error:** ${layer4Error instanceof Error ? layer4Error.message : String(layer4Error)}\n\nPlease check the document format and try again.`
        }
      }
    }
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

// Tool 2: list_apis - List all APIs within the specified module
server.tool(
  "list_apis",
  "List all APIs within the specified module",
  {
    module_name: z.string().describe("Module name"),
  },
  async (args: { module_name: string }) => {
    try {
      await docsManager.ensureInitialized()
      const result = docsManager.findModule(args.module_name)
      
      if (!result) {
        return {
          content: [
            {
              type: "text",
              text: `Module not found: ${args.module_name}`,
            },
          ],
          isError: true,
        }
      }
      
      return {
        content: [
          {
            type: "text",
            text: [
              "[module apis start]",
              dump(result.module.apis),
              "[module apis end]",
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

// Tool 3: show_api - Show complete documentation for a specific API
server.tool(
  "show_api",
  "Show complete documentation for a specific API",
  {
    module_name: z.string().describe("Module name"),
    api_name: z.string().describe("API name"),
  },
  async (args: { module_name: string; api_name: string }) => {
    try {
      await docsManager.ensureInitialized()
      const result = docsManager.findApi(args.module_name, args.api_name)
      
      if (!result) {
        return {
          content: [
            {
              type: "text",
              text: `API not found in module ${args.module_name}: ${args.api_name}`,
            },
          ],
          isError: true,
        }
      }
      
      const apiDetails = getApiDetailsFromMarkdown(
        result.doc.markdown,
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
