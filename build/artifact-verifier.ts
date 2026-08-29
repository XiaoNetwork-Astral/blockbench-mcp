import { builtinModules, createRequire } from "node:module";

export interface ExpectedPluginIdentity {
  id: string;
  version: string;
}

interface RegisteredPlugin {
  id: string;
  metadata: Record<string, unknown>;
}

const localRequire = createRequire(import.meta.url);
const nativeModuleNames = new Set(
  builtinModules.flatMap((name) => [name, name.replace(/^node:/, "")])
);

function requireNativeOnly(moduleName: unknown): unknown {
  if (typeof moduleName !== "string" || !nativeModuleNames.has(moduleName)) {
    throw new Error(
      `Standalone plugin attempted to resolve non-native runtime module ${JSON.stringify(moduleName)}.`
    );
  }
  return localRequire(moduleName);
}

function createInertHostValue(): unknown {
  let inert: unknown;
  const target = function inertBlockbenchHostValue() {};
  inert = new Proxy(target, {
    apply: () => inert,
    construct: () => inert as object,
    get: (_target, property) => {
      if (property === "then") return undefined;
      if (property === Symbol.iterator) return function* emptyIterator() {};
      if (property === Symbol.toPrimitive) return () => "";
      return inert;
    },
    set: () => true,
  });
  return inert;
}

/**
 * Executes a completed plugin bundle using the same two module hooks that
 * Blockbench supplies to locally loaded plugins. Registration is captured but
 * onload is deliberately not invoked; live Blockbench acceptance covers that
 * lifecycle separately.
 */
export function verifyBlockbenchPluginArtifact(
  source: string,
  expected: ExpectedPluginIdentity
): RegisteredPlugin {
  const registrations: RegisteredPlugin[] = [];
  const pluginApi = {
    register(id: unknown, metadata: unknown) {
      if (typeof id !== "string" || !metadata || typeof metadata !== "object") {
        throw new Error("Plugin.register() must receive a string ID and metadata object.");
      }
      registrations.push({
        id,
        metadata: metadata as Record<string, unknown>,
      });
    },
  };

  const inertHostValue = createInertHostValue();
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  const sandboxValues: Record<PropertyKey, unknown> = {
    requireNativeModule: requireNativeOnly,
    require: requireNativeOnly,
    BBPlugin: pluginApi,
    Plugin: pluginApi,
    // Optional integrations must remain disabled during artifact evaluation.
    Settings: { get: () => undefined, structure: {}, stored: {} },
    Plugins: { installed: [] },
    localStorage: storage,
    console: { ...console, log: () => undefined },
    module: undefined,
    exports: undefined,
    define: undefined,
  };
  const sandbox = new Proxy(sandboxValues, {
    has: () => true,
    get(target, property) {
      if (property === Symbol.unscopables) return undefined;
      if (Reflect.has(target, property)) return Reflect.get(target, property);
      if (property in globalThis) {
        return Reflect.get(globalThis as unknown as object, property);
      }
      return inertHostValue;
    },
  });

  const execute = new Function(
    "sandbox",
    `with (sandbox) {\n${source}\n}\n//# sourceURL=blockbench-mcp-artifact-verification.js`
  );

  try {
    execute(sandbox);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Standalone Blockbench plugin evaluation failed: ${message}`, {
      cause: error,
    });
  }

  if (registrations.length !== 1) {
    throw new Error(
      `Expected one plugin registration, received ${registrations.length}.`
    );
  }

  const registration = registrations[0];
  if (registration.id !== expected.id) {
    throw new Error(
      `Expected plugin ID '${expected.id}', received '${registration.id}'.`
    );
  }
  if (registration.metadata.version !== expected.version) {
    throw new Error(
      `Expected plugin version '${expected.version}', received ${JSON.stringify(registration.metadata.version)}.`
    );
  }

  return registration;
}
