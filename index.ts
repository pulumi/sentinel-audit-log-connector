// Copyright 2026, Pulumi Corporation. All rights reserved.

import * as pulumi from "@pulumi/pulumi";
import * as azure_native from "@pulumi/azure-native";
import { RestApiPollerDataConnector } from "@pulumi/azure-native/securityinsights/v20250301";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const config = new pulumi.Config();
const orgName = config.require("orgName");
const accessToken = config.requireSecret("accessToken");
const workspaceName = config.require("workspaceName");
const resourceGroupName = config.require("resourceGroupName");

const apiUrl = config.get("apiUrl") ?? "https://api.pulumi.com";

const connectorDefinitionName = "PulumiAuditLogsDefinition";
const tableName = "PulumiAuditLogs_CL";
const streamName = "Custom-PulumiAuditLogs";

// ---------------------------------------------------------------------------
// Look up the existing Log Analytics workspace
// ---------------------------------------------------------------------------

const workspace = azure_native.operationalinsights.getWorkspaceOutput({
    resourceGroupName,
    workspaceName,
});

// ---------------------------------------------------------------------------
// 1. Custom Log Analytics table
// ---------------------------------------------------------------------------

const table = new azure_native.operationalinsights.Table("table", {
    resourceGroupName,
    workspaceName,
    tableName,
    schema: {
        name: tableName,
        columns: [
            { name: "TimeGenerated", type: "datetime", description: "The timestamp (UTC) when the audit log event occurred." },
            { name: "Timestamp_d", type: "long", description: "Original Unix epoch seconds of the event." },
            { name: "SourceIP_s", type: "string", description: "IP address of the client that triggered the event." },
            { name: "Event_s", type: "string", description: "Audit log event type identifier." },
            { name: "Description_s", type: "string", description: "Human-readable description of the event." },
            { name: "UserName_s", type: "string", description: "Display name of the user who performed the action." },
            { name: "UserLogin_s", type: "string", description: "GitHub login of the user who performed the action." },
            { name: "UserAvatarUrl_s", type: "string", description: "Avatar URL of the user." },
            { name: "TokenID_s", type: "string", description: "ID of the access token used, if applicable." },
            { name: "TokenName_s", type: "string", description: "Name of the access token used, if applicable." },
            { name: "ActorName_s", type: "string", description: "Display name of a non-human actor." },
            { name: "ActorUrn_s", type: "string", description: "Pulumi URN of a non-human actor." },
            { name: "RequireOrgAdmin_b", type: "boolean", description: "Whether the action required organization admin privileges." },
            { name: "RequireStackAdmin_b", type: "boolean", description: "Whether the action required stack admin privileges." },
            { name: "AuthFailure_b", type: "boolean", description: "Whether the event represents a failed authentication attempt." },
        ],
    },
});

// ---------------------------------------------------------------------------
// 2. Data Collection Endpoint
// ---------------------------------------------------------------------------

const dataCollectionEndpoint = new azure_native.insights.DataCollectionEndpoint("dataCollectionEndpoint", {
    resourceGroupName,
    dataCollectionEndpointName: "PulumiAuditLogsDCE",
    networkAcls: {
        publicNetworkAccess: azure_native.insights.KnownPublicNetworkAccessOptions.Enabled,
    },
});

// ---------------------------------------------------------------------------
// 3. Data Collection Rule (with corrected KQL transform)
// ---------------------------------------------------------------------------

// The KQL transform converts raw API responses into the typed table schema.
// Key fixes from the ARM version:
//   - Boolean fields (reqOrgAdmin, reqStackAdmin, authFailure) use Go omitzero,
//     so they are absent from JSON when false. coalesce(..., false) ensures we
//     get false instead of null.
//   - String fields (tokenID, tokenName) use Go omitempty, so they are absent
//     when empty. coalesce(..., "") ensures we get "" instead of null.
const transformKql = [
    "source",
    "| extend TimeGenerated = datetime(1970-01-01) + tolong(timestamp) * 1s",
    "| project",
    "    TimeGenerated,",
    "    Timestamp_d = tolong(timestamp),",
    "    SourceIP_s = tostring(sourceIP),",
    "    Event_s = tostring(event),",
    "    Description_s = tostring(description),",
    "    UserName_s = tostring(user.name),",
    "    UserLogin_s = tostring(user.githubLogin),",
    "    UserAvatarUrl_s = tostring(user.avatarUrl),",
    "    TokenID_s = coalesce(tokenID, \"\"),",
    "    TokenName_s = coalesce(tokenName, \"\"),",
    "    ActorName_s = tostring(actorName),",
    "    ActorUrn_s = tostring(actorUrn),",
    "    RequireOrgAdmin_b = tobool(coalesce(reqOrgAdmin, false)),",
    "    RequireStackAdmin_b = tobool(coalesce(reqStackAdmin, false)),",
    "    AuthFailure_b = tobool(coalesce(authFailure, false))",
].join(" ");

const dataCollectionRule = new azure_native.insights.DataCollectionRule("dataCollectionRule", {
    resourceGroupName,
    dataCollectionRuleName: "PulumiAuditLogsDCR",
    dataCollectionEndpointId: dataCollectionEndpoint.id,
    streamDeclarations: {
        [streamName]: {
            columns: [
                { name: "timestamp", type: "long" },
                { name: "sourceIP", type: "string" },
                { name: "event", type: "string" },
                { name: "description", type: "string" },
                { name: "user", type: "dynamic" },
                { name: "tokenID", type: "string" },
                { name: "tokenName", type: "string" },
                { name: "actorName", type: "string" },
                { name: "actorUrn", type: "string" },
                { name: "reqOrgAdmin", type: "boolean" },
                { name: "reqStackAdmin", type: "boolean" },
                { name: "authFailure", type: "boolean" },
            ],
        },
    },
    destinations: {
        logAnalytics: [{
            workspaceResourceId: workspace.id,
            name: "clv2ws1",
        }],
    },
    dataFlows: [{
        streams: [streamName],
        destinations: ["clv2ws1"],
        transformKql,
        outputStream: `${streamName}_CL`,
    }],
}, { dependsOn: [table] });

// ---------------------------------------------------------------------------
// 4. Connector UI definition
// ---------------------------------------------------------------------------

const connectorDefinition = new azure_native.securityinsights.CustomizableConnectorDefinition("connectorDefinition", {
    resourceGroupName,
    workspaceName,
    dataConnectorDefinitionName: connectorDefinitionName,
    kind: "Customizable",
    connectorUiConfig: {
        id: connectorDefinitionName,
        title: "Pulumi Cloud Audit Logs",
        publisher: "Pulumi",
        descriptionMarkdown: [
            "The Pulumi Cloud Audit Logs connector provides the capability to ingest",
            "[Pulumi Cloud audit log events](https://www.pulumi.com/docs/pulumi-cloud/audit-logs/)",
            "into Microsoft Sentinel. By connecting Pulumi Cloud audit logs to Microsoft Sentinel,",
            "you can monitor infrastructure-as-code operations, detect unauthorized access attempts,",
            "track organization membership changes, and investigate security incidents.",
            "\n\nThis connector polls the Pulumi Cloud REST API to retrieve audit log events for your organization.",
        ].join(" "),
        graphQueriesTableName: tableName,
        graphQueries: [{
            metricName: "Total events received",
            legend: "PulumiAuditLogEvents",
            baseQuery: "{{graphQueriesTableName}}",
        }],
        sampleQueries: [
            {
                description: "All Pulumi audit log events",
                query: "{{graphQueriesTableName}}\n| sort by TimeGenerated desc\n| take 10",
            },
            {
                description: "Authentication failures",
                query: "{{graphQueriesTableName}}\n| where AuthFailure_b == true\n| sort by TimeGenerated desc",
            },
            {
                description: "Stack deletions",
                query: '{{graphQueriesTableName}}\n| where Event_s == "stack-deleted"\n| sort by TimeGenerated desc',
            },
        ],
        dataTypes: [{
            name: "{{graphQueriesTableName}}",
            lastDataReceivedQuery: "{{graphQueriesTableName}}\n| summarize Time = max(TimeGenerated)\n| where isnotempty(Time)",
        }],
        connectivityCriteria: [{
            type: "HasDataConnectors",
        }],
        availability: {
            isPreview: true,
        },
        permissions: {
            resourceProvider: [{
                provider: "Microsoft.OperationalInsights/workspaces",
                permissionsDisplayText: "Read and Write permissions are required.",
                providerDisplayName: "Workspace",
                scope: "Workspace",
                requiredPermissions: {
                    write: true,
                    read: true,
                    delete: true,
                },
            }],
            customs: [{
                name: "Pulumi Cloud access token",
                description: [
                    "A Pulumi Cloud [personal access token](https://www.pulumi.com/docs/pulumi-cloud/access-management/access-tokens/)",
                    "with permissions to read audit logs is required.",
                    "The organization must have a Pulumi Enterprise or Business Critical subscription with audit logs enabled.",
                ].join(" "),
            }],
        },
        instructionSteps: [{
            title: "Connect Pulumi Cloud Audit Logs to Microsoft Sentinel",
            description: [
                "Provide your Pulumi Cloud organization name and access token to start ingesting audit log events.",
                "\n\n1. Create a [Pulumi access token](https://app.pulumi.com/account/tokens) with audit log read permissions.",
                "\n2. Enter your Pulumi organization name and access token below.",
                "\n3. Optionally customize the API URL if you use a self-hosted Pulumi Cloud instance.",
            ].join(""),
            instructions: [
                {
                    type: "DataConnectorsGrid",
                    parameters: {
                        mapping: [{
                            columnName: "Pulumi Organization",
                            columnValue: "properties.request.queryParameters.orgName",
                        }],
                        menuItems: ["DeleteConnector"],
                    },
                },
                {
                    type: "ContextPane",
                    parameters: {
                        isPrimary: true,
                        label: "Add Organization",
                        title: "Connect Pulumi Cloud Organization",
                        contextPaneType: "DataConnectorsContextPane",
                        instructionSteps: [{
                            instructions: [
                                {
                                    type: "Textbox",
                                    parameters: {
                                        label: "Pulumi Organization Name",
                                        placeholder: "my-org",
                                        type: "text",
                                        name: "OrgName",
                                    },
                                },
                                {
                                    type: "Textbox",
                                    parameters: {
                                        label: "Pulumi Access Token",
                                        placeholder: "pul-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
                                        type: "password",
                                        name: "apikey",
                                    },
                                },
                                {
                                    type: "Textbox",
                                    parameters: {
                                        label: "Pulumi API URL (optional)",
                                        placeholder: "https://api.pulumi.com",
                                        type: "text",
                                        name: "ApiUrl",
                                    },
                                },
                            ],
                        }],
                    },
                },
            ],
        }],
    },
});

// ---------------------------------------------------------------------------
// 5. RestApiPoller data connector
//
// Uses the v20250301 API version, which is the latest stable version that
// supports RestApiPollerDataConnector. The SDK's typed paging config does not
// include nextPageTokenJsonPath/nextPageParaName, but the ARM API accepts them.
// We cast the paging object to pass these through to the provider.
// ---------------------------------------------------------------------------

const dataConnector = new RestApiPollerDataConnector("dataConnector", {
    resourceGroupName,
    workspaceName,
    dataConnectorId: "PulumiAuditLogsPoller",
    kind: "RestApiPoller",
    connectorDefinitionName: connectorDefinitionName,
    dcrConfig: {
        dataCollectionEndpoint: dataCollectionEndpoint.logsIngestion.apply(li => li?.endpoint ?? ""),
        dataCollectionRuleImmutableId: dataCollectionRule.immutableId,
        streamName,
    },
    dataType: tableName,
    auth: {
        type: "APIKey",
        apiKeyName: "Authorization",
        apiKey: accessToken,
        apiKeyIdentifier: "token",
    },
    request: {
        apiEndpoint: pulumi.interpolate`${apiUrl}/api/orgs/${orgName}/auditlogs/v2`,
        httpMethod: "GET",
        queryTimeFormat: "UnixTimestamp",
        startTimeAttributeName: "startTime",
        endTimeAttributeName: "endTime",
        queryWindowInMin: 5,
        rateLimitQPS: 2,
        retryCount: 3,
        timeoutInSeconds: 60,
        headers: {
            "Accept": "application/json",
            "User-Agent": "Scuba",
        },
    },
    response: {
        eventsJsonPaths: ["$.auditLogEvents"],
        format: "json",
    },
    paging: {
        pagingType: "NextPageToken",
        nextPageTokenJsonPath: "$.continuationToken",
        nextPageParaName: "continuationToken",
    } as any,
    isActive: true,
}, { dependsOn: [connectorDefinition, dataCollectionRule] });

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export const dataCollectionEndpointUrl = dataCollectionEndpoint.logsIngestion.apply(li => li?.endpoint);
export const dataCollectionRuleId = dataCollectionRule.id;
export const tableId = table.id;
export const connectorDefinitionId = connectorDefinition.id;
export const dataConnectorId = dataConnector.id;
