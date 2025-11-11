from strands import Agent
from strands.tools.mcp import MCPClient
from mcp.client.streamable_http import streamablehttp_client
import os
import boto3
from bedrock_agentcore.runtime import BedrockAgentCoreApp
import traceback

from gateway.utils.gateway_access_token import get_gateway_access_token

app = BedrockAgentCoreApp()

def get_ssm_parameter(parameter_name: str) -> str:
    """
    Fetch parameter from SSM Parameter Store.
    
    SSM Parameter Store is AWS's service for storing configuration values securely.
    This function retrieves values like Gateway URLs that are set during deployment.
    """
    region = os.environ.get('AWS_REGION', os.environ.get('AWS_DEFAULT_REGION', 'us-east-1'))
    ssm = boto3.client('ssm', region_name=region)
    response = ssm.get_parameter(Name=parameter_name)
    return response['Parameter']['Value']

async def create_gateway_mcp_client(access_token: str) -> MCPClient:
    """
    Create MCP client for AgentCore Gateway with OAuth2 authentication.
    
    MCP (Model Context Protocol) is how agents communicate with tool providers.
    This creates a client that can talk to the AgentCore Gateway using the provided
    access token for authentication. The Gateway then provides access to Lambda-based tools.
    """
    stack_name = os.environ.get('STACK_NAME', 'gasp-2-1')
    
    print(f"[AGENT] Creating Gateway MCP client for stack: {stack_name}")
    
    # Fetch Gateway URL from SSM
    gateway_url = get_ssm_parameter(f'/{stack_name}/gateway_url')
    print(f"[AGENT] Gateway URL from SSM: {gateway_url}")
    
    # Create MCP client with Bearer token authentication
    gateway_client = MCPClient(
        lambda: streamablehttp_client(
            url=gateway_url,
            headers={"Authorization": f"Bearer {access_token}"}
        ),
        prefix="gateway"
    )
    
    print(f"[AGENT] Gateway MCP client created successfully")
    return gateway_client

async def create_basic_agent() -> Agent:
    """
    Create a basic agent with Gateway MCP tools.
    
    This function sets up an agent that can access tools through the AgentCore Gateway.
    It handles authentication, creates the MCP client connection, and configures the agent
    with access to all tools available through the Gateway. If Gateway connection fails,
    it falls back to an agent without tools.
    """
    system_prompt = """You are a helpful assistant with access to tools via the Gateway.
    When asked about your tools, list them and explain what they do."""

    try:
        print("[AGENT] Starting agent creation with Gateway tools...")
        
        # Get OAuth2 access token for Gateway
        print("[AGENT] Step 1: Getting OAuth2 access token...")
        access_token = await get_gateway_access_token()
        print(f"[AGENT] Got access token: {access_token[:20]}...")
        
        # Create Gateway MCP client with authentication
        print("[AGENT] Step 2: Creating Gateway MCP client...")
        gateway_client = await create_gateway_mcp_client(access_token)
        print("[AGENT] Gateway MCP client created successfully")
        
        print("[AGENT] Step 3: Creating Agent with Gateway tools...")
        agent = Agent(
            system_prompt=system_prompt,
            name="BasicAgent",
            tools=[gateway_client]
        )
        print("[AGENT] Agent created successfully with Gateway tools")
        return agent
        
    except Exception as e:
        print(f"[AGENT ERROR] Error creating Gateway client: {e}")
        print(f"[AGENT ERROR] Exception type: {type(e).__name__}")
        print(f"[AGENT ERROR] Traceback:")
        traceback.print_exc()
        print("[AGENT] Falling back to agent without Gateway tools")
        
        return Agent(
            system_prompt="You are a helpful assistant. Note: Gateway tools are not available.",
            name="BasicAgent"
        )

@app.entrypoint
async def invoke(payload=None):
    """
    Main entrypoint for the agent.
    
    This is the function that AgentCore Runtime calls when the agent receives a request.
    It extracts the user's query from the payload, creates an agent with Gateway tools,
    and returns the agent's response. This function handles the complete request lifecycle.
    """
    try:
        print(f"[INVOKE] Starting invocation with payload: {payload}")
        
        # Get the query from payload
        query = payload.get("prompt", "Hello, how are you?") if payload else "Hello, how are you?"
        print(f"[INVOKE] Query: {query}")

        # Create and use the agent
        print("[INVOKE] Creating agent...")
        agent = await create_basic_agent()
        
        print(f"[INVOKE] Agent created, invoking with query...")
        response = agent(query)

        print(f"[INVOKE] Got response, returning...")
        return {
            "status": "success",
            "response": response.message['content'][0]['text']
        }

    except Exception as e:
        print(f"[INVOKE ERROR] Error in invoke: {e}")
        traceback.print_exc()
        return {
            "status": "error",
            "error": str(e)
        }

if __name__ == "__main__":
    app.run()
