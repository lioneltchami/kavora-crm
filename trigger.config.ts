import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_ID ?? "proj_replace_me",
  maxDuration: 300,
  runtime: "node",
  logLevel: "info",
  dirs: ["./src/trigger"],
});
