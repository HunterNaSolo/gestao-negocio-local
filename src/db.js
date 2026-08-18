const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// O banco fica numa pasta "data" separada, que NUNCA é tocada pelo
// atualizador — assim, atualizar o programa nunca apaga os dados do cliente.
const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "negocio.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS estoque (
    id TEXT PRIMARY KEY,
    produto TEXT NOT NULL,
    categoria TEXT,
    quantidade REAL DEFAULT 0,
    precoCusto REAL DEFAULT 0,
    precoVenda REAL DEFAULT 0,
    estoqueMinimo REAL DEFAULT 0,
    ativo INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS caixa (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    tipo TEXT NOT NULL,
    descricao TEXT,
    valor REAL NOT NULL,
    origem TEXT
  );

  CREATE TABLE IF NOT EXISTS pedidos (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    cliente TEXT,
    itens TEXT NOT NULL,
    total REAL NOT NULL,
    formaPagamento TEXT,
    status TEXT
  );
`);

module.exports = db;
