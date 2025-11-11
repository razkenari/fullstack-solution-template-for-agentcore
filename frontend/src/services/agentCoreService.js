/**
 * AgentCore Service - Streaming Response Handler
 *
 * Handles streaming responses from AgentCore agents using Server-Sent Events (SSE).
 *
 * CUSTOMIZATION FOR OTHER AGENT TYPES:
 * The parseStreamingChunk() function below is configured for Strands agents.
 * To support other agent types (LangGraph, custom), replace this function
 * with your agent's specific event parsing logic.
 */
const parseStreamingChunk = (line, currentCompletion, updateCallback) => {
  /**
   * Current Implementation:
   * - Handles raw Bedrock Converse streaming events nested in "event" key
   * - Extracts text chunks from contentBlockDelta events (accumulates)
   *
   * TO CUSTOMIZE:
   * Replace this function with your agent's parsing logic.
   * See STREAMING.md for alternative approaches.
   */

  // Skip empty lines
  if (!line || !line.trim()) {
    return currentCompletion;
  }

  // Strip "data: " prefix from SSE format
  if (!line.startsWith('data: ')) {
    return currentCompletion;
  }

  const data = line.substring(6).trim();

  // Skip empty data
  if (!data) {
    return currentCompletion;
  }

  // Parse JSON events
  try {
    const json = JSON.parse(data);

    // Handle message start - add newline for new assistant message
    // Example: {"event": {"messageStart": {"role": "assistant"}}}
    if (json.event?.messageStart?.role === 'assistant') {
      if (currentCompletion) {  // Only add newline if there's previous content
        const newCompletion = currentCompletion + '\n\n';
        updateCallback(newCompletion);
        return newCompletion;
      }
      return currentCompletion;
    }

    // Extract streaming text from contentBlockDelta event
    // Example: {"event": {"contentBlockDelta": {"delta": {"text": " there"}}}}
    if (json.event?.contentBlockDelta?.delta?.text) {
      const newCompletion = currentCompletion + json.event.contentBlockDelta.delta.text;
      updateCallback(newCompletion);
      return newCompletion;
    }

    // Other events (contentBlockStop, messageStop, metadata) are ignored
    // They're available for debugging or additional UI features if needed

    return currentCompletion;
  } catch (error) {
    // If JSON parsing fails, skip this line
    console.debug('Failed to parse streaming event:', data);
    return currentCompletion;
  }
};

// Generate a UUID-like string that meets AgentCore requirements (min 33 chars)
const generateId = () => {
  const timestamp = Date.now().toString(36)
  const random1 = Math.random().toString(36).substring(2)
  const random2 = Math.random().toString(36).substring(2)
  const random3 = Math.random().toString(36).substring(2)
  return `${timestamp}-${random1}-${random2}-${random3}`
}

// Configuration - will be populated from aws-exports.json
const AGENT_CONFIG = {
  AGENT_RUNTIME_ARN: "",
  AWS_REGION: "us-east-1",
}

// Set configuration from environment or aws-exports
export const setAgentConfig = (runtimeArn, region = "us-east-1") => {
  AGENT_CONFIG.AGENT_RUNTIME_ARN = runtimeArn
  AGENT_CONFIG.AWS_REGION = region
}

/**
 * Invokes the AgentCore runtime with streaming support
 */
export const invokeAgentCore = async (query, sessionId, onStreamUpdate, accessToken, userId) => {
  try {
    if (!userId) {
      throw new Error("No valid user ID found in session. Please ensure you are authenticated.")
    }

    if (!accessToken) {
      throw new Error("No valid access token found. Please ensure you are authenticated.")
    }

    if (!AGENT_CONFIG.AGENT_RUNTIME_ARN) {
      throw new Error("Agent Runtime ARN not configured")
    }

    // Bedrock Agent Core endpoint
    const endpoint = `https://bedrock-agentcore.${AGENT_CONFIG.AWS_REGION}.amazonaws.com`

    // URL encode the agent ARN
    const escapedAgentArn = encodeURIComponent(AGENT_CONFIG.AGENT_RUNTIME_ARN)

    // Construct the URL
    const url = `${endpoint}/runtimes/${escapedAgentArn}/invocations?qualifier=DEFAULT`

    // Generate trace ID
    const traceId = `1-${Math.floor(Date.now() / 1000).toString(16)}-${generateId()}`

    // Set up headers
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "X-Amzn-Trace-Id": traceId,
      "Content-Type": "application/json",
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId,
    }

    // Create the payload
    const payload = {
      prompt: query,
      runtimeSessionId: sessionId,
      userId: userId,
    }

    // Make HTTP request with streaming
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }

    let completion = '';
    let buffer = '';

    // Handle streaming response
    if (response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Process complete lines (SSE format uses newlines as delimiters)
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          // eslint-disable-next-line no-restricted-syntax
          for (const line of lines) {
            if (line.trim()) {
              // Parser handles all logic (accumulation vs replacement)
              completion = parseStreamingChunk(line, completion, onStreamUpdate);
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
    } else {
      // Fallback for non-streaming response
      completion = await response.text()
      onStreamUpdate(completion)
    }

    return completion
  } catch (error) {
    console.error("Error invoking AgentCore:", error)
    throw error
  }
}

/**
 * Generate a new session ID
 */
export const generateSessionId = () => {
  return generateId()
}
