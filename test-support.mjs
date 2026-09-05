import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

// Own ephemeral server and SQLite directory. No external-port or production DB mode.
export async function startFixture() {
  const dir = await mkdtemp(join(tmpdir(), "till-isolated-"));
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./server.mjs", import.meta.url))],
    {
      env: {
        ...process.env,
        TILL_DB: join(dir, "test.sqlite"),
        TILL_PORT: "0",
        TILL_BIND: "127.0.0.1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  child.stderr.on("data", (chunk) => {
    log += chunk;
  });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Fixture startup timed out: " + log)),
      8000,
    );
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("Fixture exited " + code + ": " + log));
    });
    child.stdout.on("data", (chunk) => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
  });
  return {
    base,
    dir,
    child,
    async request(method, path, body, headers = {}) {
      const res = await fetch(base + path, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json();
      return { status: res.status, data };
    },
    async close() {
      if (child.exitCode === null) {
        const stopped = once(child, "exit");
        child.kill("SIGTERM");
        await stopped;
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}
