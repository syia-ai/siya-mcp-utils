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