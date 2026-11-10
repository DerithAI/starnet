/**
 * StarNet ⇄ LUMEN / AGENTIC-OS Bridge Config
 * Connects StarNet station directly to local Ollama (qwen2.5:7b, deepseek-r1),
 * LUMEN MEGA platform, and Command Center on port 19001.
 */
module.exports = {
  station: {
    name: "NOETIC MESH PRIME STATION",
    port: 8787,
    command_center_url: "http://127.0.0.1:19001",
    lumen_url: "http://127.0.0.1:8002",
    lumen_mega_url: "http://127.0.0.1:3002",
    ollama_url: "http://127.0.0.1:11434/v1"
  },
  default_overseer: {
    name: "BUILDER",
    model: "qwen2.5:7b",
    provider: "openai-compatible",
    room: "lab_bay"
  },
  specialists: [
    { name: "DEBUGGER", model: "deepseek-r1:latest", room: "audit_bay", role: "Security & Code Review" },
    { name: "WRITER", model: "hermes3:latest", room: "bridge", role: "Chronicle & Communication" },
    { name: "LUMEN_CORE", model: "shad9k/LUMEN", room: "ai_core", role: "Cognitive Synthesis" },
    { name: "DATA_ENGINEER", model: "qwen2.5:7b", room: "data_vault", role: "BigQuery & ETL Pipelines" },
    { name: "MLOPS_SPECIALIST", model: "deepseek-r1:latest", room: "mlops_hangar", role: "Vertex AI & Model Monitoring" },
    { name: "ARCHITECT", model: "hermes3:latest", room: "nexus_sanctum", role: "Systems Architecture & DAG" }
  ],
  rooms: {
    "lab_bay": { label: "BUILDER LAB", capability: "code_generation", color: "#00f0ff" },
    "audit_bay": { label: "SECURITY CHAMBER", capability: "code_review", color: "#ff2255" },
    "bridge": { label: "COMMAND BRIDGE", capability: "planning", color: "#ffd34a" },
    "ai_core": { label: "LUMEN AI CORE", capability: "synthesis", color: "#b055f7" },
    "data_vault": { label: "BIGQUERY DATA VAULT", capability: "data_engineering", color: "#00ff88" },
    "mlops_hangar": { label: "VERTEX MLOPS HANGAR", capability: "mlops_pipeline", color: "#ff7700" },
    "nexus_sanctum": { label: "NEXUS ARCHITECT SANCTUM", capability: "meta_cognition", color: "#e2e8f8" }
  }
};

