import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event, context):
    """
    Sample tool Lambda function for GASP AgentCore Gateway.

    DESIGN PATTERN:
    This Lambda follows the "one tool per Lambda" design pattern, where each Lambda function
    implements exactly one tool. This provides:
    - Clear separation of concerns
    - Independent scaling per tool
    - Easier maintenance and debugging
    - Independent deployment cycles
    - Tool-specific IAM permissions

    ALTERNATIVE PATTERN:
    You could implement multiple tools in a single Lambda by checking the tool name
    and routing to different handlers. However, this is NOT recommended for production
    because it creates coupling and reduces the benefits of serverless architecture.

    INPUT FORMAT:
    - event: Contains tool arguments directly (not wrapped in HTTP body)
    - context.client_context.custom['bedrockAgentCoreToolName']: Full tool name with target prefix

    OUTPUT FORMAT:
    - Return object with 'content' array containing response data
    - No HTTP status codes or headers needed (gateway handles HTTP layer)

    TOOL NAME HANDLING:
    - Gateway sends tool name as "TargetName___ToolName" (e.g., "GASPAgent___sample_tool")
    - Lambda strips the target prefix to get the actual tool name
    - This allows multiple targets to have tools with the same name

    Args:
        event (dict): Tool arguments passed directly from gateway
        context: Lambda context with AgentCore metadata in client_context.custom

    Returns:
        dict: Response object with 'content' array or 'error' string
    """
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        # Get tool name from context and strip the target prefix
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[
            original_tool_name.index(delimiter) + len(delimiter) :
        ]

        logger.info(f"Processing tool: {tool_name}")

        # This Lambda implements exactly one tool: sample_tool
        if tool_name == "sample_tool":
            # Event contains the arguments directly (no parsing needed)
            name = event.get("name", "World")
            result = f"Hello, {name}! This is a sample tool from GASP."

            return {"content": [{"type": "text", "text": result}]}
        else:
            # This should never happen if gateway is configured correctly
            logger.error(f"Unexpected tool name: {tool_name}")
            return {
                "error": f"This Lambda only supports 'sample_tool', received: {tool_name}"
            }

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        return {"error": f"Internal server error: {str(e)}"}
