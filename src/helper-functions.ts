import { MongoClient } from "mongodb";
import { TextContent } from "@modelcontextprotocol/sdk/types.js";
import { updateTypesenseFilterWithCompanyImos, isValidImoForCompany, isValidVesselImoForCompany, isValidFleetImoForCompany, filterImoListByCompany } from "./company-filtering.js";
import { getTypesenseClient } from "./typesense.js";

export async function getComponentData(componentId: string, vesselComponentsDbName: string, vesselComponentsMongoUri: string, collectionName: string = 'vesselinfocomponents'): Promise<string> {
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

        // Extract headers excluding lineitem
        const headers = doc.data.headers
            .filter((h: any) => h && h.name !== "lineitem")
            .map((h: any) => h.name);

        const rows = doc.data.body;

        // Build markdown table
        let md = "| " + headers.join(" | ") + " |\n";
        md += "| " + headers.map(() => "---").join(" | ") + " |\n";

        for (const row of rows) {
            const formattedRow = row
                .filter((cell: any) => cell && !cell.lineitem) // Exclude lineitem and null cells
                .map((cell: any) => {
                    if (cell && cell.value && cell.link) {
                        return `[${cell.value}](${cell.link})`;
                    } else if (cell && cell.status && cell.color) {
                        return cell.status;
                    }
                    return cell ? String(cell) : '';
                });
            md += "| " + formattedRow.join(" | ") + " |\n";
        }

        return md;
    } catch (error: any) {
        return `⚠️ Error getting component data: ${error.message}`;
    } finally {
        await mongoClient.close();
    }
}

export async function addComponentData(answer: string, imo: string, vesselComponentsDbName: string, vesselComponentsMongoUri: string): Promise<string> {
    const pattern = /https[^\/]+\/chat\/ag-grid-table\?component=(\d+_\d+)/g;
    const matches = Array.from(answer.matchAll(pattern));

    let result = answer;
    for (const match of matches) {
        const component = match[1];
        try {
            const replacement = await getComponentData(`${component}_${imo}`, vesselComponentsDbName, vesselComponentsMongoUri, 'vesselinfocomponents');
            result = result.replace(match[0], replacement);
        } catch (error) {
            // Silently continue on error
        }
    }

    return result;
}

export async function getVesselQnASnapshot(imo: string, questionNo: string): Promise<any> {
    try {
        const raw_snapshotUrl = process.env.SNAPSHOT_URL;
        // API endpoint
        const snapshotUrl = `${raw_snapshotUrl}/${imo}/${questionNo}`;

        const raw_jwtToken = process.env.JWT_TOKEN;
        // Authentication token
        const jwtToken = `Bearer ${raw_jwtToken}`;

        // Headers for the request
        const headers = {
            "Authorization": jwtToken
        };

        const response = await fetch(snapshotUrl, {
            method: 'GET',
            headers
        });

        if (!response.ok) {
            return {
                content: [{ type: "text", text: `Error in getVesselQnASnapshot: HTTP ${response.status} - ${response.statusText}` }],
                isError: true
            };
        }

        const data = await response.json();

        // Return resultData if it exists, otherwise return the full response
        if (data && typeof data === 'object' && "resultData" in data) {
            return data.resultData;
        }
        return data;
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error in getVesselQnASnapshot: ${error.message}` }],
            isError: true
        };
    }
}

export async function fetchQADetails(
    imo: string,
    qaId: number,
    vesselInfoDbName: string,
    vesselInfoMongoUri: string,
    collectionName: string = 'vesselinfos'
): Promise<any> {
    const mongoClient = new MongoClient(vesselInfoMongoUri);
    await mongoClient.connect();

    try {
        const db = mongoClient.db(vesselInfoDbName);
        const collection = db.collection(collectionName);

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
            Artifactlink?: string | null;
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
            const vesselComponentsDbName = process.env.vesselComponentsDbName || vesselInfoDbName;
            const vesselComponentsMongoUri = process.env.vesselComponentsMongoUri || vesselInfoMongoUri;
            res.answer = await addComponentData(res.answer, imo, vesselComponentsDbName, vesselComponentsMongoUri);
        }

        // Get vessel QnA snapshot link
        try {
            res.Artifactlink = await getVesselQnASnapshot(imo, qaId.toString());
        } catch (error) {
            res.Artifactlink = null;
        }

        return res;
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error in fetchQADetails: ${error.message}` }],
            isError: true
        };
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
    collectionName: string = 'vesselinfos'
): Promise<any> {
    if (!imo) {
        return {
            content: [{ type: "text", text: "IMO is required" }],
            isError: true
        };
    }

    try {
        // Fetch QA details
        const result = await fetchQADetails(imo, questionNo, vesselInfoDbName, vesselInfoMongoUri, collectionName);
        const link = result.Artifactlink;
        const vesselName = result.vesselName;

        // Get artifact data
        const artifactData = await getArtifact(functionName, link);

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




export async function getArtifact(toolName: string, link: string): Promise<any> {
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
                      textContent: `Observed output of cmd \`${toolName}\` executed:`,
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

export async function getVesselImoListFromFleet(fleetImo: number): Promise<number[]> {
    const dbName = process.env.GROUP_DETAILS_DB_NAME;
    const mongoUri = process.env.GROUP_DETAILS_MONGO_URI;
    const collectionName = "common_group_details";

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


export function convertUnixDates(document: any): any {
  const result = { ...document };

  const dateFields = [
      'purchaseRequisitionDate',
      'purchaseOrderIssuedDate',
      'orderReadinessDate',
      'date',
      'poDate',
      'expenseDate',
      "inspectionTargetDate",
      "reportDate",
      "closingDate",
      "targetDate",
      "nextDueDate",
      "extendedDate"
  ];

  let convertedCount = 0;
  for (const field of dateFields) {
      const value = result[field];
      if (typeof value === "number" && Number.isFinite(value)) {
          const originalValue = value;
          result[field] = new Date(value * 1000).toISOString();
          convertedCount++;
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
          text: `Error processing results: ${error.message}`,
          title: "Error",
          format: "json"
        }]
      };
  }
}

export async function exportDataForImoListGeneric(
    collectionName: string,
    imoList: number[],
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

        const client = await getTypesenseClient();
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

export async function exportPurchasesForImoList(imoList: number[], startDate?: string, endDate?: string): Promise<any[]> {
    return exportDataForImoListGeneric(
        'purchase',
        imoList,
        startDate,
        endDate,
        'purchaseRequisitionDate',
        "embedding",
        [
            'purchaseRequisitionDate',
            'purchaseOrderIssuedDate',
            'orderReadinessDate'
        ]
    );
}

export async function exportBudgetsForImoList(imoList: number[], startDate?: string, endDate?: string): Promise<any[]> {
    return exportDataForImoListGeneric(
        'budget',
        imoList,
        startDate,
        endDate,
        'date',
        "embedding",
        ['date']
    );
}

export async function exportExpensesForImoList(imoList: number[], startDate?: string, endDate?: string): Promise<any[]> {
    return exportDataForImoListGeneric(
        'expense',
        imoList,
        startDate,
        endDate,
        'expenseDate',
        "embedding,vesselId,fleetId,docId,fleetManagerId,technicalSuperintendentId,ownerId",
        [
            'expenseDate',
            'poDate'
        ]
    );
}
