import { TextContent, ImageContent, EmbeddedResource } from "@modelcontextprotocol/sdk/types.js";
import { ObjectId } from "mongodb";

export interface ToolArguments {
    // Common arguments
    session_id?: string;
    imo?: string;
    user_id?: string;
    questionNo?: string;

    // Document parsing
    document_link?: string;
    download_path?: string;
    json_output?: string;
    md_output?: string;
    parsing_instruction?: string;
    format?: string;
    extract_only?: boolean;
    llama_api_key?: string;
    vendor_model?: string;
    delete_downloads?: boolean;

    // Casefile operations
    operation?: "write_casefile" | "write_page" | "get_casefiles" | "get_casefile_plan";
    casefile_url?: string;
    casefileName?: string;
    casefileSummary?: string;
    currentStatus?: string;
    importance?: number;
    category?: string;
    role?: string;
    content?: string;
    casefile?: string;
    tags?: string[];
    topic?: string;
    summary?: string;
    mailId?: string;
    facts?: string;
    links?: string[];
    detailed_report?: string;

    // Search parameters
    query?: string;
    min_importance?: number;
    page_size?: number;
    pagination?: number;
    num_results?: number;
    filters?: Record<string, any>;
    sort_by?: string;
    sort_order?: string;
    max_results?: number;

    // Vendor search
    vendorName?: string;
    service?: string;
    locationRegion?: string;
    vendorId?: string;
    limit?: number;

    // Date range
    start_date?: string;
    end_date?: string;
    startDate?: string;
    endDate?: string;
    dateFrom?: string;
    dateTo?: string;
    daysAgo?: number;
    lookbackHours?: number;
    lookback_hours?: number;

    // Purchase related
    requisitionId?: string;
    orderId?: string;
    status?: string;
    type?: string;
    stage?: string;
    priority?: string;
    year?: number;
    vesselId?: string;
    purchaseRequisitionNumber?: string;
    purchaseOrderNumber?: string;
    purchaseRequisitionStatus?: string;
    purchaseOrderStatus?: string;
    purchaseRequisitionType?: string;
    purchaseOrderStage?: string;
    vesselName?: string;
    orderPriority?: string;
    daysOverdue?: number;
    sessionId?: string;
    vendor?: string;

    // Collection and query
    collection?: string;
    projection?: Record<string, any>;
    skip?: number;

    // Group and period
    group?: string;
    period?: string;

    // Pagination
    per_page?: number;

    // Query parameters
    query_keyword?: string;
    tag?: string;

    // Vessel search
    vessel_name?: string;
}

export interface VesselInfo {
    imo: string;
    name: string;
    // Add other vessel properties as needed
}

export interface PurchaseRequisition {
    id: string;
    vesselId: string;
    status: string;
    priority: string;
    // Add other requisition properties
}

export interface PurchaseOrder {
    id: string;
    requisitionId: string;
    status: string;
    // Add other order properties
}

export interface BudgetData {
    vesselId: string;
    year: number;
    month: number;
    amount: number;
    // Add other budget properties
}

export interface Casefile {
    id: string;
    title: string;
    content: string;
    createdAt: Date;
    updatedAt: Date;
    // Add other casefile properties
}

export interface VendorInfo {
    id: string;
    name: string;
    contactDetails: {
        email?: string;
        phone?: string;
        address?: string;
    };
    // Add other vendor properties
}

export type ToolResponse = Array<TextContent | ImageContent | EmbeddedResource>;

export interface ServerConfig {
    serverName: string;
    serverVersion: string;
    capabilities: {
        resources: {
            read: boolean;
            list: boolean;
            templates: boolean;
        };
        tools: {
            list: boolean;
            call: boolean;
        };
        prompts: {
            list: boolean;
            get: boolean;
        };
    };
}

export interface CasefileDocument {
    _id?: ObjectId;
    vesselId: string | null;
    imo: string;
    vesselName: string | null;
    casefile: string;
    currentStatus?: string;
    summary?: string;
    originalImportance: number;
    importance: number;
    category: string;
    role?: string;
    followUp: string;
    createdAt: Date;
    updatedAt: Date;
    index: CasefileIndex[];
    pages: CasefilePage[];
    link?: string;
    tags?: string[];
    casefilePlans?: any[];
}

export interface CasefileIndex {
    pagenum: number;
    type: string;
    createdAt: Date;
    topic: string;
    plan_status: string;
}

export interface CasefilePage {
    pagenum: number;
    summary: string;
    createdAt: Date;
    subject: string;
    flag: string;
    type: string;
    link: { link: string }[];
    plan_status: string;
}

export interface TypesenseDocument {
    id: string;
    vesselId: string | null;
    imo: string;
    vesselName: string | null;
    casefile: string;
    currentStatus?: string;
    summary?: string;
    originalImportance: number;
    importance: number;
    category: string;
    role?: string;
    followUp: string;
    createdAt: Date;
    updatedAt: Date;
    link?: string;
    tags?: string[];
    importance_score?: number;
    embedding?: number[];
    embedding_text?: string;
}

export interface VendorDocument {
    id: string;
    vendorName: string;
    service?: string;
    locationRegion?: string;
    address?: string;
    contactEmail?: string;
    contactNumber?: string;
}

export interface SearchResult {
    found: number;
    out_of: number;
    page: number;
    hits: any[];
}

export interface Config {
    mongoUri: string;
    mongoDbName: string;
    typesenseHost: string;
    typesensePort: number;
    typesenseProtocol: string;
    typesenseApiKey: string;
    openaiApiKey: string;
    llamaApiKey: string;
    vendorModel: string;
    s3ApiToken: string;
    s3GenerateHtmlUrl: string;
    perplexityApiKey: string;
    googleSearchApiKey: string;
    googleSearchEngineId: string;
    baseUrl?: string;
    snapshotUrl?: string;
    jwtToken?: string;
    
    // MongoDB connection variants - support multiple naming formats
    secondaryMongoUri?: string;
    devApiMongoUri?: string;
    etlDevMongoUri?: string;
    etlDevDataUri?: string;
    mongodbEtlDevDataUri?: string;
    
    // Database name variants
    dbName?: string;
    secondaryDbName?: string;
    etlDevDataDbName?: string;
    devApiDbName?: string;
    etlDevDbName?: string;
    mongodbEtlDevDataDbName?: string;
    
    // Other optional configs
    companyName?: string;
    cohereApiKey?: string;
} 