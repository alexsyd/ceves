/**
 * Router factory for Ceves Framework
 *
 * Creates a Chanfana OpenAPIRouter with auto-discovered routes
 */

import { fromHono, ApiException } from 'chanfana';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { getRegisteredRoutes } from './Route.js';

const logger = { debug: (...args: unknown[]) => console.debug('[Router]', ...args), error: (...args: unknown[]) => console.error('[Router]', ...args) };


/**
 * OpenAPI server entry
 */
export interface OpenAPIServer {
  /** Server URL */
  url: string;
  /** Human-readable description of the server */
  description?: string;
}

/**
 * OpenAPI metadata configuration
 */
export interface OpenAPIMetadata {
  /** API title */
  title?: string;
  /** API version */
  version?: string;
  /** API description */
  description?: string;
  /** Server list for the OpenAPI spec */
  servers?: OpenAPIServer[];
}

/**
 * Environment validation configuration
 */
export interface EnvConfig {
  /** Zod schema for environment validation */
  schema: z.ZodTypeAny;
  /** Skip validation in development (default: false) */
  skipInDev?: boolean;
  /** Custom error handler for validation failures */
  onError?: (error: z.ZodError, c: Context) => Response | Promise<Response>;
}

/**
 * Router configuration options
 */
export interface RouterOptions {
  /** Base path for all routes (e.g., '/api/v1') */
  basePath?: string;
  /** OpenAPI metadata */
  openapi?: OpenAPIMetadata;
  /** Swagger UI path (default: '/docs') */
  docsPath?: string;
  /** OpenAPI spec path (default: '/openapi.json') */
  schemaPath?: string;
  /** Whether to enable Swagger UI (default: true) */
  enableDocs?: boolean;
  /** Middleware to apply before routes are registered */
  middleware?: Array<(c: Context, next: () => Promise<void>) => Promise<void | Response>>;
}

/**
 * Create Chanfana router with all registered routes.
 *
 * This factory function:
 * 1. Auto-discovers all @Route decorated classes from the global registry
 * 2. Creates a Chanfana OpenAPIRouter with the provided configuration
 * 3. Registers all routes with Chanfana for automatic OpenAPI generation
 * 4. Returns a configured Hono app ready to handle requests
 *
 * **Usage:**
 * ```typescript
 * import { createRouter } from 'ceves';
 * import './routes'; // Import files with @Route decorators
 *
 * // With typed bindings
 * type Bindings = {
 *   DB: D1Database;
 *   API_KEY: string;
 * };
 *
 * const app = createRouter<{ Bindings: Bindings }>({
 *   basePath: '/api/v1',
 *   openapi: {
 *     title: 'My API',
 *     version: '1.0.0',
 *     description: 'API built with Ceves',
 *   },
 * });
 *
 * export default app;
 * ```
 *
 * @param options - Router configuration options
 * @returns Configured Hono app with Chanfana OpenAPI support
 */
export function createRouter<Env extends Record<string, unknown> = Record<string, never>>(options: RouterOptions = {}) {
  const {
    openapi = {},
    docsPath = '/docs',
    schemaPath = '/openapi.json',
    enableDocs = true,
    middleware = [],
  } = options;

  // Create base Hono app with typed bindings
  const app = new Hono<Env>();

  // Add global error handler for ApiException (CevesError extends ApiException)
  // Chanfana's OpenAPIRoute.execute() only catches ZodError, so we need this
  app.onError((err, c) => {
    // Handle ApiException (and all subclasses like CevesError, BusinessRuleViolationError)
    if (err instanceof ApiException) {
      const status = err.status ?? 500;
      const response = err.buildResponse();
      return c.json(
        {
          success: false,
          errors: response,
        },
        status as 400 | 401 | 403 | 404 | 500
      );
    }

    // Re-throw unknown errors for Hono's default handling
    logger.error('Unhandled error', { error: err });
    throw err;
  });

  // Add custom middleware before routes are registered
  for (const mw of middleware) {
    app.use('*', mw);
  }

  // Create Chanfana OpenAPIRouter
  // Note: we keep reference to `app` and will return it, not openapi_instance
  const openapi_instance = fromHono(app, {
    docs_url: enableDocs ? docsPath : undefined,
    openapi_url: schemaPath,
    schema: {
      info: {
        title: openapi.title ?? 'API',
        version: openapi.version ?? '1.0.0',
        description: openapi.description,
      },
      servers: (openapi.servers ?? []) as unknown as [],
      security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
    },
  });

  // Register security schemes via the registry (components is excluded from schema type)
  openapi_instance.registry.registerComponent('securitySchemes', 'BearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'JWT Bearer token for authentication.',
  });
  openapi_instance.registry.registerComponent('securitySchemes', 'ApiKeyAuth', {
    type: 'apiKey',
    in: 'header',
    name: 'X-API-Key',
    description: 'API key for organization access.',
  });

  // Register all @Route decorated classes
  const routes = getRegisteredRoutes();
  logger.debug('Registering routes', { count: routes.length, routes: routes.map(r => `${r.method} ${r.path}`) });

  for (const { RouteClass, method, path } of routes) {
    // Register route with Chanfana using the appropriate HTTP method
    const lowerMethod = method.toLowerCase();

    switch (lowerMethod) {
      case 'get':
        openapi_instance.get(path, RouteClass);
        break;
      case 'post':
        openapi_instance.post(path, RouteClass);
        break;
      case 'put':
        openapi_instance.put(path, RouteClass);
        break;
      case 'delete':
        openapi_instance.delete(path, RouteClass);
        break;
      case 'patch':
        openapi_instance.patch(path, RouteClass);
        break;
      case 'all':
        openapi_instance.all(path, RouteClass);
        break;
      default:
        // Use .on() for custom HTTP methods
        openapi_instance.on(method, path, RouteClass);
        break;
    }
  }

  // Return the original Hono app for proper integration with middleware/wrappers
  // (e.g., Sentry.withSentry). The app now has OpenAPI routes registered via openapi_instance.
  return app;
}
