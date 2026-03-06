/**
 * @Route decorator for registering Chanfana OpenAPIRoute classes
 */

import { OpenAPIRoute } from 'chanfana';
import { routeRegistry } from './RouteRegistry.js';

/**
 * Route decorator options
 */
export interface RouteOptions {
  /** HTTP method (GET, POST, PUT, DELETE, PATCH, etc.) */
  method: string;
  /** Route path (e.g., '/users/:id') */
  path: string;
}

/**
 * Decorator for registering route handlers with Chanfana.
 *
 * This decorator registers any class that extends Chanfana's OpenAPIRoute
 * in the global route registry. The router factory will auto-discover all
 * registered routes at startup and register them with Chanfana.
 *
 * **Type Safety:**
 * - TypeScript enforces at compile-time that decorated classes extend OpenAPIRoute
 * - Use `getValidatedData<typeof this.schema>()` for type-safe request validation
 * - Chanfana automatically generates OpenAPI schemas from route definitions
 *
 * **Usage:**
 * ```typescript
 * import { OpenAPIRoute } from 'chanfana';
 * import { Route } from 'ceves';
 * import { z } from 'zod';
 *
 * @Route({ method: 'GET', path: '/users/:id' })
 * export class GetUserRoute extends OpenAPIRoute {
 *   schema = {
 *     request: {
 *       params: z.object({
 *         id: z.string().uuid(),
 *       }),
 *     },
 *     responses: {
 *       200: {
 *         description: 'User retrieved successfully',
 *         content: {
 *           'application/json': {
 *             schema: z.object({
 *               id: z.string(),
 *               email: z.string(),
 *             }),
 *           },
 *         },
 *       },
 *     },
 *   };
 *
 *   async handle(c: Context) {
 *     // Type-safe validation
 *     const data = await this.getValidatedData<typeof this.schema>();
 *     const { id } = data.params; // id is typed as string
 *
 *     // Handler logic
 *     return { id, email: 'user@example.com' };
 *   }
 * }
 * ```
 *
 * @param options - Route configuration with method and path
 * @returns Class decorator function
 */
export function Route(options: RouteOptions) {
  // Note: any[] is required for class decorator constructor type compatibility
  return function <T extends new (...args: any[]) => OpenAPIRoute>(target: T): T {
    // Register route in global registry with method and path
    routeRegistry.register(target as unknown as typeof OpenAPIRoute, options.method, options.path);

    // Return the class unchanged (decorator is for registration only)
    return target;
  };
}

/**
 * Get all registered routes (for router factory)
 *
 * @returns Array of all registered route metadata
 */
export function getRegisteredRoutes() {
  return routeRegistry.getAll();
}

/**
 * Clear all registered routes (for testing)
 */
export function clearRoutes(): void {
  routeRegistry.clear();
}

/**
 * Find route handler by URL and method
 *
 * Used by Durable Objects to find the handler class for a forwarded request.
 *
 * @param method - HTTP method (GET, POST, etc.)
 * @param pathname - Actual URL pathname (e.g., '/users/abc123/CreateUser')
 * @returns Matching route class and extracted path params, or undefined
 */
export function findRouteByUrl(
  method: string,
  pathname: string
): { RouteClass: typeof OpenAPIRoute; params: Record<string, string> } | undefined {
  const result = routeRegistry.findByUrlAndMethod(method, pathname);
  if (!result) {
    return undefined;
  }
  return {
    RouteClass: result.route.RouteClass,
    params: result.params,
  };
}
