import assert from "node:assert/strict";

const SYNC_CURRENT_FILE = "diario-atual.json";
const SYNC_VERSION_PREFIX = "diario-versao-";

function isSyncDataFile(name) {
  return name === SYNC_CURRENT_FILE || (name.startsWith(SYNC_VERSION_PREFIX) && name.endsWith(".json"));
}

function chooseLatestSyncFile(files, manifest = null) {
  const manifestName = manifest?.current?.fileName;
  if (manifestName && files.some((file) => file.name === manifestName && isSyncDataFile(file.name))) return manifestName;
  return files
    .filter((file) => isSyncDataFile(file.name))
    .sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.name ?? null;
}

assert.equal(
  chooseLatestSyncFile([
    { name: SYNC_CURRENT_FILE, modifiedAt: 10 },
    { name: "diario-versao-2026-06-26T10-00-00.json", modifiedAt: 20 }
  ]),
  "diario-versao-2026-06-26T10-00-00.json",
  "sem manifesto, deve carregar o arquivo de dados mais recente"
);

assert.equal(
  chooseLatestSyncFile(
    [
      { name: SYNC_CURRENT_FILE, modifiedAt: 30 },
      { name: "diario-versao-confirmada.json", modifiedAt: 20 }
    ],
    { current: { fileName: "diario-versao-confirmada.json" } }
  ),
  "diario-versao-confirmada.json",
  "com manifesto, deve carregar a versao confirmada pelo ultimo salvamento completo"
);

assert.equal(
  chooseLatestSyncFile(
    [
      { name: SYNC_CURRENT_FILE, modifiedAt: 30 },
      { name: "diario-versao-segura.json", modifiedAt: 40 }
    ],
    { current: { fileName: "../fora-da-pasta.json" } }
  ),
  "diario-versao-segura.json",
  "manifesto invalido deve cair no fallback seguro"
);

console.log("sync-safety: OK");
