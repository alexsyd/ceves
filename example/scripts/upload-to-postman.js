import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const POSTMAN_API_KEY = process.env.POSTMAN_API_KEY;
if (!POSTMAN_API_KEY) {
  console.error('❌ POSTMAN_API_KEY environment variable not set');
  process.exit(1);
}

const POSTMAN_API = 'https://api.getpostman.com';

// Read collection and environments
const collection = JSON.parse(readFileSync(path.join(__dirname, '..', 'postman', 'ceves-bankaccount-tests.postman_collection.json'), 'utf8'));
const envLocal = JSON.parse(readFileSync(path.join(__dirname, '..', 'postman', 'ceves-bankaccount.postman_environment.json'), 'utf8'));
const envProd = JSON.parse(readFileSync(path.join(__dirname, '..', 'postman', 'ceves-bankaccount-production.postman_environment.json'), 'utf8'));

async function uploadToPostman() {
  console.log('📤 Uploading to Postman...\n');

  // Upload collection
  console.log('Uploading collection...');
  const collectionResponse = await fetch(`${POSTMAN_API}/collections`, {
    method: 'POST',
    headers: {
      'X-Api-Key': POSTMAN_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ collection }),
  });

  if (!collectionResponse.ok) {
    const error = await collectionResponse.text();
    console.error('❌ Failed to upload collection:', error);
    process.exit(1);
  }

  const collectionData = await collectionResponse.json();
  console.log('✅ Collection uploaded:', collectionData.collection.name);
  console.log('   ID:', collectionData.collection.uid);
  console.log('   URL:', `https://www.postman.com/collection/${collectionData.collection.uid}`);
  console.log();

  // Upload local environment
  console.log('Uploading Local environment...');
  const envLocalResponse = await fetch(`${POSTMAN_API}/environments`, {
    method: 'POST',
    headers: {
      'X-Api-Key': POSTMAN_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ environment: envLocal }),
  });

  if (!envLocalResponse.ok) {
    const error = await envLocalResponse.text();
    console.error('❌ Failed to upload local environment:', error);
  } else {
    const envLocalData = await envLocalResponse.json();
    console.log('✅ Local environment uploaded:', envLocalData.environment.name);
    console.log('   ID:', envLocalData.environment.uid);
    console.log();
  }

  // Upload production environment
  console.log('Uploading Production environment...');
  const envProdResponse = await fetch(`${POSTMAN_API}/environments`, {
    method: 'POST',
    headers: {
      'X-Api-Key': POSTMAN_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ environment: envProd }),
  });

  if (!envProdResponse.ok) {
    const error = await envProdResponse.text();
    console.error('❌ Failed to upload production environment:', error);
  } else {
    const envProdData = await envProdResponse.json();
    console.log('✅ Production environment uploaded:', envProdData.environment.name);
    console.log('   ID:', envProdData.environment.uid);
    console.log();
  }

  console.log('🎉 Upload complete!');
  console.log('\nView your collection at: https://www.postman.com/');
}

uploadToPostman().catch(err => {
  console.error('❌ Upload failed:', err.message);
  process.exit(1);
});
