import { z } from "zod";
import { createPrompt, prompts } from "@/lib/factories";
import { getPromptContent } from "@/lib/promptLoader";

createPrompt("blockbench_native_apis", {
  description:
    "Essential information about Blockbench v5.0 native API security model and requireNativeModule() usage. Use this when working with Node.js modules, file system access, or native APIs in Blockbench plugins.",
  argsSchema: z.object({}),
  async generate() {
    const text = getPromptContent("blockbench_native_apis");
    return {
      messages: [{ role: "user", content: { type: "text", text } }],
    };
  },
});

createPrompt("model_creation_strategy", {
  title: "Safe Model Creation Strategy",
  description:
    "A staged Blockbench modeling workflow with explicit hierarchy, multi-view spatial checks, and human review checkpoints.",
  argsSchema: z.object({
    format: z.enum(["java_block", "bedrock"]).optional(),
    approach: z.enum(["incremental", "import"]).default("incremental"),
  }),
  async generate({ format, approach }) {
    const result: string[] = [];

    if (format === "java_block") {
      result.push(getPromptContent("java_block"));
    }

    if (format === "bedrock") {
      result.push(getPromptContent("bedrock_block"));
    }

    if (approach === "import") {
      result.push(getPromptContent("model_creation_import"));
    } else {
      result.push(getPromptContent("model_creation_incremental"));
    }

    return {
      messages: [{ role: "user", content: { type: "text", text: result.join("\n") } }],
    };
  },
});

export default prompts;
