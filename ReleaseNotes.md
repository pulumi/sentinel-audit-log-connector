# Release Notes

## Version 1.0.0

Initial release of the Pulumi Cloud Audit Logs connector for Microsoft Sentinel.

- Pulumi template (TypeScript) deployable via `pulumi new`, the New Project Wizard, or Pulumi Deployments
- Polls the Pulumi Cloud V2 Audit Logs API every 5 minutes using Azure Sentinel's Codeless Connector Framework
- Ingests events into the `PulumiAuditLogs_CL` custom Log Analytics table (15 typed columns)
- Corrected KQL transform for fields omitted from JSON when empty/false (`coalesce` for `reqOrgAdmin`, `reqStackAdmin`, `authFailure`, `tokenID`, `tokenName`)
- Access token stored as an encrypted Pulumi secret
- Supports self-hosted Pulumi Cloud instances via configurable API URL
