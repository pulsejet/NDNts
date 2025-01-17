import fs from "node:fs/promises";
import * as path from "node:path";

const act = process.argv[2];
const publishUri = process.env.NDNTS_PUBLISH_URI ?? "https://ndnts-nightly.ndn.today";

/** @type {import("type-fest").PackageJson} */
const j = JSON.parse(await fs.readFile("package.json"));

if (act.includes("V")) {
  j.version = process.argv[3];
}

if (act.includes("C") && j.publishConfig) {
  Object.assign(j, j.publishConfig);
  delete j.publishConfig;
}

if (act.includes("D")) {
  delete j.devDependencies;
}

if (act.includes("N")) {
  for (const [dep, specifier] of Object.entries(j.dependencies)) {
    if (specifier.startsWith("workspace:")) {
      j.dependencies[dep] = `${publishUri}/${path.basename(dep)}.tgz`;
    }
  }
}

if (act.includes("R")) {
  for (const [dep, specifier] of Object.entries(j.dependencies)) {
    if (specifier.startsWith("workspace:")) {
      j.dependencies[dep] = process.argv[3];
    }
  }
}

await fs.writeFile("package.json", JSON.stringify(j, undefined, 2));
