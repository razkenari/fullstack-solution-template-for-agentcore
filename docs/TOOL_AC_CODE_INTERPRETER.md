# AgentCore Code Interpreter Integration

This document explores different approaches for integrating Amazon Bedrock AgentCore Code Interpreter into the GASP project.

## What is AgentCore Code Interpreter?

The Amazon Bedrock AgentCore Code Interpreter is a fully managed capability that enables AI agents to write, execute, and debug code securely in isolated sandbox environments. It provides:

- **Secure code execution** in containerized environments
- **Multiple language support** (Python, JavaScript, TypeScript)
- **Pre-built runtimes** with common libraries pre-installed
- **Large file support** (up to 100 MB inline, 5 GB via S3)
- **Session management** with state persistence across executions
- **Long execution duration** (default 15 minutes, up to 8 hours)
- **Network modes** (Sandbox or Public internet access)

## Research Sources

### AWS Official Documentation
1. **Code Interpreter Overview**
   - URL: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-tool.html
   - Key learnings: Architecture, capabilities, best practices

2. **Creating Code Interpreter**
   - URL: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-create.html
   - Key learnings: Console, CLI, SDK creation methods

3. **Building Agents with Code Interpreter**
   - URL: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-building-agents.html
   - Key learnings: Strands and LangChain integration patterns

4. **Using Code Interpreter Directly**
   - URL: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-using-directly.html
   - Key learnings: SDK client usage, boto3 integration

5. **Built-in Tools Overview**
   - URL: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/built-in-tools.html
   - Key learnings: Code Interpreter as built-in tool vs custom tools

### AWS Blog Posts
1. **Introducing AgentCore Code Interpreter**
   - URL: https://aws.amazon.com/blogs/machine-learning/introducing-the-amazon-bedrock-agentcore-code-interpreter/
   - Key learnings: Security architecture, use cases, pricing model

### Reference Implementations
1. **AWS IDP Solution**
   - URL: https://github.com/aws-solutions-library-samples/accelerated-intelligent-document-processing-on-aws/blob/main/lib/idp_common_pkg/idp_common/agents/analytics/tools/code_interpreter_tools.py
   - Key learnings: Production-ready implementation pattern with session management

## Integration Approaches

### Approach 1: Direct Integration (Built-in Tool)

#### Architecture
```
Agent → Code Interpreter SDK → Code Interpreter Service
```

#### Implementation Pattern
Code Interpreter is added directly to the agent as a Strands tool using the `bedrock_agentcore.tools.code_interpreter_client` SDK.

```python
from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter
from strands import tool

class CodeInterpreterTools:
    def __init__(self, region: str):
        self._code_client = CodeInterpreter(region)
        self._code_client.start()
    
    @tool
    def execute_python(self, code: str) -> str:
        """Execute Python code in sandbox."""
        response = self._code_client.invoke("executeCode", {
            "code": code,
            "language": "python"
        })
        return response
```

#### Pros
- **Simpler implementation** - Minimal code, no additional infrastructure
- **No Lambda overhead** - Direct SDK calls to Code Interpreter
- **Lower latency** - No Gateway/Lambda hops in request path
- **Lower cost** - No Lambda invocations, only Code Interpreter usage
- **Session management** - Code Interpreter maintains state across calls
- **Follows AWS examples** - Matches official documentation patterns
- **Better error handling** - Direct access to Code Interpreter errors
- **Streaming support** - Can stream execution results directly

#### Cons
- **Not discoverable** - Tool is hardcoded in agent, not listed in Gateway
- **Requires agent redeployment** - Can't update tool logic independently
- **Breaks Gateway pattern** - Inconsistent with existing GASP tools (sample_tool)
- **No centralized management** - Can't view/manage in Gateway console
- **Tight coupling** - Tool logic lives in agent code
- **No reusability** - Can't share with other agents without code duplication
- **Limited observability** - Tool usage not tracked through Gateway metrics

#### When to Use
- Code Interpreter is a core agent capability (always needed)
- Performance and cost optimization are priorities
- You're okay with agent redeployment for tool updates
- Single agent use case (no tool sharing needed)
- You want to follow AWS reference patterns exactly

---

### Approach 2: Gateway Integration (Lambda Wrapper)

#### Architecture
```
Agent → Gateway → Lambda → Code Interpreter SDK → Code Interpreter Service
```

#### Implementation Pattern
Create a Lambda function that wraps Code Interpreter calls and expose it as a Gateway target.

```python
# Lambda handler
from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter

def handler(event, context):
    # Get tool name from context
    tool_name = context.client_context.custom['bedrockAgentCoreToolName']
    
    # Initialize Code Interpreter
    code_client = CodeInterpreter(region)
    code_client.start()
    
    # Execute code
    code = event.get('code')
    response = code_client.invoke("executeCode", {
        "code": code,
        "language": "python"
    })
    
    code_client.stop()
    
    return {
        'content': [{
            'type': 'text',
            'text': json.dumps(response)
        }]
    }
```

#### Pros
- **Consistent architecture** - All tools accessible through Gateway
- **Discoverable** - Agent finds tool dynamically via Gateway MCP
- **Independent deployment** - Update tool without touching agent code
- **Centralized management** - Visible and manageable in Gateway console
- **Reusable** - Other agents/services can use same Gateway tool
- **Follows GASP pattern** - Matches existing `sample_tool` design
- **Better observability** - Tool usage tracked through Gateway metrics
- **IAM isolation** - Lambda can have specific permissions for Code Interpreter
- **Version control** - Can deploy multiple versions of tool independently

#### Cons
- **More complex** - Lambda wrapper + Gateway target + IAM roles + CDK config
- **Higher latency** - Additional hops: Agent → Gateway → Lambda → Code Interpreter
- **Higher cost** - Lambda invocations + Code Interpreter usage
- **Session complexity** - Lambda must manage Code Interpreter sessions (cold starts)
- **More infrastructure** - Additional Lambda function, IAM policies, Gateway configuration
- **Timeout concerns** - Lambda 15-min limit vs Code Interpreter 8-hour support
- **State management** - Harder to maintain session state across Lambda invocations
- **Debugging complexity** - More layers to troubleshoot

#### When to Use
- Consistency with existing architecture is critical
- You want all tools discoverable through Gateway
- You need to share Code Interpreter across multiple agents
- You want independent tool lifecycle management
- Gateway metrics and observability are important
- You plan to have many tools and want centralized management

---

## Comparison Matrix

| Aspect | Approach 1: Direct | Approach 2: Gateway |
|--------|-------------------|---------------------|
| **Complexity** | Low | High |
| **Latency** | ~100ms | ~300-500ms |
| **Cost** | Code Interpreter only | Lambda + Code Interpreter |
| **Discoverability** | No | Yes |
| **Reusability** | No | Yes |
| **Deployment** | Agent redeploy | Independent |
| **Observability** | Agent logs only | Gateway + Lambda + Agent |
| **Session Management** | Simple | Complex |
| **Consistency** | Breaks pattern | Follows pattern |
| **AWS Pattern** | ✅ Matches docs | Custom |

## Reference Availability

### Approach 1: Direct Integration ✅
**Has AWS References:**
- ✅ AWS official documentation with complete examples
- ✅ Production reference implementation (AWS IDP solution)
- ✅ Multiple code samples in AWS docs
- ✅ Proven pattern used in AWS solutions

**What You Get:**
- Step-by-step implementation guides
- Working code examples to copy
- Best practices from AWS
- Troubleshooting guidance

### Approach 2: Gateway Integration ❌
**No AWS References Found:**
- ❌ No AWS examples of Code Interpreter as Gateway target
- ❌ No documentation for this pattern
- ❌ Gateway docs only show Lambda targets for custom tools
- ❌ Code Interpreter always shown as direct agent tool

**Why No References:**
Code Interpreter is a **built-in AgentCore service**, not a custom tool. AWS designed it for direct integration, similar to:
- Bedrock models (direct API calls)
- AgentCore Memory (direct integration)
- Not meant to be proxied through Gateway

**If You Choose Approach 2:**
You would be **pioneering a new pattern** and need to solve:
1. **Session management** - How Lambda maintains Code Interpreter sessions across invocations
2. **Cold starts** - Code Interpreter client initialization on each Lambda cold start
3. **Timeout handling** - Lambda 15-min limit vs Code Interpreter 8-hour support
4. **API design** - What parameters Lambda accepts, how it returns results
5. **Edge cases** - Session cleanup, error handling, concurrent executions

## Recommendation

### Start with Approach 1 (Direct Integration)

**Rationale:**
1. **Follows AWS best practices** - All official examples use direct integration
2. **Simpler to implement** - Get Code Interpreter working quickly
3. **Better performance** - Lower latency and cost
4. **Proven pattern** - Used in production AWS solutions
5. **Has references** - AWS documentation and examples to follow
6. **Aligns with "easy to use" goal** - Matches what developers expect from AWS docs

**For GASP's "Easy to Use" Goal:**
Direct integration is simpler because:
- Matches AWS documentation (no confusion)
- Less cognitive load (one concept vs two)
- Fewer moving parts (no Lambda/Gateway complexity)
- Faster time to value (add tool in minutes)
- Better developer experience (clear, simple code)

**Migration Path:**
If you later need Gateway consistency, you can:
1. Keep Approach 1 working
2. Implement Approach 2 in parallel
3. Test both approaches
4. Switch agents to Gateway version when ready
5. Deprecate direct integration

### Consider Approach 2 If:
- You have multiple agents that need Code Interpreter
- Gateway consistency is a hard requirement
- You need centralized tool management
- You want to version/update tools independently
- **You're willing to pioneer a new pattern without AWS references**

## Implementation Details (GASP)

### What We Implemented

GASP uses **Approach 1: Direct Integration** for AgentCore Code Interpreter with a **reusable architecture** that allows the tool to be shared across different agent patterns (Strands, LangGraph, etc.).

### Architecture Overview

The Code Interpreter implementation follows a **layered architecture**:

```
tools/code_interpreter/
└── code_interpreter_tools.py          # Core logic (framework-agnostic)

patterns/strands-single-agent/
├── strands_code_interpreter.py        # Strands wrapper (uses @tool decorator)
└── basic_agent.py                     # Agent implementation

patterns/langgraph-single-agent/
└── tools/
    └── langgraph_execute_python.py    # LangGraph wrapper (uses @tool decorator)
```

**Key Design Principles**:
1. **Core logic is framework-agnostic** - Lives in `tools/code_interpreter/`
2. **Pattern-specific wrappers** - Each agent pattern has its own wrapper
3. **Reusability** - Core tool can be used by any pattern
4. **Maintainability** - Bug fixes in core benefit all patterns

### Code Structure

#### 1. Core Tool: `tools/code_interpreter/code_interpreter_tools.py`

**Purpose**: Framework-agnostic Code Interpreter functionality

**Key Components**:
```python
from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter

class CodeInterpreterTools:
    """Core Code Interpreter tools (framework-agnostic)."""
    
    def __init__(self, region: str):
        self.region = region
        self._code_client = None
    
    def _get_code_interpreter_client(self):
        """Lazy initialization of Code Interpreter client."""
        if self._code_client is None:
            self._code_client = CodeInterpreter(self.region)
            self._code_client.start()
        return self._code_client
    
    def execute_python(self, code: str, description: str = "") -> str:
        """Execute Python code in secure sandbox."""
        if description:
            code = f"# {description}\n{code}"
        
        client = self._get_code_interpreter_client()
        response = client.invoke("executeCode", {
            "code": code,
            "language": "python",
            "clearContext": False
        })
        
        results = []
        for event in response["stream"]:
            if "result" in event:
                results.append(event["result"])
        
        return json.dumps(results, indent=2)
    
    def cleanup(self):
        """Clean up Code Interpreter session."""
        if self._code_client:
            self._code_client.stop()
            self._code_client = None
```

**Design Decisions**:
- **No framework dependencies** - Pure Python, no Strands/LangGraph imports
- **Lazy initialization** - Client created only when first tool is called
- **Session persistence** - `clearContext=False` maintains state across calls
- **Cleanup support** - `cleanup()` method for proper session termination

#### 2. Strands Wrapper: `patterns/strands-single-agent/strands_code_interpreter.py`

**Purpose**: Strands-specific wrapper that adds `@tool` decorator

```python
from strands import tool
from tools.code_interpreter.code_interpreter_tools import CodeInterpreterTools

class StrandsCodeInterpreterTools:
    """Strands wrapper for Code Interpreter tools."""
    
    def __init__(self, region: str):
        self.core_tools = CodeInterpreterTools(region)
    
    def cleanup(self):
        self.core_tools.cleanup()
    
    @tool
    def execute_python(self, code: str, description: str = "") -> str:
        """Execute Python code in secure sandbox."""
        return self.core_tools.execute_python(code, description)
```

**Why a Wrapper?**
- Strands requires `@tool` decorator for tool discovery
- Keeps framework-specific code separate from core logic
- Allows core tool to be used by other frameworks

#### 3. LangGraph Wrapper: `patterns/langgraph-single-agent/tools/langgraph_execute_python.py`

**Purpose**: LangGraph-specific wrapper (ready for future use)

```python
from langchain_core.tools import tool
from tools.code_interpreter.code_interpreter_tools import CodeInterpreterTools

class LangGraphCodeInterpreterTools:
    """LangGraph wrapper for Code Interpreter tools."""
    
    def __init__(self, region: str):
        self.core_tools = CodeInterpreterTools(region)
    
    def cleanup(self):
        self.core_tools.cleanup()
    
    @tool
    def execute_python(self, code: str, description: str = "") -> str:
        """Execute Python code in secure sandbox."""
        return self.core_tools.execute_python(code, description)
```

**Note**: This wrapper is ready for when LangGraph pattern is implemented.

#### 4. Agent Integration: `patterns/strands-single-agent/basic_agent.py`

**Changes Made**:

**a) Added Import**:
```python
from strands_code_interpreter import StrandsCodeInterpreterTools
```

**b) Initialize Code Interpreter in `create_basic_agent()`**:
```python
# Initialize Code Interpreter tools
region = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
code_tools = StrandsCodeInterpreterTools(region)
```

**c) Register Tool with Agent**:
```python
agent = Agent(
    name="BasicAgent",
    system_prompt=system_prompt,
    tools=[gateway_client, code_tools.execute_python],  # Added execute_python
    model=bedrock_model,
    session_manager=session_manager,
    trace_attributes={
        "user.id": user_id,
        "session.id": session_id,
    }
)
```

**d) Updated System Prompt**:
```python
system_prompt = """You are a helpful assistant with access to tools via the Gateway and Code Interpreter.
When asked about your tools, list them and explain what they do."""
```

### Dockerfile Changes

The Dockerfile was updated to copy the new directory structure:

```dockerfile
# Copy pyproject.toml and packages for GASP installation
COPY pyproject.toml .
COPY gateway/ gateway/
COPY tools/ tools/                    # Added: Core tools directory

# ... (install dependencies) ...

# Copy agent code files
COPY patterns/strands-single-agent/basic_agent.py .
COPY patterns/strands-single-agent/strands_code_interpreter.py .

# Start agent
CMD ["opentelemetry-instrument", "python", "-m", "basic_agent"]
```

**Key Changes**:
1. Added `COPY tools/ tools/` to include core Code Interpreter logic
2. Copy wrapper file `strands_code_interpreter.py` to `/app/` root
3. Agent imports work because working directory is `/app/`

### Benefits of This Architecture

1. **Reusability**: Core logic in `tools/code_interpreter/` can be used by:
   - Strands agents
   - LangGraph agents
   - Future agent patterns
   - Direct Python scripts

2. **Maintainability**: 
   - Bug fixes in core benefit all patterns
   - Framework-specific changes isolated to wrappers
   - Clear separation of concerns

3. **Testability**:
   - Core logic can be unit tested independently
   - Wrappers can be tested separately
   - Integration tests verify end-to-end flow

4. **Extensibility**:
   - Easy to add new agent patterns
   - Just create a new wrapper for the framework
   - Core logic remains unchanged

### Tool Registration

**What is Tool Registration?**

Tool registration means adding a tool to the agent's `tools=[]` list, making it available for the agent to use.

**Before**:
```python
tools=[gateway_client]  # Only Gateway tools
```

**After**:
```python
tools=[gateway_client, code_tools.execute_python]  # Gateway + Code Interpreter
```

**How to Verify Registration**:
```bash
cd patterns/strands-single-agent
grep "tools=" basic_agent.py
```

Expected output:
```python
tools=[gateway_client, code_tools.execute_python],
```

### Agent Tool Architecture

```
Agent
├── Gateway Tools (via MCP)
│   └── text_analysis_tool (Lambda-based)
└── Code Interpreter (Direct)
    └── execute_python (Built-in AgentCore service)
        ├── Core Logic (tools/code_interpreter/)
        └── Strands Wrapper (patterns/strands-single-agent/)
```

### How It Works at Runtime

1. **Agent receives query**: "Calculate factorial of 10"
2. **Agent analyzes query**: Determines it needs code execution
3. **Agent calls tool**: `execute_python(code="import math\nprint(math.factorial(10))")`
4. **Code Interpreter executes**: Runs code in secure sandbox
5. **Result returned**: Agent receives output and responds to user

### Testing the Integration

#### Verify Tool is Registered (Local)
```bash
cd patterns/strands-single-agent
grep -A 10 "tools=" basic_agent.py | grep execute_python
```

#### Test Tool Functionality (Requires Deployment)
1. Deploy stack: `cd infra-cdk && cdk deploy`
2. Access frontend
3. Ask agent:
   - "What tools do you have?"
   - "Calculate 5 factorial using Python"
   - "Write code to find prime numbers up to 50"

Expected: Agent lists `execute_python` and successfully executes code.

### Dependencies

**Already in `requirements.txt`**:
```
bedrock-agentcore[strands-agents]
```

This includes the Code Interpreter client SDK.

### Session Management

**Automatic Session Creation**:
- Session starts on first `execute_python` call
- Session persists across multiple tool calls
- State maintained with `clearContext=False`

**Manual Cleanup** (Optional):
```python
code_tools.cleanup()  # Stops session and releases resources
```

**Note**: AgentCore automatically cleans up sessions after timeout, so manual cleanup is optional.

### Error Handling

Code Interpreter errors are returned in the response:
```json
{
  "isError": true,
  "content": [{
    "type": "text",
    "text": "Error message here"
  }]
}
```

Agent receives error and can inform user or retry.

### Limitations

1. **Requires AWS deployment** - Cannot test locally (needs AgentCore service)
2. **Execution timeout** - Default 15 minutes (configurable up to 8 hours)
3. **Network mode** - Determined by Code Interpreter resource configuration
4. **Language support** - Currently Python only in this implementation

### Future Enhancements

Potential improvements:
- Add `write_files` tool for file operations
- Add `list_files` tool to see sandbox contents
- Support JavaScript/TypeScript execution
- Add file upload from S3
- Implement custom timeout configuration

## Implementation Checklist

### For Approach 1 (Direct Integration)
- [ ] Add `bedrock-agentcore` to `requirements.txt`
- [ ] Create `code_interpreter_tools.py` in patterns folder
- [ ] Update `basic_agent.py` to import and use tools
- [ ] Create IAM role for Code Interpreter execution
- [ ] Update CDK to create Code Interpreter resource
- [ ] Store Code Interpreter ID in SSM
- [ ] Test code execution in agent
- [ ] Add cleanup logic for sessions

### For Approach 2 (Gateway Integration)
- [ ] Create Lambda function with Code Interpreter wrapper
- [ ] Add `bedrock-agentcore` to Lambda layer
- [ ] Create tool specification JSON
- [ ] Update CDK to create Lambda
- [ ] Create IAM role for Lambda with Code Interpreter permissions
- [ ] Add Lambda as Gateway target
- [ ] Update Gateway configuration
- [ ] Test tool discovery through Gateway
- [ ] Implement session management in Lambda
- [ ] Add error handling and logging

## Next Steps

1. **Decision**: Choose approach based on project requirements
2. **Prototype**: Implement chosen approach in feature branch
3. **Test**: Verify code execution works correctly
4. **Document**: Update GASP_CONTEXT.md with implementation details
5. **Deploy**: Push to develop branch after testing

## References

- [AgentCore Code Interpreter Documentation](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-tool.html)
- [AWS IDP Reference Implementation](https://github.com/aws-solutions-library-samples/accelerated-intelligent-document-processing-on-aws)
- [GASP Gateway Documentation](./GATEWAY.md)
- [Strands Agents Documentation](https://strandsagents.com/)
