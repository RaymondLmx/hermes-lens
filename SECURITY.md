# Security Policy

Hermes Lens is a local read-only monitor for Hermes-compatible event streams.

## Supported Versions

Security fixes target the latest released version.

## Reporting a Vulnerability

Please open a private security advisory on GitHub or contact the maintainers
directly. Do not publish proof-of-concept payloads that expose private user
messages, tokens, local files, or media.

## Security Model

- The monitor must not submit prompts, call tools, or control Hermes.
- Event payloads are untrusted input.
- The frontend must not render HTML from event payloads.
- `/api/media` must only serve files inside configured allowlisted roots.
- Exporter failures must not block Hermes or planner execution.
