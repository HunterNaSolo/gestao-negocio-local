const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const REPO = process.env.UPDATE_REPO || ""; // ex: "seu-usuario/gestao-negocio-local"

function getCurrentVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "version.json"), "utf8")).version;
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "gestao-negocio-updater" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(httpGetJson(res.headers.location));
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https
      .get(url, { headers: { "User-Agent": "gestao-negocio-updater" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(destPath);
          return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        fs.unlink(destPath, () => reject(err));
      });
  });
}

// Copia tudo de "srcDir" pra "destDir", exceto a pasta "data" (é onde fica o
// banco de dados do cliente — atualização NUNCA deve mexer ali).
function copyRecursiveExcludingData(srcDir, destDir) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === "data" || entry.name === "node_modules" || entry.name === ".git") continue;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyRecursiveExcludingData(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

async function checkForUpdate() {
  if (!REPO) {
    console.log("Atualização automática desligada (UPDATE_REPO não configurado).");
    return null;
  }
  try {
    const currentVersion = getCurrentVersion();
    const release = await httpGetJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (!release || !release.tag_name) return null;

    const latestVersion = release.tag_name.replace(/^v/, "");
    if (compareVersions(latestVersion, currentVersion) <= 0) {
      console.log(`✔ Já está na versão mais recente (${currentVersion})`);
      return null;
    }
    console.log(`⬆ Nova versão disponível: ${latestVersion} (atual: ${currentVersion})`);
    return release;
  } catch (err) {
    console.log("Não foi possível checar atualizações agora:", err.message);
    return null;
  }
}

async function downloadAndApplyUpdate(release) {
  const asset = (release.assets || []).find((a) => a.name.endsWith(".zip"));
  if (!asset) {
    console.log("Essa versão não tem um .zip anexado — pulei a atualização automática.");
    return false;
  }

  // adm-zip só é carregado aqui dentro pra não travar o servidor caso não
  // esteja instalado e o usuário não use atualização automática
  const AdmZip = require("adm-zip");

  const tempZipPath = path.join(ROOT_DIR, "update-temp.zip");
  const extractDir = path.join(ROOT_DIR, "update-extracted");

  console.log("Baixando atualização...");
  await downloadFile(asset.browser_download_url, tempZipPath);

  console.log("Aplicando atualização...");
  const zip = new AdmZip(tempZipPath);
  fs.rmSync(extractDir, { recursive: true, force: true });
  zip.extractAllTo(extractDir, true);

  // o zip do GitHub normalmente vem com uma pasta única lá dentro
  // (ex: "gestao-negocio-local-1.2.0/"), então entra nela se existir
  const extracted = fs.readdirSync(extractDir);
  const sourceDir =
    extracted.length === 1 && fs.statSync(path.join(extractDir, extracted[0])).isDirectory()
      ? path.join(extractDir, extracted[0])
      : extractDir;

  copyRecursiveExcludingData(sourceDir, ROOT_DIR);

  // PROTEÇÃO: não confia só no version.json que veio dentro do zip (se
  // alguém esquecer de atualizar esse número antes de zipar, isso causaria
  // um loop infinito de "atualização" pra sempre). Em vez disso, grava a
  // versão baseada na tag da própria Release do GitHub, que é a fonte da
  // verdade real.
  const tagVersion = release.tag_name.replace(/^v/, "");
  fs.writeFileSync(path.join(ROOT_DIR, "version.json"), JSON.stringify({ version: tagVersion }, null, 2));

  fs.rmSync(tempZipPath, { force: true });
  fs.rmSync(extractDir, { recursive: true, force: true });

  console.log(`✔ Atualização aplicada (versão ${tagVersion})! Reinicie o programa pra usar a versão nova.`);
  return true;
}

module.exports = { checkForUpdate, downloadAndApplyUpdate, getCurrentVersion };
