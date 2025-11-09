/*import { parseOBJ } from '../shared/parsers/obj';
import { convertToOBJ } from '../shared/converters';
import { readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

console.log('Testing OBJ converter with round-trip conversion...');
console.log('\n---\n');

// Helper to compare scenes (metadata only for now)
const compareScenes = (a: any, b: any) => {
  assert.strictEqual(a.metadata.vertexCount, b.metadata.vertexCount, 'Vertex counts should match');
  assert.strictEqual(a.metadata.faceCount, b.metadata.faceCount, 'Face counts should match');
  // Could add more detailed geometry comparison if needed
};

// Test 1: Simple cube round-trip
const testObjContent = readFileSync(
  join(__dirname, 'object', 'test.obj'),
  'utf-8'
);

console.log('Test 1: Round-trip with test.obj');
const parseResult1 = parseOBJ(testObjContent);
if (!parseResult1.ok) {
  console.error('❌ Initial parse failed:', parseResult1.error);
  process.exit(1);
}

const convertResult = convertToOBJ(parseResult1.value);
if (!convertResult.ok) {
  console.error('❌ Conversion to OBJ failed:', convertResult.error);
  process.exit(1);
}

const parseResult2 = parseOBJ(convertResult.value);
if (!parseResult2.ok) {
  console.error('❌ Parse of converted content failed:', parseResult2.error);
  process.exit(1);
}

try {
  compareScenes(parseResult1.value, parseResult2.value);
  console.log('✓ Round-trip successful! Scenes match.');
  console.log('  Original vertex count:', parseResult1.value.metadata.vertexCount);
  console.log('  Original face count:', parseResult1.value.metadata.faceCount);
  console.log('  Converted vertex count:', parseResult2.value.metadata.vertexCount);
  console.log('  Converted face count:', parseResult2.value.metadata.faceCount);
} catch (err) {
  console.error('❌ Scenes differ:', err);
  process.exit(1);
}

// Test 2: Special cases
console.log('\nTest 2: Special cases');

const specialCases = [
  // Mesh without normals
  `v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n`,
  
  // Mesh with texture coords but no normals
  `v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nf 1/1 2/2 3/3\n`,
  
  // Multiple materials
  `v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 1\nusemtl mat1\nf 1 2 3\nusemtl mat2\nf 2 3 4\n`
];

for (const [i, testCase] of specialCases.entries()) {
  console.log(`\nTesting special case ${i + 1}...`);
  
  const p1 = parseOBJ(testCase);
  if (!p1.ok) {
    console.error(`❌ Parse failed for case ${i + 1}:`, p1.error);
    continue;
  }
  
  const conv = convertToOBJ(p1.value);
  if (!conv.ok) {
    console.error(`❌ Conversion failed for case ${i + 1}:`, conv.error);
    continue;
  }
  
  const p2 = parseOBJ(conv.value);
  if (!p2.ok) {
    console.error(`❌ Re-parse failed for case ${i + 1}:`, p2.error);
    continue;
  }
  
  try {
    compareScenes(p1.value, p2.value);
    console.log(`✓ Special case ${i + 1} passed!`);
  } catch (err) {
    console.error(`❌ Special case ${i + 1} failed:`, err);
  }
}

console.log('\n---\nAll tests completed!');

*/