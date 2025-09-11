# syia-mcp-utils

Global utility functions for purchase and PMS MCP servers.

## Installation

```bash
npm install syia-mcp-utils
```

## Usage

```typescript
import { 
  fetchQADetails, 
  getComponentData, 
  logger,
  getMongoClient,
  filterResponseByCompanyImos,
  markdownToHtmlLink,
  parseDocumentLink
} from 'syia-mcp-utils';

// Example usage of fetchQADetails with database connection
const client = await getMongoClient();
const db = client.db('your-database-name');
const result = await fetchQADetails('1234567', 1, db, 'vesselinfos');
```

## Available Utilities

- **mongodb.ts** - MongoDB connection and operations
- **typesense.ts** - Typesense search operations
- **logger.ts** - Winston-based logging
- **imoUtils.ts** - IMO-related utilities
- **llm.ts** - OpenAI LLM integration
- **helper_functions.ts** - General helper functions
- **config.ts** - Configuration management
- **responseFilter.ts** - Company-specific response filtering
- **markdown.ts** - Markdown to HTML conversion
- **documentParser.ts** - Document link parsing

## Building

```bash
npm run build
```

This will compile TypeScript files to JavaScript in the `dist/` directory. 