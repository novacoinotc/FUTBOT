import { Client } from "ssh2";
import { env } from "../config/env.js";

const MAX_OUTPUT_LENGTH = 5000;
const DEFAULT_TIMEOUT = 30_000; // 30 seconds
const MAX_TIMEOUT = 120_000; // 2 minutes

// Sanitize agent ID for use as Linux username (max 32 chars, alphanumeric + dash)
function agentUsername(agentId: string): string {
  return `bot-${agentId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 26)}`;
}

function getSSHConfig() {
  const host = env.VM_HOST;
  if (!host) throw new Error("VM_HOST not configured");

  return {
    host,
    port: Number(env.VM_SSH_PORT) || 22,
    username: env.VM_SSH_USER || "botadmin",
    privateKey: env.VM_SSH_PRIVATE_KEY
      ? Buffer.from(env.VM_SSH_PRIVATE_KEY, "base64").toString("utf-8")
      : undefined,
    readyTimeout: 10_000,
  };
}

function connectSSH(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const config = getSSHConfig();

    if (!config.privateKey) {
      return reject(new Error("VM_SSH_PRIVATE_KEY not configured"));
    }

    conn
      .on("ready", () => resolve(conn))
      .on("error", (err) => reject(err))
      .connect(config);
  });
}

function execCommand(
  conn: Client,
  command: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error(`Command timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    conn.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        return reject(err);
      }

      let stdout = "";
      let stderr = "";

      stream
        .on("close", (code: number) => {
          clearTimeout(timer);
          resolve({
            stdout: stdout.slice(-MAX_OUTPUT_LENGTH),
            stderr: stderr.slice(-MAX_OUTPUT_LENGTH),
            exitCode: code ?? 0,
          });
        })
        .on("data", (data: Buffer) => {
          stdout += data.toString();
        })
        .stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
    });
  });
}

/**
 * Execute a bash command in the agent's workspace on the VM
 */
export async function executeCommand(
  agentId: string,
  command: string,
  timeoutSeconds?: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const username = agentUsername(agentId);
  const timeoutMs = Math.min(
    (timeoutSeconds || 30) * 1000,
    MAX_TIMEOUT
  );

  // Run command as the agent's user in their home directory
  const wrappedCommand = `sudo -u ${username} -i bash -c 'cd ~/workspace && ${command.replace(/'/g, "'\\''")}'`;

  const conn = await connectSSH();
  try {
    return await execCommand(conn, wrappedCommand, timeoutMs);
  } finally {
    conn.end();
  }
}

/**
 * Write a file in the agent's workspace
 */
export async function writeFile(
  agentId: string,
  filePath: string,
  content: string
): Promise<void> {
  const username = agentUsername(agentId);

  // Sanitize path - no escaping to parent dirs
  const safePath = filePath.replace(/\.\./g, "").replace(/^\//, "");

  const conn = await connectSSH();
  try {
    // Create parent directory and write file
    const dir = safePath.includes("/")
      ? safePath.substring(0, safePath.lastIndexOf("/"))
      : "";
    if (dir) {
      await execCommand(
        conn,
        `sudo -u ${username} -i bash -c 'mkdir -p ~/workspace/${dir}'`,
        10_000
      );
    }

    // Write content via heredoc to handle special characters
    const escapedContent = content.replace(/\\/g, "\\\\").replace(/'/g, "'\\''");
    await execCommand(
      conn,
      `sudo -u ${username} -i bash -c 'cat > ~/workspace/${safePath} << '"'"'BOTEOF'"'"'\n${escapedContent}\nBOTEOF'`,
      10_000
    );
  } finally {
    conn.end();
  }
}

/**
 * Read a file from the agent's workspace
 */
export async function readFile(
  agentId: string,
  filePath: string
): Promise<string> {
  const username = agentUsername(agentId);
  const safePath = filePath.replace(/\.\./g, "").replace(/^\//, "");

  const conn = await connectSSH();
  try {
    const result = await execCommand(
      conn,
      `sudo -u ${username} -i bash -c 'cat ~/workspace/${safePath}'`,
      10_000
    );
    if (result.exitCode !== 0) {
      throw new Error(`File not found or not readable: ${safePath}`);
    }
    return result.stdout.slice(0, MAX_OUTPUT_LENGTH);
  } finally {
    conn.end();
  }
}

/**
 * Set up a new agent's workspace on the VM (creates Linux user + workspace dir)
 */
export async function setupAgentWorkspace(
  agentId: string,
  agentName: string
): Promise<void> {
  const username = agentUsername(agentId);

  const conn = await connectSSH();
  try {
    // Create user if not exists, with home directory
    await execCommand(
      conn,
      `id ${username} &>/dev/null || sudo useradd -m -s /bin/bash ${username}`,
      15_000
    );

    // Create workspace directory
    await execCommand(
      conn,
      `sudo -u ${username} -i bash -c 'mkdir -p ~/workspace'`,
      10_000
    );

    // Create a welcome file with agent info
    await execCommand(
      conn,
      `sudo -u ${username} -i bash -c 'echo "Agent: ${agentName}\nID: ${agentId}\nCreated: $(date)" > ~/workspace/README.txt'`,
      10_000
    );

    console.log(`[VM] Created workspace for agent ${agentName} (${username})`);
  } finally {
    conn.end();
  }
}

/**
 * Check if VM connection is available
 */
export async function checkVMConnection(): Promise<boolean> {
  try {
    const conn = await connectSSH();
    const result = await execCommand(conn, "echo ok", 5_000);
    conn.end();
    return result.stdout.trim() === "ok";
  } catch {
    return false;
  }
}

/**
 * Check if VM is configured (env vars present)
 */
export function isVMConfigured(): boolean {
  return !!(env.VM_HOST && env.VM_SSH_PRIVATE_KEY);
}
