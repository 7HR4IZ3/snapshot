# 11 - Packaging and Distribution Spec

## Packaging Goals

1. Build runnable JavaScript CLI output in `dist/`.
2. Expose `snapshot` executable via package `bin` mapping.
3. Support local development and global linked installation.

## Build Outputs

- TypeScript build target: `dist/`
- CLI entrypoint: `dist/cli.js`
- Executable permission set on built CLI file.

## Build Configuration

- `tsconfig.build.json` controls emit build.
- source root: `src/`
- emit disabled in main tsconfig, enabled in build tsconfig.

## Package Configuration

`package.json` key requirements:

- `main`: `dist/cli.js`
- `module`: `dist/cli.js`
- `bin.snapshot`: `dist/cli.js`
- `files`: include `dist`

## Scripts

- `clean`: remove `dist`
- `build`: clean + compile + `chmod +x dist/cli.js`
- `snapshot`: run development CLI from source

## Installation Workflows

### Local Development

```bash
bun run src/cli.ts --help
```

### Build and Link Globally

```bash
bun run build
bun link
snapshot --help
```

## Compatibility Notes

- build path must remain stable for `bin.snapshot`
- runtime dependencies required by emitted JS must stay in package dependencies
