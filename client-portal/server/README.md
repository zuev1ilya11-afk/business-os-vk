# Client API

Implementation and production boundary: [backend documentation](../../docs/client-portal/backend.md).

Run isolated development with `node client-portal/staging/start.cjs` from repository
root. Production entry `node client-portal/server/start.cjs` never applies migrations
and refuses incomplete/test configuration. See its environment example.
