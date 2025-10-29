import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"
import { AppConfig } from "./utils/config-manager"

// Import nested stacks
import { BackendStack } from "./backend-stack"
import { FrontendStack } from "./frontend-stack"

export interface GaspCdkStackProps extends cdk.StackProps {
  config: AppConfig
}

export class GaspCdkStack extends cdk.Stack {
  public readonly backendStack: BackendStack
  public readonly frontendStack: FrontendStack

  constructor(scope: Construct, id: string, props: GaspCdkStackProps) {
    const description = "GenAIID AgentCore Starter Pack - Main Stack (uksb-v6dos0t5g8)"
    super(scope, id, { ...props, description })

    // Deploy backend stack first (creates Cognito + Runtime)
    this.backendStack = new BackendStack(this, `${id}-backend`, {
      config: props.config,
    })

    // Deploy frontend stack (reads Cognito + Runtime from SSM)
    this.frontendStack = new FrontendStack(this, `${id}-frontend`, {
      config: props.config,
    })

    // Add explicit dependency to ensure backend deploys before frontend
    this.frontendStack.addDependency(this.backendStack)

    // Output the CloudFront URL for easy access
    new cdk.CfnOutput(this, "FrontendUrl", {
      value: `https://${this.frontendStack.distribution.distributionDomainName}`,
      description: "Frontend Application URL",
    })
  }
}
