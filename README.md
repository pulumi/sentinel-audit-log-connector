# Pulumi Cloud Audit Logs Connector for Microsoft Sentinel

This connector ingests [Pulumi Cloud audit log events](https://www.pulumi.com/docs/pulumi-cloud/audit-logs/) into Microsoft Sentinel using the [Codeless Connector Framework (CCF)](https://learn.microsoft.com/en-us/azure/sentinel/create-codeless-connector). It polls the Pulumi Cloud REST API every 5 minutes and writes events to a custom `PulumiAuditLogs_CL` table in your Log Analytics workspace.

## Prerequisites

- A Microsoft Sentinel workspace
- A Pulumi Cloud organization with an **Enterprise** or **Business Critical** subscription (audit logs are an enterprise feature)
- A [Pulumi personal access token](https://app.pulumi.com/account/tokens) with audit log read permissions

## Deploy

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fpulumi%2Fazure-sentinel-pulumi-connector%2Fmain%2FPackage%2FmainTemplate.json)

Or deploy manually:

1. Go to **Azure Portal > Deploy a custom template**
2. Click **Build your own template in the editor**
3. Paste the contents of [`Package/mainTemplate.json`](Package/mainTemplate.json)
4. Click **Save**, then fill in the parameters:
   - **Workspace**: Your Microsoft Sentinel workspace name
5. Click **Review + create**, then **Create**
6. After deployment, go to **Microsoft Sentinel > Data connectors**
7. Find **Pulumi Cloud Audit Logs** and click **Open connector page**
8. Click **Add Organization** and enter your Pulumi organization name and access token

## What Gets Ingested

The connector writes to the `PulumiAuditLogs_CL` table with the following columns:

| Column | Type | Description |
|--------|------|-------------|
| `TimeGenerated` | datetime | When the event occurred (UTC) |
| `Event_s` | string | Event type (e.g., `stack-created`, `member-added`) |
| `Description_s` | string | Human-readable event description |
| `SourceIP_s` | string | Client IP address |
| `UserName_s` | string | User display name |
| `UserLogin_s` | string | User GitHub login |
| `TokenID_s` | string | Access token ID (if applicable) |
| `TokenName_s` | string | Access token name (if applicable) |
| `ActorName_s` | string | Non-human actor name (e.g., deploy token) |
| `ActorUrn_s` | string | Non-human actor Pulumi URN |
| `RequireOrgAdmin_b` | boolean | Action required org admin privileges |
| `RequireStackAdmin_b` | boolean | Action required stack admin privileges |
| `AuthFailure_b` | boolean | Failed authentication attempt |

## Built-in Analytic Rules

The solution includes sample analytic rules you can enable:

### Excessive Authentication Failures
Alerts when more than 5 authentication failures occur from a single IP in 15 minutes.

```kql
PulumiAuditLogs_CL
| where AuthFailure_b == true
| summarize FailCount = count() by SourceIP_s, bin(TimeGenerated, 15m)
| where FailCount > 5
```

### Stack Deletion
Alerts when a Pulumi stack is deleted.

```kql
PulumiAuditLogs_CL
| where Event_s == "stack-deleted"
```

### Organization Membership Changes
Alerts when members are added, removed, or have their roles changed.

```kql
PulumiAuditLogs_CL
| where Event_s in ("member-added", "member-removed", "member-role-changed")
```

## Self-Hosted Pulumi Cloud

If you run a self-hosted Pulumi Cloud instance, enter your API URL (e.g., `https://api.your-company.com`) in the **Pulumi API URL** field when connecting. Azure Sentinel's CCF infrastructure uses the [Scuba service tag](https://learn.microsoft.com/en-us/azure/virtual-network/service-tags-overview#available-service-tags) — you may need to allowlist these IPs if your instance is not publicly accessible.

## Architecture

```
Microsoft Sentinel (your Azure subscription)
    |
    +-- Data Connector Definition (UI in Sentinel portal)
    +-- RestApiPoller (polls every 5 min)
    |       |
    |       +-- GET https://api.pulumi.com/api/orgs/{orgName}/auditlogs/v2
    |               ?startTime={windowStart}&endTime={windowEnd}
    |               Authorization: token <pulumi-access-token>
    |
    +-- Data Collection Rule (KQL transform)
    |
    +-- PulumiAuditLogs_CL (custom Log Analytics table)
```

The connector uses Azure's Codeless Connector Framework — no Azure Functions, Logic Apps, or other compute resources are needed. Azure Sentinel handles polling, pagination, checkpointing, and retry logic automatically.

## Troubleshooting

- **No data appearing**: Allow up to 10 minutes after initial setup. Verify your access token is valid and the organization has audit logs enabled (Enterprise subscription required).
- **403 errors**: Ensure the access token has permissions to read audit logs for the specified organization.
- **Connector not visible**: After deploying the ARM template, refresh the Data connectors gallery in Sentinel.

## Repository Structure

```
Data Connectors/PulumiAuditLogs_CCF/
  PulumiAuditLogs_Table.json            -- Custom table schema
  PulumiAuditLogs_DCR.json              -- Data Collection Rule + KQL transform
  PulumiAuditLogs_ConnectorDefinition.json -- Sentinel portal UI definition
  PulumiAuditLogs_PollerConfig.json     -- RestApiPoller configuration
Analytic Rules/                         -- Sample analytic rule templates
Package/mainTemplate.json               -- Deployable ARM template
SolutionMetadata.json                   -- Content Hub metadata
```

## License

Apache 2.0. See [LICENSE](LICENSE) for details.
