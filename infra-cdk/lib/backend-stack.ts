import * as cdk from "aws-cdk-lib"
import * as cognito from "aws-cdk-lib/aws-cognito"
import * as iam from "aws-cdk-lib/aws-iam"
import * as ssm from "aws-cdk-lib/aws-ssm"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import * as apigateway from "aws-cdk-lib/aws-apigateway"
import * as logs from "aws-cdk-lib/aws-logs"
import * as agentcore from "@aws-cdk/aws-bedrock-agentcore-alpha"
import { PythonFunction } from "@aws-cdk/aws-lambda-python-alpha"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets"
import { Construct } from "constructs"
import { AppConfig } from "./utils/config-manager"
import { AgentCoreRole } from "./utils/agentcore-role"
import * as path from "path"

export interface BackendStackProps extends cdk.NestedStackProps {
  config: AppConfig
  userPoolId: string
  userPoolClientId: string
}

export class BackendStack extends cdk.NestedStack {
  public readonly userPoolId: string
  public readonly userPoolClientId: string
  public feedbackApiUrl: string
  public runtimeArn: string
  private agentName: cdk.CfnParameter
  private networkMode: cdk.CfnParameter

  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props)

    // Store the Cognito values
    this.userPoolId = props.userPoolId
    this.userPoolClientId = props.userPoolClientId

    // Create AgentCore Runtime resources
    this.createAgentCoreRuntime(props.config)

    // Store runtime ARN in SSM for frontend stack
    this.createRuntimeSSMParameters(props.config)

    // Create Feedback DynamoDB table (example of application data storage)
    const feedbackTable = this.createFeedbackTable(props.config)

    // Create Feedback API resources (example of best-practice API Gateway + Lambda pattern)
    this.createFeedbackApi(props.config, feedbackTable)
  }

  private createAgentCoreRuntime(config: AppConfig): void {
    const pattern = config.backend?.pattern || "strands-single-agent"

    // Parameters
    this.agentName = new cdk.CfnParameter(this, "AgentName", {
      type: "String",
      default: "StrandsAgent",
      description: "Name for the agent runtime",
    })

    this.networkMode = new cdk.CfnParameter(this, "NetworkMode", {
      type: "String",
      default: "PUBLIC",
      description: "Network mode for AgentCore resources",
      allowedValues: ["PUBLIC", "PRIVATE"],
    })

    const stack = cdk.Stack.of(this)

    // Create the agent runtime artifact from local Docker context with ARM64 platform
    const agentRuntimeArtifact = agentcore.AgentRuntimeArtifact.fromAsset(
      path.resolve(__dirname, "..", "..", "patterns", pattern),
      {
        platform: ecr_assets.Platform.LINUX_ARM64,
      }
    )

    // Configure network mode
    const networkConfiguration =
      this.networkMode.valueAsString === "PRIVATE"
        ? undefined // For private mode, you would need to configure VPC settings
        : agentcore.RuntimeNetworkConfiguration.usingPublicNetwork()

    // Configure JWT authorizer with Cognito
    const authorizerConfiguration = agentcore.RuntimeAuthorizerConfiguration.usingJWT(
      `https://cognito-idp.${stack.region}.amazonaws.com/${this.userPoolId}/.well-known/openid-configuration`,
      [this.userPoolClientId]
    )

    // Create AgentCore execution role
    const agentRole = new AgentCoreRole(this, "AgentCoreRole")

    // Create memory resource with short-term memory (conversation history) as default
    // To enable long-term strategies (summaries, preferences, facts), see docs/MEMORY_INTEGRATION.md
    const memory = new cdk.CfnResource(this, "AgentMemory", {
      type: "AWS::BedrockAgentCore::Memory",
      properties: {
        Name: cdk.Names.uniqueResourceName(this, { maxLength: 48 }),
        EventExpiryDuration: 30,
        Description: `Short-term memory for ${config.stack_name_base} agent`,
        MemoryStrategies: [], // Empty array = short-term only (conversation history)
        MemoryExecutionRoleArn: agentRole.roleArn,
        Tags: {
          Name: `${config.stack_name_base}_Memory`,
          ManagedBy: "CDK",
        },
      },
    })
    const memoryId = memory.getAtt("MemoryId").toString()
    const memoryArn = memory.getAtt("MemoryArn").toString()

    // Add memory-specific permissions to agent role
    agentRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "MemoryResourceAccess",
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock-agentcore:CreateEvent",
          "bedrock-agentcore:GetEvent",
          "bedrock-agentcore:ListEvents",
          "bedrock-agentcore:RetrieveMemoryRecords", // Only needed for long-term strategies
        ],
        resources: [memoryArn],
      })
    )

    // Environment variables for the runtime
    const envVars: { [key: string]: string } = {
      AWS_REGION: stack.region,
      AWS_DEFAULT_REGION: stack.region,
      MEMORY_ID: memoryId,
    }

    // Create the runtime using L2 construct
    const runtime = new agentcore.Runtime(this, "Runtime", {
      runtimeName: `${config.stack_name_base.replace(/-/g, "_")}_${this.agentName.valueAsString}`,
      agentRuntimeArtifact: agentRuntimeArtifact,
      executionRole: agentRole,
      networkConfiguration: networkConfiguration,
      protocolConfiguration: agentcore.ProtocolType.HTTP,
      environmentVariables: envVars,
      authorizerConfiguration: authorizerConfiguration,
      description: `${pattern} agent runtime for ${config.stack_name_base}`,
    })

    // Store the runtime ARN
    this.runtimeArn = runtime.agentRuntimeArn

    // Outputs
    new cdk.CfnOutput(this, "AgentRuntimeId", {
      description: "ID of the created agent runtime",
      value: runtime.agentRuntimeId,
    })

    new cdk.CfnOutput(this, "AgentRuntimeArn", {
      description: "ARN of the created agent runtime",
      value: runtime.agentRuntimeArn,
      exportName: `${config.stack_name_base}-AgentRuntimeArn`,
    })

    new cdk.CfnOutput(this, "AgentRoleArn", {
      description: "ARN of the agent execution role",
      value: agentRole.roleArn,
    })

    // Memory ARN output
    new cdk.CfnOutput(this, "MemoryArn", {
      description: "ARN of the agent memory resource",
      value: memoryArn,
    })
  }

  private createRuntimeSSMParameters(config: AppConfig): void {
    // Store runtime ARN in SSM for frontend stack
    new ssm.StringParameter(this, "RuntimeArnParam", {
      parameterName: `/${config.stack_name_base}/runtime-arn`,
      stringValue: this.runtimeArn,
    })
  }

  // Creates a DynamoDB table for storing user feedback.
  private createFeedbackTable(config: AppConfig): dynamodb.Table {
    const feedbackTable = new dynamodb.Table(this, "FeedbackTable", {
      tableName: `${config.stack_name_base}-feedback`,
      partitionKey: {
        name: "feedbackId",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    // Add GSI for querying by feedbackType with timestamp sorting
    feedbackTable.addGlobalSecondaryIndex({
      indexName: "feedbackType-timestamp-index",
      partitionKey: {
        name: "feedbackType",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "timestamp",
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    })

    return feedbackTable
  }

  /**
   * Creates an API Gateway with Lambda integration for the feedback endpoint.
   * This is an EXAMPLE implementation demonstrating best practices for API Gateway + Lambda.
   *
   * API Contract - POST /feedback
   * Authorization: Bearer <cognito-access-token> (required)
   *
   * Request Body:
   *   sessionId: string (required, max 100 chars, alphanumeric with -_) - Conversation session ID
   *   message: string (required, max 5000 chars) - Agent's response being rated
   *   feedbackType: "positive" | "negative" (required) - User's rating
   *   comment: string (optional, max 5000 chars) - User's explanation for rating
   *
   * Success Response (200):
   *   { success: true, feedbackId: string }
   *
   * Error Responses:
   *   400: { error: string } - Validation failure (missing fields, invalid format)
   *   401: { error: "Unauthorized" } - Invalid/missing JWT token
   *   500: { error: "Internal server error" } - DynamoDB or processing error
   *
   * Implementation: infra-cdk/lambdas/feedback/index.py
   */

  private createFeedbackApi(config: AppConfig, feedbackTable: dynamodb.Table): void {
    // Create Lambda function for feedback using Python
    const feedbackLambda = new PythonFunction(this, "FeedbackLambda", {
      functionName: `${config.stack_name_base}-feedback`,
      runtime: lambda.Runtime.PYTHON_3_13,
      entry: path.join(__dirname, "..", "lambdas", "feedback"),
      handler: "handler",
      environment: {
        TABLE_NAME: feedbackTable.tableName,
        ALLOWED_ORIGINS: "*", // Wildcard CORS - see API Gateway comment below for security rationale
      },
      timeout: cdk.Duration.seconds(30),
      logGroup: new logs.LogGroup(this, "FeedbackLambdaLogGroup", {
        logGroupName: `/aws/lambda/${config.stack_name_base}-feedback`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    // Grant Lambda permissions to write to DynamoDB
    feedbackTable.grantWriteData(feedbackLambda)

    /*
     * CORS TODO: Wildcard (*) used because Backend deploys before Frontend in nested stack order.
     * For Lambda proxy integrations, the Lambda's ALLOWED_ORIGINS env var is the primary CORS control.
     * API Gateway defaultCorsPreflightOptions below only handles OPTIONS preflight requests.
     * See detailed explanation and fix options in: infra-cdk/lambdas/feedback/index.py
     */
    const api = new apigateway.RestApi(this, "FeedbackApi", {
      restApiName: `${config.stack_name_base}-api`,
      description: "API for user feedback and future endpoints",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ["POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
      },
      deployOptions: {
        stageName: "prod",
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    })

    // Import the existing user pool for use in the CognitoUserPoolsAuthorizer constructor
    const userPool = cognito.UserPool.fromUserPoolId(this, "ImportedUserPool", this.userPoolId)

    // Create Cognito authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "FeedbackApiAuthorizer", {
      cognitoUserPools: [userPool],
      identitySource: "method.request.header.Authorization",
      authorizerName: `${config.stack_name_base}-authorizer`,
    })

    // Create /feedback resource and POST method
    const feedbackResource = api.root.addResource("feedback")
    feedbackResource.addMethod("POST", new apigateway.LambdaIntegration(feedbackLambda), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    })

    // Store the API URL for access from main stack
    this.feedbackApiUrl = api.url

    // Store API URL in SSM for frontend
    new ssm.StringParameter(this, "FeedbackApiUrlParam", {
      parameterName: `/${config.stack_name_base}/feedback-api-url`,
      stringValue: api.url,
      description: "Feedback API Gateway URL",
    })

    // Output - only the API URL needed for frontend
    new cdk.CfnOutput(this, "FeedbackApiUrl", {
      description: "Feedback API URL",
      value: api.url,
    })
  }
}
