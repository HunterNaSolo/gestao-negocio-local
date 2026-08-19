require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const routes = require("./routes");
const { checkForUpdate, downloadAndApplyUpdate, getCurrentVersion } = require("./updater");

const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const ATTEMPTS_FILE = path.join(__dirname, "..", ".update-attempts");
const MAX_ATTEMPTS = 3;

const app = express();
app.use(express.json());

// proteção simples por senha (útil se o computador for compartilhado/em rede)
function checkPassword(req, res, next) {
  if (!APP_PASSWORD) return next(); // sem senha configurada = sem proteção
  if (req.headers["x-app-password"] !== APP_PASSWORD) {
    return res.status(401).json({ error: "senha incorreta" });
  }
  next();
}

app.use("/api", checkPassword, routes);
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/version", (req, res) => {
  res.json({ version: getCurrentVersion() });
});

function getAttempts() {
  try {
    return parseInt(fs.readFileSync(ATTEMPTS_FILE, "utf8"), 10) || 0;
  } catch (_) {
    return 0;
  }
}

function setAttempts(n) {
  try {
    fs.writeFileSync(ATTEMPTS_FILE, String(n));
  } catch (_) {}
}

async function start() {
  // FREIO DE EMERGÊNCIA: se o programa já tentou se atualizar 3 vezes
  // seguidas sem conseguir "estabilizar" (ex: por um bug tipo o que já
  // corrigimos, ou por qualquer outro motivo), ele desiste de tentar dessa
  // vez e sobe com o que já tem — assim o cliente nunca fica com o app
  // travado num loop infinito e inacessível.
  const attempts = getAttempts();
  if (attempts >= MAX_ATTEMPTS) {
    console.log(
      `⚠ Pulei a checagem de atualização dessa vez (já tentou ${attempts}x seguidas sem estabilizar). Rodando com a versão atual.`
    );
    setAttempts(0);
  } else {
    // confere atualização ANTES de subir o servidor.
    // Importante: os arquivos são substituídos no disco, mas o Node já carregou
    // o código antigo na memória — então, se aplicar uma atualização, a gente
    // encerra o programa com um "código especial" (42), e o iniciar.bat
    // reconhece esse código e reabre o programa sozinho, agora sim com a
    // versão nova de verdade.
    try {
      const release = await checkForUpdate();
      if (release) {
        const aplicou = await downloadAndApplyUpdate(release);
        if (aplicou) {
          setAttempts(attempts + 1);
          console.log("\nReiniciando automaticamente com a versão nova...\n");
          process.exit(42);
        }
      } else {
        setAttempts(0); // já está atualizado — zera o contador, tudo saudável
      }
    } catch (err) {
      console.log("Falha ao checar/aplicar atualização (seguindo com a versão atual):", err.message);
    }
  }

  app.listen(PORT, () => {
    console.log(`\n✔ Gestão do Negócio rodando!`);
    console.log(`  Abre esse link no navegador: http://localhost:${PORT}\n`);
  });
}

start();
