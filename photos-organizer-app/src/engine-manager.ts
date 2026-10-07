import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";

interface EngineResponse {
  id: string;
  success: boolean;
  [key: string]: unknown;
}

interface PendingRequest {
  resolve: (value: EngineResponse) => void;
  reject: (reason: Error) => void;
}

class EngineManager {
  private process: ChildProcessWithoutNullStreams | null = null;

  private pendingRequests = new Map<
    string,
    PendingRequest
  >();

  start() {
    if (this.process) return;

    const pythonPath = path.join(
      process.cwd(),
      "gallery-engine",
      ".venv",
      "bin",
      "python"
    );

    const enginePath = path.join(
      process.cwd(),
      "gallery-engine",
      "main.py"
    );

    this.process = spawn(
      pythonPath,
      [enginePath],
      {
        stdio: ["pipe", "pipe", "pipe"],

        env: {
          ...process.env,
          DYLD_LIBRARY_PATH:
            "/opt/homebrew/opt/vips/lib",
        },
      }
    );

    const reader = readline.createInterface({
      input: this.process.stdout,
    });

    reader.on("line", (line) => {
      try {
        const response: EngineResponse =
          JSON.parse(line);

        const request =
          this.pendingRequests.get(response.id);

        if (!request) {
          console.warn(
            "Unknown engine response:",
            response
          );

          return;
        }

        this.pendingRequests.delete(response.id);

        request.resolve(response);
      } catch (error) {
        console.error(
          "Invalid engine response:",
          line,
          error
        );
      }
    });

    this.process.stderr.on("data", (data) => {
      console.error(
        "[Python Engine]",
        data.toString()
      );
    });

    this.process.on("exit", (code) => {
      console.log(
        `Python Engine exited with code ${code}`
      );

      this.process = null;

      for (const request of this.pendingRequests.values()) {
        request.reject(
          new Error("Python Engine exited")
        );
      }

      this.pendingRequests.clear();
    });

    console.log("Python Engine started");
  }

  send(
    command: Record<string, unknown>
  ): Promise<EngineResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process) {
        reject(
          new Error(
            "Python Engine is not running"
          )
        );

        return;
      }

      const id = command.id;

      if (typeof id !== "string") {
        reject(
          new Error(
            "Engine command must have an id"
          )
        );

        return;
      }

      this.pendingRequests.set(id, {
        resolve,
        reject,
      });

      this.process.stdin.write(
        JSON.stringify(command) + "\n"
      );
    });
  }

  stop() {
    if (!this.process) return;

    this.process.kill();
    this.process = null;

    for (const request of this.pendingRequests.values()) {
      request.reject(
        new Error("Python Engine stopped")
      );
    }

    this.pendingRequests.clear();
  }
}

export const engine = new EngineManager();