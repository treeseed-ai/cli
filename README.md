# `@treeseed/cli`

Operator-facing Treeseed CLI package.

This package owns the published `treeseed` binary and delegates command execution into the Treeseed platform runtime. It is intended to be installed alongside `@treeseed/core`.

## Consumer Contract

- Node `>=20`
- install from npm alongside `@treeseed/core`
- use the published `treeseed` binary from tenant scripts

Typical tenant dependency set:

```json
{
  "dependencies": {
    "@treeseed/cli": "^0.0.1",
    "@treeseed/core": "^0.0.1"
  }
}
```
