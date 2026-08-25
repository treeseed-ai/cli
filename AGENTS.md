# CLI workspace guidance

The CLI is an Apache-2.0 repository. It has no contributor-grant checkbox, approved-committer allowlist, or contribution-attestation requirement. Human and agent changes use the same durable pull-request record and the same exact-head verification, review, staging, and release gates.

Agents must act only within their assignment authority, preserve exact repository and commit evidence, keep password and token material out of arguments and logs, and keep GitHub credentials outside execution workspaces. Preserve fully local operation without a hosted Market dependency.

## Project library

Use `trsd library show cli` and `status` before querying `treeseed-ai/cli-library`. Read root-level paths at an exact commit. Author only through governed library workspaces and reviews. Never recreate `src/content` or edit `.treeseed/data` directly.
