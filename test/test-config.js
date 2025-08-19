// Test configuration file for getDataLink
// Replace these values with your actual credentials

const testConfig = {
  snapshotUrl: 'https://dev-api.siya.com/v1.0/vessel-info/qna-snapshot', // e.g., 'https://api.example.com/snapshot'
  jwtToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7ImlkIjoiNjRkMzdhMDM1Mjk5YjFlMDQxOTFmOTJhIiwiZmlyc3ROYW1lIjoiU3lpYSIsImxhc3ROYW1lIjoiRGV2IiwiZW1haWwiOiJkZXZAc3lpYS5haSIsInJvbGUiOiJhZG1pbiIsInJvbGVJZCI6IjVmNGUyODFkZDE4MjM0MzY4NDE1ZjViZiIsImlhdCI6MTc0MDgwODg2OH0sImlhdCI6MTc0MDgwODg2OCwiZXhwIjoxNzcyMzQ0ODY4fQ.1grxEO0aO7wfkSNDzpLMHXFYuXjaA1bBguw2SJS9r2M',        // Your JWT token
  dbName: 'test_db',
  secondaryDbName: 'test_secondary_db',
  mongodbUri: 'mongodb://localhost:27017',
  mongodbEtlDevDataUri: 'mongodb://localhost:27017',
  mongodbEtlDevDataDbName: 'etl_dev',
  companyName: 'test_company',
  typesenseHost: 'localhost',
  typesensePort: 8108,
  typesenseProtocol: 'http',
  typesenseApiKey: 'test_api_key'
};

// Set the config for testing
const { setConfig } = require('../dist/config');
setConfig(testConfig);

console.log('✅ Test configuration loaded');
console.log('📝 Please update the credentials in test/test-config.js before running tests'); 