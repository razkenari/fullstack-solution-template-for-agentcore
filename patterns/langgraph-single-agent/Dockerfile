FROM public.ecr.aws/docker/library/python:3.11-slim

WORKDIR /app

# Copy the necessary files for package installation
COPY pyproject.toml .
COPY gateway/ gateway/

# Install GASP package with only core dependencies (no dev/agent optional deps)
RUN pip install --no-cache-dir -e . --no-deps && \
    pip install --no-cache-dir boto3>=1.34.0 requests>=2.31.0

# Install agent requirements
COPY patterns/langgraph-single-agent/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir aws-opentelemetry-distro==0.10.1

ENV AWS_REGION=us-east-1
ENV AWS_DEFAULT_REGION=us-east-1

# Create non-root user
RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

EXPOSE 8080
EXPOSE 8000

# Copy only the agent code
COPY patterns/langgraph-single-agent/langgraph_agent.py .

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/ping || exit 1

CMD ["opentelemetry-instrument", "python", "-m", "langgraph_agent"]
