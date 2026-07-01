import { MongoClient } from "mongodb";
import { TextContent } from "@modelcontextprotocol/sdk/types.js";
import { updateTypesenseFilterWithCompanyImos, isValidImoForCompany, isValidVesselImoForCompany, isValidFleetImoForCompany, filterImoListByCompany } from "./company-filtering.js";
import { getTypesenseClient, type TypesenseConfig } from "./typesense.js";

export async function getComponentData(
    componentId: string,
    vesselComponentsDbName: string,
    vesselComponentsMongoUri: string,
    collectionName: string = 'vesselinfocomponents',
    showNestedTables: boolean = false
): Promise<string> {
    const match = componentId.match(/^(\d+)_(\d+)_(\d+)$/);
    if (!match) {
        return `⚠️ Invalid component_id format: ${componentId}`;
    }

    if (!vesselComponentsDbName || !vesselComponentsMongoUri || !collectionName) {
        return `⚠️ Database name, MongoDB URI, and collection name are required`;
    }

    const [, componentNumber, questionNumber, imo] = match;
    const componentNo = `${componentNumber}_${questionNumber}_${imo}`;

    const mongoClient = new MongoClient(vesselComponentsMongoUri);
    await mongoClient.connect();

    try {
        const db = mongoClient.db(vesselComponentsDbName);
        const collection = db.collection(collectionName);

        const doc = await collection.findOne({ componentNo });
        if (!doc) {
            return `⚠️ No component found for ID: ${componentId}`;
        }

        if (!doc.data) {
            return "No data found in the table component";
        }

        if (!doc.data.headers || !Array.isArray(doc.data.headers)) {
            return "No headers found in the table component";
        }

        if (!doc.data.body || !Array.isArray(doc.data.body)) {
            return "No body data found in the table component";
        }

        // Helper function to format a cell value
        const formatCellValue = (cell: any): string => {
            if (!cell) return '';
            if (cell.value && cell.link) {
                return `[${cell.value}](${cell.link})`;
            }
            if (cell.status !== undefined) {
                return `${cell.status}`;
            }
            if (typeof cell === 'string' && cell.startsWith('<a href=')) {
                const linkMatch = cell.match(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/);
                if (linkMatch) {
                    return `[${linkMatch[2]}](${linkMatch[1]})`;
                }
            }
            if (cell instanceof Date && !isNaN(cell.getTime())) {
                return cell.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
            }
            if (typeof cell === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(cell)) {
                try {
                    const date = new Date(cell);
                    return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
                } catch {
                    return cell;
                }
            }
            return String(cell);
        };

        // Helper function to format detailed section with parent row data and nested table
        const formatDetailedSection = (row: any[], headers: string[], lineitemData: any, rowNumber: number): string => {
            let sectionMd = `\n### Row ${rowNumber}\n\n`;

            for (let i = 0; i < headers.length && i < row.length; i++) {
                const cell = row[i];
                if (cell && !cell.lineitem) {
                    const value = formatCellValue(cell);
                    if (value && value.trim()) {
                        sectionMd += `- **${headers[i]}:** ${value}\n`;
                    }
                }
            }

            if (lineitemData && lineitemData.headers && lineitemData.body) {
                sectionMd += "\n**Additional Details:**\n\n";
                const nestedHeaders = lineitemData.headers.map((h: any) => h.headerName || h.name || h.field || 'Column');
                sectionMd += "| " + nestedHeaders.join(" | ") + " |\n";
                sectionMd += "| " + nestedHeaders.map(() => "---").join(" | ") + " |\n";

                for (const nestedRow of lineitemData.body) {
                    const nestedCells = lineitemData.headers.map((header: any) => {
                        const field = header.field;
                        const cellValue = nestedRow[field];
                        return formatCellValue(cellValue);
                    });
                    sectionMd += "| " + nestedCells.join(" | ") + " |\n";
                }
            }

            return sectionMd;
        };

        // Extract headers excluding lineitem
        const headers = doc.data.headers
            .filter((h: any) => h && h.name !== "lineitem")
            .map((h: any) => h.name);

        const rows = doc.data.body;

        let md = "";
        if (doc.data.heading) {
            md += `## ${doc.data.heading}\n\n`;
        }

        if (showNestedTables) {
            let hasNestedData = false;
            for (const row of rows) {
                for (const cell of row) {
                    if (cell && cell.lineitem) {
                        hasNestedData = true;
                        break;
                    }
                }
                if (hasNestedData) break;
            }

            if (hasNestedData) {
                for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
                    const row = rows[rowIndex];
                    let lineitemData: any = null;
                    for (const cell of row) {
                        if (cell && cell.lineitem) {
                            lineitemData = cell.lineitem;
                            break;
                        }
                    }
                    if (lineitemData) {
                        md += formatDetailedSection(row, headers, lineitemData, rowIndex + 1);
                    }
                }
            } else {
                md += "| " + headers.join(" | ") + " |\n";
                md += "| " + headers.map(() => "---").join(" | ") + " |\n";
                for (const row of rows) {
                    const formattedRow = row
                        .filter((cell: any) => cell !== null && cell !== undefined && !(cell && cell.lineitem))
                        .map((cell: any) => formatCellValue(cell));
                    md += "| " + formattedRow.join(" | ") + " |\n";
                }
            }
        } else {
            md += "| " + headers.join(" | ") + " |\n";
            md += "| " + headers.map(() => "---").join(" | ") + " |\n";
            for (const row of rows) {
                const formattedRow = row
                    .filter((cell: any) => cell !== null && cell !== undefined && !(cell && cell.lineitem))
                    .map((cell: any) => formatCellValue(cell));
                md += "| " + formattedRow.join(" | ") + " |\n";
            }
        }

        return md;
    } catch (error: any) {
        return `⚠️ Error getting component data: ${error.message}`;
    } finally {
        await mongoClient.close();
    }
}

export async function addComponentData(answer: string, imo: string, vesselComponentsDbName: string, vesselComponentsMongoUri: string, showNestedTables: boolean = false): Promise<string> {
    const pattern = /https[^\/]+\/chat\/ag-grid-table\?component=(\d+_\d+)/g;
    const matches = Array.from(answer.matchAll(pattern));

    let result = answer;
    for (const match of matches) {
        const component = match[1];
        try {
            const replacement = await getComponentData(`${component}_${imo}`, vesselComponentsDbName, vesselComponentsMongoUri, 'vesselinfocomponents', showNestedTables);
            result = result.replace(match[0], replacement);
        } catch (error) {
            // Silently continue on error
        }
    }

    return result;
}

export async function getVesselQnASnapshot(
    imo: string,
    questionNo: string,
    apiKey: string,
    baseUrl: string = 'https://dev-api.siya.com'
): Promise<any> {
    try {
        // Validate inputs
        if (!imo || !questionNo) {
            throw new Error('IMO and question number are required');
        }

        if (!apiKey) {
            throw new Error('SIYA API key is required');
        }

        // API endpoint
        const snapshotUrl = `${baseUrl}/v1.0/vessel-info/qna-snapshot/${imo}/${questionNo}`;

        // Authentication token
        const jwtToken = `Bearer ${apiKey}`;

        // Headers for the request
        const headers = {
            "Authorization": jwtToken
        };

        const response = await fetch(snapshotUrl, {
            method: 'GET',
            headers
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json() as any;

        // Return resultData if it exists, otherwise return the full response
        if (data && "resultData" in data && typeof data.resultData === 'string') {
            return data.resultData;
        }
        return data;
    } catch (error: any) {
        console.error(`Error fetching vessel QnA snapshot for IMO ${imo}, Question ${questionNo}:`, error);
        return null;
    }
}

export interface FetchQADetailsOptions {
    vesselComponentsDbName?: string;
    vesselComponentsMongoUri?: string;
    siyaApiKey?: string;
    siyaApiBaseUrl?: string;
    showNestedTables?: boolean;
}

export async function fetchQADetails(
    imo: string,
    qaId: number,
    vesselInfoDbName: string,
    vesselInfoMongoUri: string,
    collectionName?: string,
    optionsOrVesselComponentsDbName?: FetchQADetailsOptions | string,
    vesselComponentsMongoUriLegacy?: string,
    siyaApiKeyLegacy?: string,
    siyaApiBaseUrlLegacy?: string,
    showNestedTablesLegacy?: boolean
): Promise<any> {
    const finalCollectionName = collectionName || 'vesselinfos';

    // Support both calling conventions:
    // New: fetchQADetails(imo, qaId, dbName, mongoUri, collectionName, { options })
    // Legacy: fetchQADetails(imo, qaId, dbName, mongoUri, collectionName, compDbName, compUri, apiKey, apiUrl, showNested)
    let vesselComponentsDbName: string | undefined;
    let vesselComponentsMongoUri: string | undefined;
    let siyaApiKey: string | undefined;
    let siyaApiBaseUrl: string | undefined;
    let showNestedTables = false;

    if (typeof optionsOrVesselComponentsDbName === 'object' && optionsOrVesselComponentsDbName !== null && optionsOrVesselComponentsDbName !== undefined) {
        // New options object calling convention
        const opts = optionsOrVesselComponentsDbName as FetchQADetailsOptions;
        vesselComponentsDbName = opts.vesselComponentsDbName;
        vesselComponentsMongoUri = opts.vesselComponentsMongoUri;
        siyaApiKey = opts.siyaApiKey;
        siyaApiBaseUrl = opts.siyaApiBaseUrl;
        showNestedTables = opts.showNestedTables || false;
    } else {
        // Legacy positional calling convention
        vesselComponentsDbName = optionsOrVesselComponentsDbName as string | undefined;
        vesselComponentsMongoUri = vesselComponentsMongoUriLegacy;
        siyaApiKey = siyaApiKeyLegacy;
        siyaApiBaseUrl = siyaApiBaseUrlLegacy;
        showNestedTables = showNestedTablesLegacy || false;
    }

    const mongoClient = new MongoClient(vesselInfoMongoUri);
    await mongoClient.connect();

    try {
        const db = mongoClient.db(vesselInfoDbName);
        const collection = db.collection(finalCollectionName);

        const query = {
            'imo': parseInt(imo),
            'questionNo': qaId
        };

        const projection = {
            '_id': 0,
            'imo': 1,
            'vesselName': 1,
            'refreshDate': 1,
            'answer': 1,
            'detailedAnswer': 1
        };

        interface QAResponse {
            imo: number;
            vesselName: string | null;
            refreshDate: string | null;
            answer: string | null;
            detailedAnswer?: string | null;
            link?: string | null;
        }

        const mongoResult = await collection.findOne(query, { projection });
        let res: QAResponse = mongoResult ? {
            imo: mongoResult.imo as number,
            vesselName: mongoResult.vesselName as string | null,
            refreshDate: mongoResult.refreshDate as string | null,
            answer: mongoResult.answer as string | null,
            detailedAnswer: mongoResult.detailedAnswer as string | null
        } : {
            imo: parseInt(imo),
            vesselName: null,
            refreshDate: null,
            answer: null,
            detailedAnswer: null
        };

        // Format refresh date if it exists
        if (res.refreshDate && new Date(res.refreshDate).toString() !== 'Invalid Date') {
            res.refreshDate = new Date(res.refreshDate).toLocaleDateString('en-US', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            });
        }

        // Process answer with component data if it exists
        if (res.answer) {
            const componentsDbName = vesselComponentsDbName || vesselInfoDbName;
            const componentsMongoUri = vesselComponentsMongoUri || vesselInfoMongoUri;
            res.answer = await addComponentData(res.answer, imo, componentsDbName, componentsMongoUri, showNestedTables);
        }

        // Get vessel QnA snapshot link (only if API key is provided)
        if (siyaApiKey) {
            try {
                res.link = await getVesselQnASnapshot(imo, qaId.toString(), siyaApiKey, siyaApiBaseUrl);
            } catch (error) {
                res.link = null;
            }
        } else {
            res.link = null;
        }

        return res;
    } catch (error: any) {
        throw new Error(`Error in fetchQADetails: ${error.message}`);
    } finally {
        await mongoClient.close();
    }
}



export async function fetchQADetailsAndCreateResponse(
    imo: string | undefined,
    questionNo: number,
    functionName: string,
    linkHeader: string,
    vesselInfoDbName: string,
    vesselInfoMongoUri: string,
    collectionName: string = 'vesselinfos',
    showNestedTables: boolean = false,
    insightName?: string,
    options?: FetchQADetailsOptions
): Promise<any> {
    if (!imo) {
        return {
            content: [{ type: "text", text: "IMO is required" }],
            isError: true
        };
    }

    try {
        // Fetch QA details - merge showNestedTables with any additional options (siyaApiKey, siyaApiBaseUrl, etc.)
        const fetchOptions: FetchQADetailsOptions = {
            ...options,
            showNestedTables
        };
        const result = await fetchQADetails(imo, questionNo, vesselInfoDbName, vesselInfoMongoUri, collectionName, fetchOptions);
        const link = result.link || result.Artifactlink;

        // Get artifact data
        const artifactData = await getArtifact(functionName, link, insightName);

        // Create content responses with processed answer
        const detailedAnswerText = result.detailedAnswer ? `\n\n${result.detailedAnswer}` : "";
        const artifactLinkText = link ? `\n\nArtifact Link: ${link}` : "";
        const content: TextContent = {
            type: "text",
            text: `${result.answer || "No data available"}${detailedAnswerText}${artifactLinkText}`
        };

        const artifact: TextContent = {
            type: "text",
            text: JSON.stringify(artifactData, null, 2)
        };

        return {
            content: [content, artifact]
        };
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error in ${functionName}: ${error.message}` }],
            isError: true
        };
    }
}




export async function getArtifact(toolName: string, link: string, insightName?: string): Promise<any> {
  try {
      const timestamp = Math.floor(Date.now() / 1000);
      const artifact = {
          id: `msg_browser_${Math.random().toString(36).substring(2, 8)}`,
          parentTaskId: `task_${toolName}_${Math.random().toString(36).substring(2, 8)}`,
          timestamp,
          agent: {
              id: "agent_siya_browser",
              name: "SIYA",
              type: "qna"
          },
          messageType: "action",
          action: {
              tool: "browser",
              operation: "browsing",
              params: {
                  url: link,
                  pageTitle: `Tool response for ${toolName}`,
                  visual: {
                      icon: "browser",
                      color: "#2D8CFF"
                  },
                  stream: {
                      type: "vnc",
                      streamId: "stream_browser_1",
                      target: "browser"
                  }
              }
          },
          content: `Viewed page: ${toolName}`,
          artifacts: [
              {
                  id: `artifact_webpage_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                  type: "browser_view",
                  content: {
                      url: link,
                      title: toolName,
                      screenshot: "",
                      textContent: `Observed output of cmd \`${insightName || toolName}\` executed:`,
                      extractedInfo: {}
                  },
                  metadata: {
                      domainName: "example.com",
                      visitTimestamp: Date.now(),
                      category: "web_page"
                  }
              }
          ],
          status: "completed"
      };

      return artifact;
  } catch (error: any) {
      return {
          content: [{ type: "text", text: `Error in getArtifact: ${error.message}` }],
          isError: true
      };
  }
}

export async function getVesselImoListFromFleet(
    fleetImo: number,
    dbName: string,
    mongoUri: string,
    collectionName: string = "common_group_details"
): Promise<number[]> {
    if (!dbName || !mongoUri || !collectionName) {
      return [];
    }

    const mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();

    try {
      const db = mongoClient.db(dbName);
      const collection = db.collection(collectionName);

      const fleetDoc = await collection.findOne({ imo: fleetImo });

      if (fleetDoc && fleetDoc.imoList && Array.isArray(fleetDoc.imoList)) {
        return fleetDoc.imoList;
      }

      return [];
    } catch (error) {
      return [];
    } finally {
      await mongoClient.close();
    }
  }

export async function getVesselNameFromImo(
  vesselImo: number,
  dbName: string,
  mongoUri: string,
  collectionName: string = "common_vessel_details"
): Promise<string | null> {
  if (!dbName || !mongoUri || !collectionName) {
    const missing = [];
    if (!dbName) missing.push('dbName');
    if (!mongoUri) missing.push('mongoUri');
    throw new Error(`Database configuration missing. Required parameters: ${missing.join(', ')}`);
  }

  const mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();

  try {
    const db = mongoClient.db(dbName);
    const collection = db.collection(collectionName);

    const vesselDoc = await collection.findOne({ imo: vesselImo });

    if (vesselDoc && vesselDoc.vesselName) {
      return vesselDoc.vesselName as string;
    }

    return null;
  } catch (error) {
    throw error;
  } finally {
    await mongoClient.close();
  }
}


const DEFAULT_DATE_FIELDS = [
    'purchaseRequisitionDate',
    'purchaseOrderIssuedDate',
    'orderReadinessDate',
    'date',
    'poDate',
    'expenseDate',
    'inspectionTargetDate',
    'reportDate',
    'closingDate',
    'targetDate',
    'nextDueDate',
    'extendedDate',
    'issueDate',
    'extensionDate',
    'expiryDate',
    'windowStartDate',
    'windowEndDate'
];

export function convertUnixDates(document: any, dateFields?: string[]): any {
  const result = { ...document };
  const fields = dateFields || DEFAULT_DATE_FIELDS;

  for (const field of fields) {
      const value = result[field];
      if (typeof value === "number" && Number.isFinite(value)) {
          result[field] = new Date(value * 1000).toISOString();
      }
  }

  return result;
}


export async function getDataLink(data: any[]): Promise<string> {
  try {
      const snapshotUrl = process.env.SNAPSHOT_URL || "";

      const jwtToken = process.env.JWT_TOKEN || "";
      const headers = {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${jwtToken}`
      };
      const payload = {
          data
      };

      const response = await fetch(snapshotUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
      });

      if (!response.ok) {
          return "";
      }

      const result = await response.json() as any;

      if (result.status === "OK") {
          return result.resultData;
      } else {
          return "";
      }
  } catch (error: any) {
      return "";
  }
}


export async function processTypesenseResults(
  searchResult: any,
  toolName: string,
  title: string,
  linkHeader: string,
  artifactTitle?: string,
  dbName?: string,
  mongoUri?: string
): Promise<any> {
  try {
      if (!searchResult || !searchResult.hits || searchResult.hits.length === 0) {
          return {
            content : [{
              type: "text",
              text: "No records found for the specified criteria."
          }]
        };
      }

      // Process search results into the standard format
      const hits = searchResult.hits || [];

      const documents = await Promise.all(hits.map(async (hit: any, index: number) => {
          if (!hit.document) {
              return {};
          }

          // Create a shallow copy of the document
          const document = { ...hit.document };

          // Remove embedding field to reduce response size
          if (document.embedding) {
              delete document.embedding;
          }

          // Convert Unix timestamps to readable dates
          return await convertUnixDates(document);
      }));

      // Get data link
      const dataLink = await getDataLink(documents);

      // Get vessel name and IMO from hits
      let vesselName = null;
      let imo = null;
      try {
          vesselName = searchResult.hits[0]?.document?.vesselName;
          imo = searchResult.hits[0]?.document?.imo;
      } catch (error) {
          // Silently continue
      }

      // Format results in the standard structure
      const formattedResults = {
          recordsInResponse: documents.length,
          found: searchResult.found || 0,
          out_of: searchResult.out_of || 0,
          page: searchResult.page || 1,
          hits: documents,
          artifactLink: dataLink
      };

      // Get artifact data
      const artifactData = await getArtifact(toolName, dataLink);

      // Create content response
      const content_: any = {
          type: "text",
          text: JSON.stringify(formattedResults, null, 2),
          title,
          format: "json"
      };

      // Create artifact response
      const artifact: any = {
          type: "text",
          text: JSON.stringify(artifactData, null, 2),
          title: artifactTitle || title,
          format: "json"
      };

      return {
        content : [content_, artifact]
      };
  } catch (error: any) {
      return {
        content : [{
          type: "text",
          text: `Error: ${error.message}`,
        }],
        isError: true
      };
  }
}

export async function exportDataForImoListGeneric(
    collectionName: string,
    imoList: number[],
    typesenseConfig: TypesenseConfig,
    startDate?: string,
    endDate?: string,
    dateField?: string,
    excludeFields: string = "",
    timestampFields: string[] = []
): Promise<any[]> {
    try {
        // Filter IMO list to only include company IMOs
        const filteredImoList = await filterImoListByCompany(imoList);

        if (filteredImoList.length === 0) {
            return []; // Return empty array if no valid IMOs
        }

        const client = await getTypesenseClient(typesenseConfig);
        if ('isError' in client) {
            return [];
        }
        const collection = client.collections(collectionName);

        const dateToTs = (dateStr: string): number => {
            return Math.floor(new Date(dateStr).getTime() / 1000);
        };

        const filterParts = [`imo:[${filteredImoList.join(',')}]`];
        if (startDate && dateField) {
            filterParts.push(`${dateField}:>=${dateToTs(startDate)}`);
        }
        if (endDate && dateField) {
            filterParts.push(`${dateField}:<=${dateToTs(endDate)}`);
        }

        const filterBy = filterParts.join(" && ");
        const query = {
            filter_by: filterBy,
            exclude_fields: excludeFields
        };

        const exportResult = await collection.documents().export(query);

        let exportData: string;
        if (typeof exportResult === 'string') {
            exportData = exportResult;
        } else if (exportResult && typeof exportResult === 'object' && 'buffer' in exportResult) {
            exportData = new TextDecoder().decode(exportResult as ArrayBuffer);
        } else {
            exportData = String(exportResult);
        }

        const documents = exportData
            .split('\n')
            .filter(line => line.trim())
            .map(line => JSON.parse(line));

        // Convert UNIX timestamps to readable date strings
        for (const doc of documents) {
            for (const field of timestampFields) {
                if (field in doc && typeof doc[field] === 'number') {
                    try {
                        doc[field] = new Date(doc[field] * 1000).toISOString().replace('T', ' ').substring(0, 19);
                    } catch (err) {
                        // Leave original value on error
                    }
                }
            }
        }

        return documents;
    } catch (error) {
        return [];
    }
}

// ============================================================================
// MCP Response Helpers
// ============================================================================

/**
 * MCP Protocol Error Response Helper
 *
 * Creates a properly formatted MCP error response with isError flag.
 * According to MCP spec, tool errors should be returned with isError: true
 * so that LLMs can see the error and self-correct.
 */
export interface MCPErrorResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError: true;
}

export interface MCPSuccessResponse {
  content: Array<{
    type: 'text' | 'image' | 'audio';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
}

export type MCPResponse = MCPErrorResponse | MCPSuccessResponse;

/**
 * Create an MCP-compliant error response
 */
export function createErrorResponse(message: string): MCPErrorResponse {
  return {
    content: [{
      type: 'text',
      text: message
    }],
    isError: true
  };
}

/**
 * Create an MCP-compliant success response
 * Note: isError defaults to false per MCP spec, so we don't need to set it explicitly
 */
export function createSuccessResponse(text: string): MCPSuccessResponse {
  return {
    content: [{
      type: 'text',
      text
    }]
  };
}

// ============================================================================
// String Utility Functions
// ============================================================================

/**
 * Sanitize query string by replacing special characters with spaces
 */
export function sanitizeQuery(query: string): string {
  // Replace special characters with space
  return query.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
}

/**
 * Check if a field name is in camelCase format
 */
export function isCamelCase(fieldName: string): boolean {
  // Ignore MongoDB operators (start with $) and _id field
  if (fieldName.startsWith('$') || fieldName === '_id') {
    return true;
  }
  // Check if contains underscore (snake_case) or starts with uppercase
  return !fieldName.includes('_') && !/^[A-Z]/.test(fieldName);
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy string matching and suggestions
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Find similar field names using fuzzy matching
 * Returns top 5 closest matches based on Levenshtein distance
 */
export function findSimilarFields(fieldName: string, validFields: string[], maxDistance: number = 3): string[] {
  const similar: Array<{ field: string; distance: number }> = [];

  for (const validField of validFields) {
    const distance = levenshteinDistance(fieldName.toLowerCase(), validField.toLowerCase());
    if (distance <= maxDistance) {
      similar.push({ field: validField, distance });
    }
  }

  // Sort by distance (closest first) and return field names
  return similar
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5) // Return top 5 suggestions
    .map(s => s.field);
}

// ============================================================================
// Data Extraction and Validation Utilities
// ============================================================================

/**
 * Extract all field names from a document (including nested fields)
 * Useful for schema discovery and validation
 */
export function extractDocumentFields(doc: any, prefix: string = ''): Set<string> {
  const fields = new Set<string>();

  if (typeof doc !== 'object' || doc === null) {
    return fields;
  }

  for (const [key, value] of Object.entries(doc)) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    fields.add(fieldPath);

    // For nested objects (but not arrays), recursively extract fields
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const nestedFields = extractDocumentFields(value, fieldPath);
      nestedFields.forEach(f => fields.add(f));
    }
  }

  return fields;
}

/**
 * Extract field names used in a MongoDB aggregation pipeline
 * Helps validate field references and detect typos
 */
export function extractPipelineFields(pipeline: any[]): Set<string> {
  const usedFields = new Set<string>();

  // Query operators that should preserve parent $match context
  const queryOperators = new Set(['$or', '$and', '$nor', '$not', '$in', '$nin', '$elemMatch']);

  function extractFields(obj: any, parentOperator: string = '') {
    // Handle string values (field references like "$fieldName")
    if (typeof obj === 'string' && obj.startsWith('$') && !obj.startsWith('$$')) {
      const fieldRef = obj.substring(1);
      // Only validate if we're NOT in $project, or if it's a simple field (no dots)
      // This avoids false positives from intermediate fields like "$_id.fleet" in $project
      if (parentOperator !== '$project' || !fieldRef.includes('.')) {
        usedFields.add(fieldRef);
      }
      return;
    }

    if (typeof obj !== 'object' || obj === null) {
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach(item => extractFields(item, parentOperator));
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      const isOperator = key.startsWith('$');

      // Only validate field names in $match (where keys are input fields being queried)
      // This avoids false positives from output fields in $group, $project, etc.
      if (parentOperator === '$match' && !isOperator && key !== '_id') {
        usedFields.add(key);
      }

      // Special handling for $lookup: localField and foreignField are field references
      if (parentOperator === '$lookup' && (key === 'localField' || key === 'foreignField') && typeof value === 'string') {
        usedFields.add(value);
      }

      // Recurse with context:
      // - Query operators ($or, $and, etc.) preserve the parent context (e.g., $match)
      // - Other operators become the new context
      // - Non-operators keep the parent context
      const isQueryOperator = isOperator && queryOperators.has(key);
      const nextContext = isOperator ? (isQueryOperator ? parentOperator : key) : parentOperator;
      extractFields(value, nextContext);
    }
  }

  extractFields(pipeline);
  return usedFields;
}

/**
 * Check pipeline for non-camelCase field naming
 * Returns array of fields that don't follow camelCase convention
 */
export function checkPipelineFieldNaming(pipeline: any[]): string[] {
  const nonCamelCaseFields: Set<string> = new Set();

  function extractFields(obj: any) {
    if (typeof obj !== 'object' || obj === null) {
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach(item => extractFields(item));
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      // Check string values that reference fields (e.g., "$field_name")
      if (typeof value === 'string' && value.startsWith('$')) {
        const fieldName = value.substring(1);
        if (!isCamelCase(fieldName)) {
          nonCamelCaseFields.add(fieldName);
        }
      }

      // Recursively check nested objects
      extractFields(value);
    }
  }

  extractFields(pipeline);
  return Array.from(nonCamelCaseFields);
}

/**
 * Artifact-related types and functions
 */

export interface TaskResult {
  url?: string;
  title?: string;
  task?: string;
  taskDate?: string;
}

export interface ArtifactData {
  id: string;
  parentTaskId: string;
  timestamp: number;
  agent: {
    id: string;
    name: string;
    type: string;
  };
  messageType: string;
  action: {
    tool: string;
    operation: string;
    params: {
      url: string;
      pageTitle: string;
      visual: {
        icon: string;
        color: string;
      };
      stream: {
        type: string;
        streamId: string;
        target: string;
      };
    };
  };
  content: string;
  artifacts: Array<{
    id: string;
    type: string;
    content: {
      url: string;
      title: string;
      screenshot: string;
      textContent: string;
      extractedInfo: any;
    };
    metadata: {
      domainName: string;
      visitTimestamp: number;
      category: string;
    };
  }>;
  status: string;
}

/**
 * Generate list of artifacts from task results
 */
export async function getListOfArtifacts(functionName: string, results: TaskResult[]): Promise<any[]> {
  const artifacts: any[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const url = result.url;
    const casefile = result.title || result.task || 'Unknown Casefile';

    if (url) {
      const artifactData: ArtifactData = {
        id: `msg_browser_ghi789${i}`,
        parentTaskId: "task_7d8f9g",
        timestamp: Math.floor(Date.now() / 1000),
        agent: {
          id: "agent_siya_browser",
          name: "SIYA",
          type: "qna"
        },
        messageType: "action",
        action: {
          tool: "browser",
          operation: "browsing",
          params: {
            url: `Casefile: ${casefile}`,
            pageTitle: `Tool response for ${functionName}`,
            visual: {
              icon: "browser",
              color: "#2D8CFF"
            },
            stream: {
              type: "vnc",
              streamId: "stream_browser_1",
              target: "browser"
            }
          }
        },
        content: `Viewed page: ${functionName}`,
        artifacts: [{
          id: "artifact_webpage_1746018877304_994",
          type: "browser_view",
          content: {
            url: url,
            title: functionName,
            screenshot: "",
            textContent: `Observed output of cmd \`${functionName}\` executed:`,
            extractedInfo: {}
          },
          metadata: {
            domainName: "example.com",
            visitTimestamp: Date.now(),
            category: "web_page"
          }
        }],
        status: "completed"
      };

      const artifact = {
        type: "text" as const,
        text: JSON.stringify(artifactData, null, 2),
        title: `Casefile: ${casefile}`,
        format: "json"
      };

      artifacts.push(artifact);
    }
  }

  return artifacts;
}

// ============================================================================
// CSV Utility
// ============================================================================

/**
 * Convert array of objects to CSV format with proper escaping
 */
export function convertToCSV(data: any[]): string {
    if (!data.length) return "";

    const headers = Object.keys(data[0]);

    const escapeCSV = (value: any): string => {
        const str = value != null ? String(value) : "";
        const needsEscaping = /[",\n]/.test(str);
        const escaped = str.replace(/"/g, '""');
        return needsEscaping ? `"${escaped}"` : escaped;
    };

    const rows = data.map(doc =>
        headers.map(header => escapeCSV(doc[header])).join(',')
    );

    return [headers.join(','), ...rows].join('\n');
}

// ============================================================================
// User & Vessel Resource Helpers
// ============================================================================

/**
 * Fetch user details from MongoDB by ObjectId
 */
export async function getUserDetails(
    identifier: string,
    mongoUri: string,
    dbName: string,
    collectionName: string = 'users'
): Promise<any> {
    const { ObjectId } = await import('mongodb');
    try {
        const mongoClient = await MongoClient.connect(mongoUri);
        const db = mongoClient.db(dbName);
        const collection = db.collection(collectionName);
        const query = { _id: new ObjectId(identifier) };
        const projection = { _id: 0, firstName: 1, lastName: 1, email: 1, phone: 1 };
        const result = await collection.findOne(query, { projection });
        await mongoClient.close();
        return result || { error: "User Not Found" };
    } catch (error) {
        return { error: String(error) };
    }
}

/**
 * Fetch vessel manager details from MongoDB by IMO
 */
export async function getVesselManagers(
    imo: string,
    mongoUri: string,
    dbName: string,
    collectionName: string = 'fleet_distributions_overviews'
): Promise<any> {
    try {
        const mongoClient = await MongoClient.connect(mongoUri);
        const db = mongoClient.db(dbName);
        const collection = db.collection(collectionName);

        const result = await collection.findOne({ imo: parseInt(imo) });

        await mongoClient.close();

        if (result) {
            const clean = (value: any): string => {
                return (value === null || value === undefined ||
                       (typeof value === 'number' && isNaN(value))) ? "" : String(value);
            };

            return {
                TS: clean(result.technicalSuperintendent),
                TM: clean(result.fleetManager),
                TA: clean(result.technicalExecutive),
                MM: clean(result.marineManager),
                MS: clean(result.marineSuperintendent),
            };
        } else {
            return {
                TS: "",
                TM: "",
                TA: "",
                MM: "",
                MS: "",
                error: `No vessel found for IMO: ${imo}`
            };
        }
    } catch (error) {
        return {
            TS: "",
            TM: "",
            TA: "",
            MM: "",
            MS: "",
            error: String(error)
        };
    }
}

