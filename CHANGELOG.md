# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0/).

## [0.1.0] - 2026-06-02

Initial release, published to npm as [`@create-send/node-js`](https://www.npmjs.com/package/@create-send/node-js).

### Added

- `Createsend` client for the Campaign Monitor API — HTTP Basic auth from an API key (falls back to `CREATESEND_API_KEY`), with configurable `baseUrl`, `userAgent`, and `fetch`.
- Typed methods across 16 resources covering 113 operations: campaigns, clients, lists, segments, subscribers, templates, journeys, transactional (smart/classic email, messages, statistics), admins, people, and account utilities.
- `Response<T>` discriminated-union returns (`{ data, error: null }` or `{ data: null, error }`); API calls never throw — only the constructor throws, when the API key is missing.
- Dual ESM + CommonJS output with TypeScript declarations.
- Spec-driven code generation from `spec/createsend-openapi.yaml` (Campaign Monitor API v3.4) via `npm run generate`.
