/**
 * Run Newman Tests
 *
 * Executes the Postman collection using Newman CLI with HTML reporting.
 */

import newman from 'newman';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const collectionPath = path.join(__dirname, '..', 'postman', 'ceves-bankaccount-tests.postman_collection.json');
const environmentPath = path.join(__dirname, '..', 'postman', 'ceves-bankaccount.postman_environment.json');

const collection = JSON.parse(readFileSync(collectionPath, 'utf8'));
const environment = JSON.parse(readFileSync(environmentPath, 'utf8'));

newman.run({
  collection,
  environment,
  reporters: ['cli', 'htmlextra'],
  reporter: {
    htmlextra: {
      export: path.join(__dirname, '..', 'newman-results', 'report.html'),
      title: 'Ceves BankAccount API Tests',
      logs: true,
      darkTheme: false,
    },
  },
  insecure: true, // Allow self-signed certificates in dev
  timeout: 10000,
}, function (err, summary) {
  if (err) {
    console.error('❌ Newman run failed:', err);
    process.exit(1);
  }

  if (summary.run.failures.length > 0) {
    console.error(`❌ ${summary.run.failures.length} test(s) failed`);
    process.exit(1);
  }

  console.log('✅ All Newman tests passed');
  console.log(`   Total tests: ${summary.run.stats.tests.total}`);
  console.log(`   Passed: ${summary.run.stats.tests.passed}`);
  console.log(`   Report: newman-results/report.html`);
});
