import { parseOBJ } from './shared/parsers/obj';
import { readFileSync } from 'fs';
import { join } from 'path';

const testObjContent = readFileSync(
  join(__dirname, 'tests', 'object', 'bunny.obj'),
  'utf-8'
);

console.log('Testing OBJ parser with bunny.obj file (scientific notation)...');
console.log('\n---\n');

const result = parseOBJ(testObjContent);

if (result.ok) {
  console.log('✓ Parser succeeded with scientific notation floats!');
  console.log('\nScene metadata:');
  console.log('  Format:', result.value.metadata.format);
  console.log('  Vertex count:', result.value.metadata.vertexCount);
  console.log('  Face count:', result.value.metadata.faceCount);
  console.log('  Mesh count:', result.value.meshes.length);
  
  if (result.value.meshes.length > 0) {
    const mesh = result.value.meshes[0];
    console.log('\nFirst mesh:', mesh.name);
    console.log('  Vertices:', mesh.vertices.length);
    console.log('  Faces:', mesh.faces.length);
    
    if (mesh.vertices.length > 0) {
      console.log('\nFirst vertex (parsed from scientific notation):');
      const v = mesh.vertices[0];
      console.log('  Position:', v.position);
      if (v.normal) console.log('  Normal:', v.normal);
      if (v.texCoord) console.log('  TexCoord:', v.texCoord);
    }
    
    if (result.value.metadata.boundingBox) {
      console.log('\nBounding box:');
      console.log('  Min:', result.value.metadata.boundingBox.min);
      console.log('  Max:', result.value.metadata.boundingBox.max);
    }
  }
} else {
  console.log('✗ Parser failed!');
  console.log('  Error:', result.error.message);
  console.log('  Line:', result.error.line);
  if (result.error.column) {
    console.log('  Column:', result.error.column);
  }
  process.exit(1);
}

console.log('\n---\nScientific notation test completed successfully!');

