const { withAndroidManifest } = require("@expo/config-plugins");

/** Pairing speaks plain HTTP on the LAN. Release builds block that unless the manifest allows it. */
function withCleartext(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];
    if (app) app.$["android:usesCleartextTraffic"] = "true";
    return config;
  });
}

module.exports = withCleartext;
