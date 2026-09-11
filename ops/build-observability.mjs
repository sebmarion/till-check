// Build a private-uploaded error reporter for pages without a JS bundler.
import { build } from "esbuild";
import {buildIdentity} from "./observability-identity.cjs";
import { configFor } from "@zeus/observability";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { resolve, relative, dirname, join, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import SentryCli from "@sentry/cli";

const [product, destination, mode] = process.argv.slice(2);
if (!/^[a-z][a-z0-9-]{0,63}$/.test(product ?? "") || !destination) throw Error("Provide product and output path");
const root = process.cwd(), output = resolve(root, destination), rel = relative(root, output);
if (rel.startsWith("..") || isAbsolute(rel)) throw Error("Output must stay inside this project");
const dsn = process.env.ZEUS_BROWSER_DSN ?? process.env.VITE_ZEUS_DSN ?? "";
const revision = process.env.ZEUS_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA;
const environment = process.env.ZEUS_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development";
if (dsn && (!/^[a-f0-9]{40}$/.test(revision ?? "") || !process.env.SENTRY_AUTH_TOKEN)) {
  throw Error("Enabled reporting requires an exact revision and source-map upload credential");
}
if (dsn && !configFor({product,dsn}).dsn) throw Error("Invalid Zeus collector");
await mkdir(dirname(output), {recursive:true});
const registration = mode === "hermes" ? '\nwindow.__HERMES_PLUGINS__?.register("zeus-observability", () => null);\n' : "";
if (!dsn) {
  await writeFile(output, 'globalThis.ZeusObservability = Object.freeze({enabled:false});\n' + registration);
} else {
  const stage = await mkdtemp(join(tmpdir(), "zeus-observability-build-"));
  try {
    const binding = buildIdentity(product, "browser", true);
    const config = {product,runtime:"browser",dsn,environment,release:product+"@"+revision};
    const code = 'import * as Sentry from "@sentry/browser";\nimport {initialize} from "@zeus/observability";\n' +
      'const config = '+JSON.stringify(config)+';\n' +
      'config.deploymentId = '+JSON.stringify(binding)+'.split(":")[1];\n' +
      'globalThis.ZeusObservability = initialize(Sentry, config);\n' + registration;
    const built = join(stage, "observability.js");
    await build({stdin:{contents:code,resolveDir:root,sourcefile:"observability-source.mjs"},
      outfile:built,bundle:true,format:"iife",platform:"browser",target:"es2020",
      sourcemap:"external",minify:true,legalComments:"none"});
    const env = {...process.env,SENTRY_URL:process.env.SENTRY_URL ?? "https://zeus.tailfad2e3.ts.net:8443",
      SENTRY_ORG:process.env.SENTRY_ORG ?? "zeus-"+product,
      SENTRY_PROJECT:process.env.SENTRY_PROJECT ?? "production",
      SENTRY_RELEASE:product+"@"+revision,SENTRY_DISABLE_UPDATE_CHECK:"1"};
    for (const args of [
      ["sourcemaps","inject",stage],
      ["sourcemaps","upload","--release",env.SENTRY_RELEASE,stage]
    ]) {
      const result = spawnSync(SentryCli.getPath(),args,{env,encoding:"utf8",timeout:90000});
      if (result.status !== 0) throw Error("Zeus source-map upload failed; release output was not replaced");
    }
    // The map stays in the private upload only; publish the matching JS after acceptance.
    await copyFile(built, output);
  } finally { await rm(stage,{recursive:true,force:true}); }
}
console.log("Built Zeus reporter for "+product+" (collection "+(dsn?"enabled":"disabled")+")");
