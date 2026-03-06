/**
 * Generate Postman Collection from OpenAPI Schema
 *
 * This script converts the OpenAPI schema to Postman Collection v2.1 format
 * using the official openapi-to-postmanv2 converter.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Converter from 'openapi-to-postmanv2';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const OPENAPI_PATH = path.join(__dirname, '..', 'openapi.json');
const COLLECTION_PATH = path.join(__dirname, '..', 'postman', 'ceves-bankaccount.postman_collection.json');

// Read OpenAPI schema
if (!fs.existsSync(OPENAPI_PATH)) {
  console.error('❌ OpenAPI schema not found. Run "npm run schema:extract" first.');
  process.exit(1);
}

const openapi = JSON.parse(fs.readFileSync(OPENAPI_PATH, 'utf8'));

// Convert to Postman collection
Converter.convert(
  { type: 'json', data: openapi },
  {
    folderStrategy: 'Tags',
    requestNameSource: 'URL',
    indentCharacter: ' ',
  },
  (err, result) => {
    if (err) {
      console.error('❌ Conversion failed:', err);
      process.exit(1);
    }

    if (!result.result) {
      console.error('❌ Conversion validation failed:', result.reason);
      process.exit(1);
    }

    // Write Postman collection
    fs.writeFileSync(
      COLLECTION_PATH,
      JSON.stringify(result.output[0].data, null, 2)
    );

    console.log('✅ Postman collection generated successfully');
    console.log(`   Output: ${COLLECTION_PATH}`);
  }
);
