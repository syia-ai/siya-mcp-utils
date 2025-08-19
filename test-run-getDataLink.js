#!/usr/bin/env node

// Simple script to test getDataLink with your credentials
console.log('🧪 Testing getDataLink function...\n');

// Load test configuration
require('./test/test-config');

// Import the function
const { getDataLink } = require('./dist/helper_functions');

async function testGetDataLink() {
  // Test data
  const testData = [
    { id: 1, name: 'Test Vessel', imo: 123456789 },
    { id: 2, name: 'Test Vessel 2', imo: 987654321 },
  ];

  try {
    console.log('📤 Sending test data:', JSON.stringify(testData, null, 2));
    console.log('⏳ Waiting for response...\n');

    const result = await getDataLink(testData);
    
    console.log('✅ Test PASSED!');
    console.log('📥 Received data link:', result);
    console.log('🔗 Link length:', result.length);
    
  } catch (error) {
    console.error('❌ Test FAILED!');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run the test
testGetDataLink(); 