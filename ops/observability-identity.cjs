const {randomBytes} = require("node:crypto");

// One opaque identity is shared across child build processes. No credential is returned.
function buildIdentity(product, target = "browser", enabled = false, env = process.env) {
  if (!enabled) return "";
  const revision = env.ZEUS_RELEASE ?? env.VERCEL_GIT_COMMIT_SHA;
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(product) ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(target) || !/^[a-f0-9]{40}$/.test(revision ?? "")) {
    throw new Error("Build identity requires a product, target and exact source revision");
  }
  if (!env.ZEUS_DEPLOYMENT_ID) env.ZEUS_DEPLOYMENT_ID = randomBytes(32).toString("hex");
  if (!/^[a-f0-9]{64}$/.test(env.ZEUS_DEPLOYMENT_ID)) {
    throw new Error("Invalid Zeus build identity");
  }
  return `zeus-deployment:${env.ZEUS_DEPLOYMENT_ID}:${product}@${revision}:${target}`;
}
module.exports = {buildIdentity};
