const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);
const defaultResolveRequest = config.resolver.resolveRequest;
const useNativeVapi =
  process.env.EXPO_USE_DEV_CLIENT === "1" ||
  process.env.EAS_BUILD === "true" ||
  process.env.EAS_BUILD === "1" ||
  Boolean(process.env.EAS_BUILD_PROFILE) ||
  process.env.KYRO_USE_NATIVE_VAPI === "1";

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules")
];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (!useNativeVapi && moduleName === "@vapi-ai/react-native") {
    return {
      filePath: path.resolve(projectRoot, "src/lib/vapi-native-stub.ts"),
      type: "sourceFile"
    };
  }

  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
