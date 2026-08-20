# CLI agent contribution policy

Agents may populate or update the managed **Agent contribution attestation** only when their definition enables `delegated-project-authorization`, their assignment and capacity grant include `contribution_attestation`, and TreeSeed provides a valid project authorization receipt bound to the exact repository, agent, capacity provider, assignment, base SHA, and head SHA.

Agents must never check or edit the **Human contribution affirmation** and may not run contribution `apply`, `revoke`, or trusted-policy `project` actions. Those actions require an authenticated human team owner and explicit confirmation. Agents may use only `show` and `diagnose` until a scoped receipt is issued.

Keep work scoped to this CLI repository and preserve local operation without a hosted Market dependency.
