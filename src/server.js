require("dotenv").config();
const express = require("express");
const path = require("path");
const routes = require("./routes");
const { checkForUpdate, downloadAndApplyUpdate, getCurrentVersion } = require("./updater");

const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || "";

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

async function start() {
  // confere atualização ANTES de subir o servidor — assim, se aplicar uma
  // versão nova, já sobe já com os arquivos atualizados
  try {
    const release = await checkForUpdate();
    if (release) {
      await downloadAndApplyUpdate(release);
    }
  } catch (err) {
    console.log("Falha ao checar/aplicar atualização (seguindo com a versão atual):", err.message);
  }

  app.listen(PORT, () => {
    console.log(`\n✔ Gestão do Negócio rodando!`);
    console.log(`  Abre esse link no navegador: http://localhost:${PORT}\n`);
  });
}

start();
