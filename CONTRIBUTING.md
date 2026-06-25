# Contributing

Thanks for helping improve Hermes Lens.

## Project Boundaries

Hermes Lens is a read-only sidecar viewer. Contributions must preserve these
boundaries:

- Do not submit prompts to Hermes.
- Do not invoke tools or robot actions.
- Do not join the final response path.
- Treat the JSONL event stream as the integration contract.
- Keep exporter I/O non-blocking from the Hermes perspective.

## Development

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt

cd frontend
npm install
npm run build
cd ..
```

Run checks before opening a pull request:

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/python -m pytest backend/tests

cd frontend
npm run typecheck
npm test
npm run build
```

## Documentation

Update `README.md` and `README.zh-CN.md` when user-facing setup, behavior, or
configuration changes.

## Security

Do not include private event streams, real user messages, local paths, tokens,
or screenshots containing sensitive information in issues or pull requests.
