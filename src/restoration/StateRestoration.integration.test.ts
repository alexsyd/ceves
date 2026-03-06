/**
 * Integration tests for State Restoration Engine
 *
 * These tests validate end-to-end state restoration flows with real storage implementations.
 * Unlike unit tests that use mocks, these tests verify:
 * 1. Full event replay with real R2EventStore
 * 2. Snapshot + incremental replay with real R2SnapshotStore
 * 3. Snapshot + incremental replay with real D1SnapshotStore
 * 4. Version validation in end-to-end flows
 * 5. Cross-epic integration ( Storage,  Schemas,  Decorators)
 *
 * Test Environment:
 * - Runs in actual Workers runtime (workerd) via @cloudflare/vitest-pool-workers
 * - Uses Miniflare's automatic in-memory R2 bucket (env.TEST_EVENTS_BUCKET)
 * - Uses Miniflare's automatic in-memory D1 database (env.TEST_SNAPSHOTS_DB)
 * - Each test gets fresh, isolated storage instances
 *
 * Coverage Target: >95% line coverage for StateRestoration module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import type { R2Bucket, D1Database } from '@cloudflare/workers-types';
import { z } from 'zod';

// State Restoration
import { restoreState } from './StateRestoration';

// Storage implementations
import { R2EventStore } from '../storage/R2EventStore';
import { R2SnapshotStore } from '../storage/R2SnapshotStore';
import { D1SnapshotStore } from '../storage/D1SnapshotStore';
import type { StoredEvent, StoredSnapshot } from '../storage/interfaces';

// Schemas
import { BaseState } from '../schemas/State';
import type { DomainEvent, EventMetadata } from '../schemas/Event';

// Decorators
import {
  EventHandler,
  clearEventHandlers,
  type IEventHandler,
} from '../decorators/EventHandler';

// Errors
import { EventApplicationError } from '../errors/EventApplicationError';

/**
 * Test state class (must be a class, not type alias)
 */
class TestState extends BaseState {
  count: number = 0;
  name: string = '';
}

/**
 * Test events (DomainEvents - only type + business fields)
 */
interface TestCreatedEvent extends DomainEvent {
  readonly type: 'TestCreated';
  name: string;
}

interface TestIncrementedEvent extends DomainEvent {
  readonly type: 'TestIncremented';
  amount: number;
}

interface TestRenamedEvent extends DomainEvent {
  readonly type: 'TestRenamed';
  newName: string;
}

/**
 * Zod schemas for test events ( integration)
 * Validate StoredEvent structure (infrastructure envelope + domain event)
 */
const TestCreatedEventSchema = z.object({
  aggregateType: z.string(),
  aggregateId: z.string(),
  version: z.number(),
  type: z.literal('TestCreated'),
  timestamp: z.string(),
  orgId: z.string(),
  event: z.object({
    type: z.literal('TestCreated'),
    name: z.string(),
  }),
});

const TestIncrementedEventSchema = z.object({
  aggregateType: z.string(),
  aggregateId: z.string(),
  version: z.number(),
  type: z.literal('TestIncremented'),
  timestamp: z.string(),
  orgId: z.string(),
  event: z.object({
    type: z.literal('TestIncremented'),
    amount: z.number(),
  }),
});

const TestRenamedEventSchema = z.object({
  aggregateType: z.string(),
  aggregateId: z.string(),
  version: z.number(),
  type: z.literal('TestRenamed'),
  timestamp: z.string(),
  orgId: z.string(),
  event: z.object({
    type: z.literal('TestRenamed'),
    newName: z.string(),
  }),
});

/**
 * Event handler factories ( integration)
 * Create fresh handler classes for each test to ensure isolation
 * Each factory requires aggregateType to register scoped handlers
 */
function createTestCreatedHandler(aggregateType: string) {
  @EventHandler
  class TestCreatedHandler implements IEventHandler<TestState, TestCreatedEvent> {
    eventType = 'TestCreated';
    aggregateType = aggregateType;
    schema = TestCreatedEventSchema;

    apply(
      state: TestState,
      event: TestCreatedEvent,
      metadata: EventMetadata
    ): TestState {
      // Handler receives non-null state (empty for first event)
      // Handler sets id and orgId (business decisions)
      // Framework auto-sets version and timestamp AFTER this returns
      return {
        ...state,
        id: metadata.aggregateId,
        orgId: metadata.orgId,
        count: 0,
        name: event.name,
      };
    }
  }
  return TestCreatedHandler;
}

function createTestIncrementedHandler(aggregateType: string) {
  @EventHandler
  class TestIncrementedHandler
    implements IEventHandler<TestState, TestIncrementedEvent>
  {
    eventType = 'TestIncremented';
    aggregateType = aggregateType;
    schema = TestIncrementedEventSchema;

    apply(
      state: TestState,
      event: TestIncrementedEvent,
      _metadata: EventMetadata
    ): TestState {
      // Handler receives non-null state
      // Framework auto-sets version and timestamp AFTER this returns
      return {
        ...state,
        count: state.count + event.amount,
      };
    }
  }
  return TestIncrementedHandler;
}

function createTestRenamedHandler(aggregateType: string) {
  @EventHandler
  class TestRenamedHandler implements IEventHandler<TestState, TestRenamedEvent> {
    eventType = 'TestRenamed';
    aggregateType = aggregateType;
    schema = TestRenamedEventSchema;

    apply(
      state: TestState,
      event: TestRenamedEvent,
      _metadata: EventMetadata
    ): TestState {
      // Handler receives non-null state
      // Framework auto-sets version and timestamp AFTER this returns
      return {
        ...state,
        name: event.newName,
      };
    }
  }
  return TestRenamedHandler;
}

/**
 * Buggy handler factory for testing malformed state
 * Note: With , version and timestamp are auto-set by framework.
 * This handler doesn't set orgId, demonstrating that handlers must set it.
 */
function createBuggyIncrementedHandler(aggregateType: string) {
  @EventHandler
  class BuggyIncrementedHandler
    implements IEventHandler<TestState, TestIncrementedEvent>
  {
    eventType = 'TestIncremented';
    aggregateType = aggregateType;
    schema = TestIncrementedEventSchema;

    apply(
      state: TestState,
      event: TestIncrementedEvent,
      _metadata: EventMetadata
    ): TestState {
      // Handler receives non-null state
      // Framework auto-sets version and timestamp
      // Handler should preserve orgId from previous state
      // Note: This was originally "buggy" but framework now handles correctly
      const newCount = state.count + event.amount;
      return {
        ...state,
        count: newCount,
      };
    }
  }
  return BuggyIncrementedHandler;
}

/**
 * Helper to create test events with new StoredEvent format
 */
function createTestEvent(
  aggregateType: string,
  aggregateId: string,
  version: number,
  eventType: 'TestCreated' | 'TestIncremented' | 'TestRenamed',
  data: Record<string, unknown>
): StoredEvent {
  const timestamp = new Date(Date.now() + version * 1000).toISOString();

  // Create the domain event with type + business fields
  const event = {
    type: eventType,
    ...data,
  } as DomainEvent;

  return {
    aggregateType,
    aggregateId,
    version,
    type: eventType,
    timestamp,
    orgId: '', // Empty string for test data
    event,
  };
}

describe('StateRestoration integration (Workers runtime)', () => {
  let eventStore: R2EventStore;
  let r2SnapshotStore: R2SnapshotStore;
  let d1SnapshotStore: D1SnapshotStore;

  beforeEach(() => {
    // Clear event handler registry for test isolation
    clearEventHandlers();

    // Create real storage instances with Miniflare bindings
    eventStore = new R2EventStore(env.TEST_EVENTS_BUCKET as R2Bucket);
    r2SnapshotStore = new R2SnapshotStore(env.TEST_EVENTS_BUCKET as R2Bucket);
    d1SnapshotStore = new D1SnapshotStore(env.TEST_SNAPSHOTS_DB as D1Database);
  });

  describe('Full event replay with R2EventStore (no snapshot)', () => {
    it('should restore state from 50 events using real R2EventStore', async () => {
      // Arrange: Define aggregate type and register handlers
      const aggregateType = 'counter';
      const aggregateId = 'counter-001';
      new (createTestCreatedHandler(aggregateType))();
      new (createTestIncrementedHandler(aggregateType))();

      // Save 50 events to real R2EventStore
      const events: StoredEvent[] = [];
      events.push(
        createTestEvent(aggregateType, aggregateId, 1, 'TestCreated', {
          name: 'Counter 001',
        })
      );

      for (let i = 2; i <= 50; i++) {
        events.push(
          createTestEvent(aggregateType, aggregateId, i, 'TestIncremented', {
            amount: 1,
          })
        );
      }

      // Save all events to R2
      for (const event of events) {
        await eventStore.save(event);
      }

      // Act: Restore state using restoreState() with no snapshot
      const result = await restoreState<TestState>(
        aggregateType,
        aggregateId,
        eventStore,
        r2SnapshotStore,
        TestState
      );

      // Assert: Verify final state
      expect(result).not.toBeNull();
      expect(result?.id).toBe(aggregateId);
      expect(result?.version).toBe(50);
      expect(result?.orgId).toBe('');
      expect(result?.count).toBe(49); // Started at 0, incremented 49 times
      expect(result?.name).toBe('Counter 001');
    });

    it('should handle end-to-end version tracking with real storage', async () => {
      // Arrange
      const aggregateType = 'counter';
      const aggregateId = 'counter-002';
      new (createTestCreatedHandler(aggregateType))();
      new (createTestIncrementedHandler(aggregateType))();

      // Save events
      const events: StoredEvent[] = [
        createTestEvent(aggregateType, aggregateId, 1, 'TestCreated', {
          name: 'Counter 002',
        }),
        createTestEvent(aggregateType, aggregateId, 2, 'TestIncremented', {
          amount: 5,
        }),
        createTestEvent(aggregateType, aggregateId, 3, 'TestIncremented', {
          amount: 10,
        }),
      ];

      for (const event of events) {
        await eventStore.save(event);
      }

      // Act
      const result = await restoreState<TestState>(
        aggregateType,
        aggregateId,
        eventStore,
        r2SnapshotStore,
        TestState
      );

      // Assert: Version tracking works correctly
      expect(result).not.toBeNull();
      expect(result?.version).toBe(3);
      expect(result?.orgId).toBe('');
      expect(result?.count).toBe(15);
    });

    it('should validate performance target <100ms for <100 events', async () => {
      // Arrange
      const aggregateType = 'counter';
      new (createTestCreatedHandler(aggregateType))();
      new (createTestIncrementedHandler(aggregateType))();
      const aggregateId = 'counter-perf';

      // Save 99 events (1 created + 98 incremented)
      const events: StoredEvent[] = [
        createTestEvent(aggregateType, aggregateId, 1, 'TestCreated', {
          name: 'Performance Test',
        }),
      ];

      for (let i = 2; i <= 99; i++) {
        events.push(
          createTestEvent(aggregateType, aggregateId, i, 'TestIncremented', {
            amount: 1,
          })
        );
      }

      for (const event of events) {
        await eventStore.save(event);
      }

      // Act: Measure restoration time
      const startTime = performance.now();
      const result = await restoreState<TestState>(
        aggregateType,
        aggregateId,
        eventStore,
        r2SnapshotStore,
        TestState
      );
      const duration = performance.now() - startTime;

      // Assert: Performance target met
      expect(result).not.toBeNull();
      expect(result?.version).toBe(99);
      expect(result?.orgId).toBe('');
      expect(duration).toBeLessThan(100); // <100ms target
    });
  });

  describe('Snapshot + incremental with R2SnapshotStore', () => {
    it('should restore from R2 snapshot + incremental events', async () => {
      // Arrange: Register handlers
      const aggregateType = 'counter';
      const aggregateId = 'counter-003';
      new (createTestCreatedHandler(aggregateType))();
      new (createTestIncrementedHandler(aggregateType))();
      new (createTestRenamedHandler(aggregateType))();

      // Save first 30 events
      for (let i = 1; i <= 30; i++) {
        const event =
          i === 1
            ? createTestEvent(aggregateType, aggregateId, 1, 'TestCreated', {
                name: 'Original Name',
              })
            : createTestEvent(
                aggregateType,
                aggregateId,
                i,
                'TestIncremented',
                { amount: 1 }
              );
        await eventStore.save(event);
      }

      // Create snapshot at version 30
      const snapshot: StoredSnapshot = {
        aggregateType,
        aggregateId,
        version: 30,
        timestamp: new Date().toISOString(),
        state: {
          id: aggregateId,
          version: 30,
          timestamp: new Date().toISOString(),
          orgId: '',
          count: 29,
          name: 'Original Name',
        } as TestState,
      };
      await r2SnapshotStore.save(snapshot);

      // Save 20 more events (31-50)
      for (let i = 31; i <= 50; i++) {
        await eventStore.save(
          createTestEvent(aggregateType, aggregateId, i, 'TestIncremented', {
            amount: 1,
          })
        );
      }

      // Add a rename event
      await eventStore.save(
        createTestEvent(aggregateType, aggregateId, 51, 'TestRenamed', {
          newName: 'Updated Name',
        })
      );

      // Act: Restore state (should use snapshot + incremental)
      const result = await restoreState<TestState>(
        aggregateType,
        aggregateId,
        eventStore,
        r2SnapshotStore,
        TestState
      );

      // Assert: Verify snapshot was used and incremental events applied
      expect(result).not.toBeNull();
      expect(result?.version).toBe(51);
      expect(result?.orgId).toBe('');
      expect(result?.count).toBe(49); // 29 from snapshot + 20 more increments
      expect(result?.name).toBe('Updated Name');
    });

    it('should verify snapshot-first optimization with real R2 stores', async () => {
      // Arrange
      const aggregateType = 'counter';
      const aggregateId = 'counter-004';
      new (createTestCreatedHandler(aggregateType))();
      new (createTestIncrementedHandler(aggregateType))();

      // Save snapshot at version 100
      const snapshot: StoredSnapshot = {
        aggregateType,
        aggregateId,
        version: 100,
        timestamp: new Date().toISOString(),
        state: {
          id: aggregateId,
          version: 100,
          timestamp: new Date().toISOString(),
          orgId: '',
          count: 100,
          name: 'Test',
        } as TestState,
      };
      await r2SnapshotStore.save(snapshot);

      // Save only 5 incremental events after snapshot
      for (let i = 101; i <= 105; i++) {
        await eventStore.save(
          createTestEvent(aggregateType, aggregateId, i, 'TestIncremented', {
            amount: 2,
          })
        );
      }

      // Act: Restore state
      const result = await restoreState<TestState>(
        aggregateType,
        aggregateId,
        eventStore,
        r2SnapshotStore,
        TestState
      );

      // Assert: Only 5 events should have been replayed (not 105)
      expect(result).not.toBeNull();
      expect(result?.version).toBe(105);
      expect(result?.orgId).toBe('');
      expect(result?.count).toBe(110); // 100 from snapshot + 5 * 2
    });

    it('should return snapshot state when no events after snapshot', async () => {
      // Arrange
      const aggregateType = 'counter';
      const aggregateId = 'counter-005';
      new (createTestCreatedHandler(aggregateType))();

      // Save snapshot only (no new events)
      const snapshot: StoredSnapshot = {
        aggregateType,
        aggregateId,
        version: 50,
        timestamp: new Date().toISOString(),
        state: {
          id: aggregateId,
          version: 50,
          timestamp: new Date().toISOString(),
          orgId: '',
          count: 42,
          name: 'Final State',
        } as TestState,
      };
      await r2SnapshotStore.save(snapshot);

      // Act: Restore state (no events to replay)
      const result = await restoreState<TestState>(
        aggregateType,
        aggregateId,
        eventStore,
        r2SnapshotStore,
        TestState
      );

      // Assert: Should return snapshot state unchanged
      expect(result).not.toBeNull();
      expect(result?.version).toBe(50);
      expect(result?.orgId).toBe('');
      expect(result?.count).toBe(42);
      expect(result?.name).toBe('Final State');
    });
  });

  describe('Snapshot + incremental with D1SnapshotStore', () => {
    it('should restore from D1 snapshot + incremental events', async () => {
      // Arrange
      const aggregateType = 'counter';
      const aggregateId = 'counter-006';
      new (createTestCreatedHandler(aggregateType))();
      new (createTestIncrementedHandler(aggregateType))();

      // Save snapshot to D1 at version 20
      const snapshot: StoredSnapshot = {
        aggregateType,
        aggregateId,
        version: 20,
        timestamp: new Date().toISOString(),
        state: {
          id: aggregateId,
          version: 20,
          timestamp: new Date().toISOString(),
          orgId: '',
          count: 19,
          name: 'D1 Test',
        } as TestState,
      };
      await d1SnapshotStore.save(snapshot);

      // Save 10 more events to R2 (21-30)
      for (let i = 21; i <= 30; i++) {
        await eventStore.save(
          createTestEvent(aggregateType, aggregateId, i, 'TestIncremented', {
            amount: 1,
          })
        );
      }

      // Act: Restore state using D1 snapshot store
      const result = await restoreState<TestState>(
        aggregateType,
        aggregateId,
        eventStore,
        d1SnapshotStore,
        TestState
      );

      // Assert: D1 snapshot used + incremental events applied
      expect(result).not.toBeNull();
      expect(result?.version).toBe(30);
      expect(result?.orgId).toBe('');
      expect(result?.count).toBe(29); // 19 from D1 snapshot + 10 increments
      expect(result?.name).toBe('D1 Test');
    });

    it('should verify incremental loading works with D1 snapshots', async () => {
      // Arrange
      const aggregateType = 'counter';
      const aggregateId = 'counter-007';
      new (createTestCreatedHandler(aggregateType))();
      new (createTestIncrementedHandler(aggregateType))();

      // Save many events to R2 (simulate large history)
      for (let i = 1; i <= 100; i++) {
        const event =
          i === 1
            ? createTestEvent(aggregateType, aggregateId, 1, 'TestCreated', {
                name: 'D1 Large Test',
              })
            : createTestEvent(
                aggregateType,
                aggregateId,
                i,
                'TestIncremented',
                { amount: 1 }
              );
        await eventStore.save(event);
      }

      // Save D1 snapshot at version 90 (only 10 events to replay)
      const snapshot: StoredSnapshot = {
        aggregateType,
        aggregateId,
        version: 90,
        timestamp: new Date().toISOString(),
        state: {
          id: aggregateId,
          version: 90,
          timestamp: new Date().toISOString(),
          orgId: '',
          count: 89,
          name: 'D1 Large Test',
        } as TestState,
      };
      await d1SnapshotStore.save(snapshot);

      // Act: Restore state (should only replay 10 events, not 100)
      const result = await restoreState<TestState>(
        aggregateType,
        aggregateId,
        eventStore,
        d1SnapshotStore,
        TestState
      );

      // Assert: Incremental loading worked
      expect(result).not.toBeNull();
      expect(result?.version).toBe(100);
      expect(result?.orgId).toBe('');
      expect(result?.count).toBe(99); // 89 from snapshot + 10 increments
    });
  });

  describe('Version auto-management in end-to-end flow ()', () => {
    it('should auto-set version from envelope regardless of handler implementation', async () => {
      // Arrange: Register handlers (buggy handler is now fixed per )
      const aggregateType = 'counter';
      const aggregateId = 'counter-008';
      new (createTestCreatedHandler(aggregateType))();
      new (createBuggyIncrementedHandler(aggregateType))(); // Still works - framework sets version

      // Save events to real R2
      await eventStore.save(
        createTestEvent(aggregateType, aggregateId, 1, 'TestCreated', {
          name: 'Auto Version Test',
        })
      );
      await eventStore.save(
        createTestEvent(aggregateType, aggregateId, 2, 'TestIncremented', {
          amount: 5,
        })
      );

      // Act: Restore state - framework auto-sets version from envelope
      const result = await restoreState<TestState>(
        aggregateType,
        aggregateId,
        eventStore,
        r2SnapshotStore,
        TestState
      );

      // Assert: Version is correctly set even though handler doesn't manage it
      expect(result).not.toBeNull();
      expect(result?.version).toBe(2); // Auto-set from envelope
      expect(result?.orgId).toBe(''); // Auto-set from envelope
      expect(result?.count).toBe(5);
    });

    it('should maintain version consistency across multiple events', async () => {
      // Arrange
      const aggregateType = 'counter';
      const aggregateId = 'counter-009';
      new (createTestCreatedHandler(aggregateType))();
      new (createBuggyIncrementedHandler(aggregateType))();

      // Save multiple events
      await eventStore.save(
        createTestEvent(aggregateType, aggregateId, 1, 'TestCreated', {
          name: 'Version Consistency Test',
        })
      );
      for (let i = 2; i <= 5; i++) {
        await eventStore.save(
          createTestEvent(aggregateType, aggregateId, i, 'TestIncremented', {
            amount: 1,
          })
        );
      }

      // Act: Restore state
      const result = await restoreState<TestState>(
        aggregateType,
        aggregateId,
        eventStore,
        r2SnapshotStore,
        TestState
      );

      // Assert: Version matches last event version
      expect(result).not.toBeNull();
      expect(result?.version).toBe(5); // Last event version
      expect(result?.orgId).toBe('');
      expect(result?.count).toBe(4); // 0 + 1 + 1 + 1 + 1
    });

    it('should auto-set version after snapshot + incremental restoration', async () => {
      // Arrange: Handler doesn't need to manage version anymore
      const aggregateType = 'counter';
      const aggregateId = 'counter-010';
      new (createTestCreatedHandler(aggregateType))();
      new (createBuggyIncrementedHandler(aggregateType))();

      // Save valid snapshot to R2
      const snapshot: StoredSnapshot = {
        aggregateType,
        aggregateId,
        version: 10,
        timestamp: new Date().toISOString(),
        state: {
          id: aggregateId,
          version: 10,
          timestamp: new Date().toISOString(),
          orgId: '',
          count: 10,
          name: 'Snapshot Test',
        } as TestState,
      };
      await r2SnapshotStore.save(snapshot);

      // Save one more event
      await eventStore.save(
        createTestEvent(aggregateType, aggregateId, 11, 'TestIncremented', {
          amount: 1,
        })
      );

      // Act: Restore state - framework manages version
      const result = await restoreState<TestState>(
        aggregateType,
        aggregateId,
        eventStore,
        r2SnapshotStore,
        TestState
      );

      // Assert: Version correctly updated from envelope
      expect(result).not.toBeNull();
      expect(result?.version).toBe(11); // Auto-set from envelope
      expect(result?.orgId).toBe('');
      expect(result?.count).toBe(11); // 10 from snapshot + 1 increment
    });
  });

  describe('Error handling with real storage', () => {
    it('should throw EventApplicationError when handler not registered', async () => {
      // Arrange: No handlers registered
      const aggregateType = 'counter';
      const aggregateId = 'counter-011';

      // Save event
      await eventStore.save(
        createTestEvent(aggregateType, aggregateId, 1, 'TestCreated', {
          name: 'Missing Handler',
        })
      );

      // Act & Assert: Should throw EventApplicationError
      await expect(
        restoreState<TestState>(
          aggregateType,
          aggregateId,
          eventStore,
          r2SnapshotStore,
        TestState
        )
      ).rejects.toThrow(EventApplicationError);
    });

    it('should handle aggregate with no events and no snapshot', async () => {
      // Arrange: Register handlers but don't save any data
      const aggregateType = 'counter';
      const aggregateId = 'counter-999';
      new (createTestCreatedHandler(aggregateType))();

      // Act: Try to restore non-existent aggregate
      const result = await restoreState<TestState>(
        aggregateType,
        aggregateId,
        eventStore,
        r2SnapshotStore,
        TestState
      );

      // Assert: Should return null
      expect(result).toBeNull();
    });
  });

  describe('Cross-epic integration validation', () => {
    it('should integrate  (Storage),  (Schemas),  (Decorators)', async () => {
      // Arrange: This test validates all cross-epic integration points
      const aggregateType = 'integrated';
      const aggregateId = 'int-001';
      // Register event handlers via decorators
      new (createTestCreatedHandler(aggregateType))();
      new (createTestIncrementedHandler(aggregateType))();
      new (createTestRenamedHandler(aggregateType))();

      // Use R2EventStore and R2SnapshotStore
      const events: StoredEvent[] = [
        createTestEvent(aggregateType, aggregateId, 1, 'TestCreated', {
          name: 'Integration Test',
        }),
        createTestEvent(aggregateType, aggregateId, 2, 'TestIncremented', {
          amount: 10,
        }),
        createTestEvent(aggregateType, aggregateId, 3, 'TestRenamed', {
          newName: 'Updated Integration',
        }),
      ];

      for (const event of events) {
        await eventStore.save(event);
      }

      // Act: Restore state
      const result = await restoreState<TestState>(
        aggregateType,
        aggregateId,
        eventStore,
        r2SnapshotStore,
        TestState
      );

      // Assert: Verify BaseState schema compliance
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('orgId');

      // Assert: Full integration worked
      expect(result?.id).toBe(aggregateId);
      expect(result?.version).toBe(3);
      expect(result?.orgId).toBe('');
      expect(result?.count).toBe(10);
      expect(result?.name).toBe('Updated Integration');
    });

    it('should validate complete flow: snapshot → events → handlers → version', async () => {
      // Arrange: Complete cross-epic flow
      const aggregateType = 'complete';
      const aggregateId = 'cmp-001';
      new (createTestCreatedHandler(aggregateType))();
      new (createTestIncrementedHandler(aggregateType))();

      // Save snapshot to R2
      const snapshot: StoredSnapshot = {
        aggregateType,
        aggregateId,
        version: 5,
        timestamp: new Date().toISOString(),
        state: {
          id: aggregateId,
          version: 5,
          timestamp: new Date().toISOString(),
          orgId: '',
          count: 5,
          name: 'Complete Flow',
        } as TestState,
      };
      await r2SnapshotStore.save(snapshot);

      // Save events to R2
      for (let i = 6; i <= 10; i++) {
        await eventStore.save(
          createTestEvent(aggregateType, aggregateId, i, 'TestIncremented', {
            amount: 2,
          })
        );
      }

      // Act: Restore state (handlers, schemas)
      const result = await restoreState<TestState>(
        aggregateType,
        aggregateId,
        eventStore,
        r2SnapshotStore,
        TestState
      );

      // Assert: Complete flow validated
      expect(result).not.toBeNull();
      expect(result?.version).toBe(10); // Version tracking worked
      expect(result?.orgId).toBe('');
      expect(result?.count).toBe(15); // 5 from snapshot + 5 * 2 increments
      expect(result?.name).toBe('Complete Flow');
    });
  });
});
