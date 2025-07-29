# syia-mcp-utils

Global utility functions for purchase MCP server.

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
  getMongoClient 
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

## Building

```bash
npm run build
```

This will compile TypeScript files to JavaScript in the `dist/` directory. 