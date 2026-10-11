const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../shared")];

const proxyPath = path.resolve(__dirname, "src/theme/rn-paper.js");
const upstream = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = context.originModulePath ?? "";
  const relative = path.relative(__dirname, origin);
  const inApp = relative.startsWith(`src${path.sep}`) || relative.startsWith(`app${path.sep}`);
  if (moduleName === "react-native" && inApp && path.resolve(origin) !== proxyPath) {
    return { type: "sourceFile", filePath: proxyPath };
  }
  if (upstream) return upstream(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
