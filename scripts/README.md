# Deployment Scripts

This directory contains scripts for deploying the GenAI AgentCore Starter Pack infrastructure and frontend.

## Main Deployment Workflow

### 1. Deploy Infrastructure

```bash
cdk deploy
```

This deploys the CDK stack. Configuration generation is now handled during frontend deployment.

### 2. Deploy Frontend

```bash
./scripts/deploy-frontend.sh
```

This script automatically:

- Generates fresh `aws-exports.json` from CDK stack outputs
- Installs/updates npm dependencies if needed
- Builds the Next.js frontend
- Deploys to AWS Amplify

## Individual Scripts

### Infrastructure Deployment

- `deploy-cdk.sh` - Deploys CDK stack only (no longer runs post-deployment tasks)

### Configuration Generation

- `post-deploy.py` - Generates `aws-exports.json` from stack outputs (Python version)
- `post-deploy.js` - Generates `aws-exports.json` from stack outputs (JavaScript version, legacy)

### Frontend Deployment

- `deploy-frontend.sh` - Complete frontend deployment with automatic dependency management and config generation

## Standalone Configuration Generation

Generate the `aws-exports.json` file without deploying:

```bash
# Using Python (recommended)
python3 scripts/post-deploy.py your-stack-name

# Using Node.js (legacy)
node scripts/post-deploy.js your-stack-name
```

## Generated Configuration

The script creates `frontend/public/aws-exports.json` with the following structure:

```json
{
  "authority": "https://cognito-idp.region.amazonaws.com/user-pool-id",
  "client_id": "your-client-id",
  "redirect_uri": "https://your-amplify-url",
  "post_logout_redirect_uri": "https://your-amplify-url",
  "response_type": "code",
  "scope": "email openid profile",
  "automaticSilentRenew": true
}
```

## Requirements

- AWS CLI configured with appropriate permissions
- Python 3 (for post-deploy.py)
- Node.js and npm (for frontend build)
- CDK stack deployed with the required outputs:
  - `CognitoClientId`
  - `CognitoUserPoolId`
  - `AmplifyUrl`

## Key Features

- **Automatic Region Detection**: Extracts region directly from CloudFormation stack ARN
- **Smart Dependency Management**: Automatically installs npm dependencies when needed
- **No Custom Resources**: Avoids CDK custom resource deployment issues
- **Local Generation**: Fast and reliable configuration generation
- **Easy Debugging**: Clear error messages and logging
- **Fresh Config**: Always generates up-to-date configuration from current stack outputs

## New User Experience

For brand new installations, simply run:

```bash
cdk deploy
./scripts/deploy-frontend.sh
```

The frontend deployment script will automatically handle:

1. Installing npm dependencies (if node_modules doesn't exist)
2. Generating fresh aws-exports.json from your deployed stack
3. Building and deploying the frontend
