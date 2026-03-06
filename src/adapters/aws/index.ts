/**
 * AWS Lambda Adapter for Ceves Event Sourcing Library
 *
 * This module provides AWS-specific implementations and adapters for running
 * Ceves applications on AWS Lambda with S3 storage and API Gateway.
 *
 * @example
 * ```typescript
 * import { CevesApp } from 'ceves';
 * import {
 *   S3EventStore,
 *   S3SnapshotStore,
 *   HeaderTenantResolver,
 *   createLambdaHandler
 * } from 'ceves/aws';
 * import { S3Client } from '@aws-sdk/client-s3';
 *
 * const s3 = new S3Client({ region: process.env.AWS_REGION });
 *
 * const app = new CevesApp({
 *   eventStore: new S3EventStore(s3, process.env.EVENTS_BUCKET!),
 *   snapshotStore: new S3SnapshotStore(s3, process.env.EVENTS_BUCKET!),
 *   tenantResolver: new HeaderTenantResolver('X-Org-Id')
 * });
 *
 * app.registerHandlers([...]);
 *
 * export const handler = createLambdaHandler(app.getHonoApp());
 * ```
 *
 * @packageDocumentation
 */

// Storage implementations
export { S3EventStore } from '../../storage/S3EventStore';
export { S3SnapshotStore } from '../../storage/S3SnapshotStore';

// Tenant resolution
export { HeaderTenantResolver } from '../../tenancy/HeaderTenantResolver';

// Lambda adapter
export { createLambdaHandler } from './LambdaAdapter';

// Type definitions
export type { AWSEnv } from './types';
