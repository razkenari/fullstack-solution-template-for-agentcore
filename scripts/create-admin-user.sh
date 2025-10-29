#!/bin/bash

# Get stack name from argument or config file
if [ -n "$1" ]; then
  STACK_NAME="$1"
elif [ -f "infra-cdk/config.yaml" ]; then
  STACK_NAME=$(grep 'stack_name_base:' infra-cdk/config.yaml | awk '{print $2}' | tr -d '"')
else
  echo "Error: infra-cdk/config.yaml not found and no stack name provided"
  exit 1
fi

[ -z "$STACK_NAME" ] && { echo "Error: Could not determine stack name"; exit 1; }

USERNAME=${2:-admin}
ADMIN_EMAIL=${3:-""}

echo "Using stack: ${STACK_NAME}"

# Get User Pool ID from SSM
set +e
USER_POOL_ID=$(aws ssm get-parameter \
  --name "/${STACK_NAME}/cognito-user-pool-id" \
  --query 'Parameter.Value' \
  --output text 2>&1)
EXIT_CODE=$?
set -e

if [ $EXIT_CODE -ne 0 ]; then
  echo "Error: Failed to get User Pool ID"
  echo "$USER_POOL_ID"
  exit 1
fi

[ -z "$USER_POOL_ID" ] && { echo "Error: User Pool ID not found"; exit 1; }

echo "Found User Pool: $USER_POOL_ID"

# Validate and build user attributes
if [ -n "$ADMIN_EMAIL" ]; then
  # Validate email format
  if ! [[ "$ADMIN_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
    echo "Error: Invalid email format"
    exit 1
  fi
  USER_ATTRS="Name=email,Value=${ADMIN_EMAIL} Name=email_verified,Value=true"
else
  USER_ATTRS=""
fi

# Create user
echo "Creating user: $USERNAME"
if [ -n "$USER_ATTRS" ]; then
  aws cognito-idp admin-create-user \
    --user-pool-id "$USER_POOL_ID" \
    --username "$USERNAME" \
    --user-attributes "$USER_ATTRS" \
    --message-action SUPPRESS \
    --no-cli-pager > /dev/null 2>&1 || { echo "Error: Failed to create user"; exit 1; }
else
  aws cognito-idp admin-create-user \
    --user-pool-id "$USER_POOL_ID" \
    --username "$USERNAME" \
    --message-action SUPPRESS \
    --no-cli-pager > /dev/null 2>&1 || { echo "Error: Failed to create user"; exit 1; }
fi

# Set password
echo "Setting password..."
aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  --password Admin123! \
  --permanent \
  --no-cli-pager > /dev/null 2>&1 || { echo "Error: Failed to set password"; exit 1; }

echo "✓ User created: ${USERNAME} / Admin123!"
[ -n "$ADMIN_EMAIL" ] && echo "  Email: ${ADMIN_EMAIL}"
