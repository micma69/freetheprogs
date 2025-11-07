const fs = require('fs');
const path = require('path');

// Import the parser using ES modules
// We'll use a simple Node.js require for now
const testObjContent = fs.readFileSync(
  path.join(__dirname, 'tests', 'object', 'test.obj'),
  'utf-8'
);

console.log('Testing OBJ parser with test.obj file...');
console.log('First 20 lines of OBJ file:');
console.log(testObjContent.split('\n').slice(0, 20).join('\n'));
console.log('\n---\n');
console.log('OBJ file has', testObjContent.split('\n').length, 'lines');
console.log('Contains vertices with floats:', /v -?\d+\.\d+/.test(testObjContent));
console.log('Contains faces with indices:', /f \d+\/\d+\/\d+/.test(testObjContent));

