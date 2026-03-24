# Release Notes

## Version 1.0.0

- Initial release of the Pulumi Cloud Audit Logs connector for Microsoft Sentinel
- Polls the Pulumi Cloud V2 Audit Logs API every 5 minutes
- Ingests audit log events into the `PulumiAuditLogs_CL` custom table
- Includes built-in analytic rules:
  - Excessive authentication failures detection
  - Stack deletion alerts
  - Organization membership change tracking
- Supports self-hosted Pulumi Cloud instances via configurable API URL
