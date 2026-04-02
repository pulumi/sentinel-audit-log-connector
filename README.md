# Pulumi Cloud Audit Logs Connector for Microsoft Sentinel

A [Pulumi template](https://www.pulumi.com/docs/cli/commands/pulumi_new/) that deploys a [Codeless Connector (CCF)](https://learn.microsoft.com/en-us/azure/sentinel/create-codeless-connector) to continuously export [Pulumi Cloud audit log events](https://www.pulumi.com/docs/pulumi-cloud/audit-logs/) into Microsoft Sentinel. The connector polls the Pulumi Cloud REST API every 5 minutes and writes events to a custom `PulumiAuditLogs_CL` table in your Log Analytics workspace.

No Azure Functions, Logic Apps, or other compute resources are needed — Azure Sentinel handles polling, pagination, checkpointing, and retry automatically.

## Prerequisites

- A Microsoft Sentinel workspace (Log Analytics workspace with Sentinel enabled)
- A Pulumi Cloud organization with an **Enterprise** or **Business Critical** subscription (audit logs are an enterprise feature)
- A [Pulumi access token](https://app.pulumi.com/account/tokens) with audit log read permissions (org-scoped service token recommended)

## Deploy

### Option 1: Deploy with Pulumi (recommended)

Click the button below to open the Pulumi New Project Wizard with this template pre-selected:

[![Deploy with Pulumi](https://get.pulumi.com/new/button.svg)](https://app.pulumi.com/new?template=https://github.com/pulumi/sentinel-audit-log-connector)

The wizard will prompt you for your Pulumi org name, access token, Sentinel workspace, resource group, and Azure region. Select **Pulumi Deployments** to run `pulumi up` server-side — no CLI install needed.

### Option 2: Deploy via CLI

```bash
pulumi new https://github.com/pulumi/sentinel-audit-log-connector
# Enter config values when prompted (access token is stored as an encrypted secret)
pulumi up
```

### Option 3: Deploy with Pulumi ESC

For centralized secret management, store your Pulumi access token in a [Pulumi ESC environment](https://www.pulumi.com/docs/esc/) (optionally backed by Azure Key Vault) and attach it to the stack. The token is resolved automatically at deployment time.

### Configuration

| Config key | Description | Required | Default |
|------------|-------------|----------|---------|
| `orgName` | Pulumi Cloud organization name | Yes | — |
| `accessToken` | Pulumi access token (stored as encrypted secret) | Yes | — |
| `workspaceName` | Log Analytics workspace name | Yes | — |
| `resourceGroupName` | Azure resource group containing the workspace | Yes | — |
| `azure-native:location` | Azure region | No | `eastus` |
| `apiUrl` | Pulumi API URL (for self-hosted instances) | No | `https://api.pulumi.com` |

## What gets deployed

The template creates five Azure resources:

1. **Custom Log Analytics table** (`PulumiAuditLogs_CL`) — 15 typed columns
2. **Data Collection Endpoint** — ingestion endpoint for the connector
3. **Data Collection Rule** — KQL transform that maps API responses to the table schema
4. **Connector UI definition** — makes the connector visible in the Sentinel portal
5. **RestApiPoller data connector** — polls the audit log API every 5 minutes

To remove everything: `pulumi destroy`

## What gets ingested

Events are written to the `PulumiAuditLogs_CL` table:

| Column | Type | Description |
|--------|------|-------------|
| `TimeGenerated` | datetime | When the event occurred (UTC) |
| `Event_s` | string | Event type (e.g., `stack-created`, `member-added`) |
| `Description_s` | string | Human-readable event description |
| `SourceIP_s` | string | Client IP address |
| `UserName_s` | string | User display name |
| `UserLogin_s` | string | User GitHub login |
| `UserAvatarUrl_s` | string | User avatar URL |
| `TokenID_s` | string | Access token ID (if applicable) |
| `TokenName_s` | string | Access token name (if applicable) |
| `ActorName_s` | string | Non-human actor name (e.g., deploy token) |
| `ActorUrn_s` | string | Non-human actor Pulumi URN |
| `RequireOrgAdmin_b` | boolean | Action required org admin privileges |
| `RequireStackAdmin_b` | boolean | Action required stack admin privileges |
| `AuthFailure_b` | boolean | Failed authentication attempt |

## Sample queries

### Excessive authentication failures

Detect more than 5 authentication failures from a single IP in 15 minutes:

```kql
PulumiAuditLogs_CL
| where AuthFailure_b == true
| summarize FailCount = count() by SourceIP_s, bin(TimeGenerated, 15m)
| where FailCount > 5
```

### Stack deletions

```kql
PulumiAuditLogs_CL
| where Event_s == "stack-deleted"
```

### Organization membership changes

```kql
PulumiAuditLogs_CL
| where Event_s in ("member-added", "member-removed", "member-role-changed")
```

## Token permissions

The access token needs a role with `RbacPermissionAuditLogsRead`. We recommend using an **org-scoped service token** rather than a personal access token — service tokens are not tied to a specific user and won't break if someone leaves the organization.

## Self-hosted Pulumi Cloud

If you run a self-hosted Pulumi Cloud instance, set the `apiUrl` config value to your instance's API URL (e.g., `https://api.your-company.com`). Azure Sentinel's CCF infrastructure uses the [Scuba service tag](https://learn.microsoft.com/en-us/azure/virtual-network/service-tags-overview#available-service-tags) — you may need to allowlist these IPs if your instance is not publicly accessible.

## Troubleshooting

- **No data appearing**: Allow up to 10 minutes after initial setup. Verify your access token is valid and the organization has audit logs enabled (Enterprise subscription required).
- **HTTP 400 from the API**: The organization likely lacks an Enterprise subscription. The API returns HTTP 400 (not 401/403) with "Audit Logs is available only to organizations with an Enterprise subscription."
- **Connector shows "disconnected"**: Check that the access token has not been revoked. Update the token in Pulumi config and run `pulumi up` to propagate the change.
- **Connector not visible in Sentinel**: Refresh the Data connectors gallery. The connector appears under the name "Pulumi Cloud Audit Logs."

## Architecture

```
Microsoft Sentinel (your Azure subscription)
    |
    +-- Connector Definition (UI in Sentinel portal)
    +-- RestApiPoller (polls every 5 min)
    |       |
    |       +-- GET https://api.pulumi.com/api/orgs/{orgName}/auditlogs/v2
    |               ?startTime={windowStart}&endTime={windowEnd}
    |               Authorization: token <pulumi-access-token>
    |
    +-- Data Collection Endpoint + Data Collection Rule (KQL transform)
    |
    +-- PulumiAuditLogs_CL (custom Log Analytics table)
```

## Known limitations

- **No historical backfill**: The connector only polls from the time it is deployed. Historical events must be backfilled separately via the REST API.
- **Org name changes**: If the Pulumi org is renamed, the connector's hardcoded org name becomes invalid (404). Update the config and run `pulumi up`.

## License

Apache 2.0
