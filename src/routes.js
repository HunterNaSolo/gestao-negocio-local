const express = require("express");
const db = require("./db");
const { newId } = require("./utils");

const router = express.Router();

function checkAdminPassword(req, res, next) {
  const expected = process.env.ADMIN_PASSWORD || "";
  if (!expected) {
    return res.status(500).json({ error: "ADMIN_PASSWORD não configurado no .env" });
  }
  if (req.headers["x-admin-password"] !== expected) {
    return res.status(401).json({ error: "senha de administrador incorreta" });
  }
  next();
}

// ---------- Configurações (senha própria) ----------
router.post("/verify-admin", (req, res) => {
  const { senha } = req.body || {};
  const expected = process.env.ADMIN_PASSWORD || "";
  if (!expected) {
    return res.status(500).json({ error: "ADMIN_PASSWORD não configurado no .env" });
  }
  if (senha !== expected) {
    return res.status(401).json({ error: "senha incorreta" });
  }
  res.json({ ok: true });
});

// ---------- Categorias ----------
router.get("/categorias", (req, res) => {
  const rows = db.prepare("SELECT * FROM categorias ORDER BY nome").all();
  res.json({ categorias: rows });
});

router.post("/categorias", checkAdminPassword, (req, res) => {
  const { nome } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ error: "'nome' é obrigatório" });
  const id = newId();
  try {
    db.prepare("INSERT INTO categorias (id, nome) VALUES (?, ?)").run(id, nome.trim());
  } catch (err) {
    return res.status(400).json({ error: "Essa categoria já existe" });
  }
  res.json({ ok: true, id });
});

router.delete("/categorias", checkAdminPassword, (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "'id' é obrigatório" });
  db.prepare("DELETE FROM categorias WHERE id = ?").run(id);
  res.json({ ok: true });
});

// ---------- Cupons ----------
router.get("/cupons", (req, res) => {
  const rows = db.prepare("SELECT * FROM cupons WHERE ativo = 1 ORDER BY codigo").all();
  res.json({ cupons: rows });
});

router.post("/cupons", checkAdminPassword, (req, res) => {
  const { codigo, percentual } = req.body || {};
  if (!codigo || !codigo.trim()) return res.status(400).json({ error: "'codigo' é obrigatório" });
  const pct = Number(percentual);
  if (!pct || pct <= 0 || pct > 100) return res.status(400).json({ error: "Percentual precisa ser entre 1 e 100" });
  const id = newId();
  try {
    db.prepare("INSERT INTO cupons (id, codigo, percentual, ativo) VALUES (?, ?, ?, 1)").run(
      id,
      codigo.trim().toUpperCase(),
      pct
    );
  } catch (err) {
    return res.status(400).json({ error: "Esse código de cupom já existe" });
  }
  res.json({ ok: true, id });
});

router.delete("/cupons", checkAdminPassword, (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "'id' é obrigatório" });
  db.prepare("UPDATE cupons SET ativo = 0 WHERE id = ?").run(id);
  res.json({ ok: true });
});

// ---------- Clientes fiéis ----------
router.get("/clientes-fieis", (req, res) => {
  const pedidos = db
    .prepare("SELECT cliente, cpf, total FROM pedidos WHERE cpf IS NOT NULL AND cpf != '' ORDER BY data ASC")
    .all();

  const porCpf = {};
  for (const p of pedidos) {
    if (!porCpf[p.cpf]) porCpf[p.cpf] = { cpf: p.cpf, nome: p.cliente || "", totalCompras: 0, totalGasto: 0 };
    porCpf[p.cpf].nome = p.cliente || porCpf[p.cpf].nome; // fica com o nome mais recente
    porCpf[p.cpf].totalCompras += 1;
    porCpf[p.cpf].totalGasto += p.total;
  }

  const clientes = Object.values(porCpf).sort((a, b) => b.totalCompras - a.totalCompras);
  res.json({ clientes });
});

// ---------- Estoque ----------
router.get("/estoque", (req, res) => {
  const rows = db.prepare("SELECT * FROM estoque WHERE ativo = 1").all();
  res.json({ produtos: rows });
});

router.post("/estoque", (req, res) => {
  const { produto, categoria, quantidade, precoCusto, precoVenda, estoqueMinimo } = req.body || {};
  if (!produto) return res.status(400).json({ error: "'produto' é obrigatório" });
  const id = newId();
  db.prepare(
    `INSERT INTO estoque (id, produto, categoria, quantidade, precoCusto, precoVenda, estoqueMinimo, ativo)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(id, produto, categoria || "", quantidade || 0, precoCusto || 0, precoVenda || 0, estoqueMinimo || 0);
  res.json({ ok: true, id });
});

router.put("/estoque", (req, res) => {
  const { id, produto, categoria, quantidade, precoCusto, precoVenda, estoqueMinimo } = req.body || {};
  if (!id) return res.status(400).json({ error: "'id' é obrigatório" });
  const existing = db.prepare("SELECT * FROM estoque WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "produto não encontrado" });
  db.prepare(
    `UPDATE estoque SET produto=?, categoria=?, quantidade=?, precoCusto=?, precoVenda=?, estoqueMinimo=? WHERE id=?`
  ).run(
    produto ?? existing.produto,
    categoria ?? existing.categoria,
    quantidade ?? existing.quantidade,
    precoCusto ?? existing.precoCusto,
    precoVenda ?? existing.precoVenda,
    estoqueMinimo ?? existing.estoqueMinimo,
    id
  );
  res.json({ ok: true });
});

router.delete("/estoque", (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "'id' é obrigatório" });
  const result = db.prepare("UPDATE estoque SET ativo = 0 WHERE id = ?").run(id);
  if (result.changes === 0) return res.status(404).json({ error: "produto não encontrado" });
  res.json({ ok: true });
});

// ---------- Caixa ----------
router.get("/caixa", (req, res) => {
  const entradas = db.prepare("SELECT * FROM caixa ORDER BY data DESC").all();
  const saldo = entradas.reduce((acc, e) => acc + (e.tipo === "entrada" ? e.valor : -e.valor), 0);
  res.json({ entradas, saldo });
});

router.post("/caixa", (req, res) => {
  const { tipo, descricao, valor, origem } = req.body || {};
  if (!tipo || !valor) return res.status(400).json({ error: "'tipo' e 'valor' são obrigatórios" });
  const id = newId();
  db.prepare(`INSERT INTO caixa (id, data, tipo, descricao, valor, origem) VALUES (?, ?, ?, ?, ?, ?)`).run(
    id,
    new Date().toISOString(),
    tipo,
    descricao || "",
    valor,
    origem || "manual"
  );
  res.json({ ok: true, id });
});

// ---------- Pedidos ----------
router.get("/pedidos", (req, res) => {
  const rows = db.prepare("SELECT * FROM pedidos ORDER BY data DESC").all();
  const pedidos = rows.map((r) => ({ ...r, itens: JSON.parse(r.itens || "[]") }));
  res.json({ pedidos });
});

router.post("/pedidos", (req, res) => {
  const { cliente, cpf, itens, formaPagamento, cupomCodigo } = req.body || {};
  if (!Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ error: "'itens' precisa ser uma lista com pelo menos 1 item" });
  }

  // confere estoque suficiente ANTES de descontar qualquer coisa
  for (const item of itens) {
    const produto = db.prepare("SELECT * FROM estoque WHERE id = ?").get(item.produtoId);
    if (!produto) return res.status(400).json({ error: `Produto não encontrado: ${item.produtoId}` });
    if (produto.quantidade < item.quantidade) {
      return res.status(400).json({
        error: `Estoque insuficiente de "${produto.produto}" (disponível: ${produto.quantidade}, pedido: ${item.quantidade})`,
      });
    }
  }

  // valida o cupom, se informado (aceita cupons cadastrados, ou o cupom
  // especial de fidelidade "FIDELIDADE5", que não precisa estar cadastrado)
  let percentualDesconto = 0;
  let codigoAplicado = null;
  if (cupomCodigo) {
    const codigoNormalizado = cupomCodigo.trim().toUpperCase();
    if (codigoNormalizado === "FIDELIDADE5") {
      percentualDesconto = 5;
      codigoAplicado = "FIDELIDADE5";
    } else {
      const cupom = db.prepare("SELECT * FROM cupons WHERE codigo = ? AND ativo = 1").get(codigoNormalizado);
      if (!cupom) return res.status(400).json({ error: `Cupom "${codigoNormalizado}" não encontrado ou inativo` });
      percentualDesconto = cupom.percentual;
      codigoAplicado = cupom.codigo;
    }
  }

  try {
    db.exec("BEGIN");

    let subtotal = 0;
    const itensDetalhados = [];
    for (const item of itens) {
      const produto = db.prepare("SELECT * FROM estoque WHERE id = ?").get(item.produtoId);
      const itemSubtotal = produto.precoVenda * item.quantidade;
      subtotal += itemSubtotal;
      itensDetalhados.push({
        produtoId: item.produtoId,
        produto: produto.produto,
        quantidade: item.quantidade,
        precoUnit: produto.precoVenda,
        subtotal: itemSubtotal,
      });
      db.prepare("UPDATE estoque SET quantidade = quantidade - ? WHERE id = ?").run(item.quantidade, item.produtoId);
    }

    const desconto = Math.round(subtotal * (percentualDesconto / 100) * 100) / 100;
    const total = Math.round((subtotal - desconto) * 100) / 100;

    const id = newId();
    const dataAgora = new Date().toISOString();
    db.prepare(
      `INSERT INTO pedidos (id, data, cliente, cpf, itens, total, formaPagamento, status, desconto, cupomCodigo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      dataAgora,
      cliente || "",
      cpf || "",
      JSON.stringify(itensDetalhados),
      total,
      formaPagamento || "",
      "concluido",
      desconto,
      codigoAplicado
    );

    db.prepare(`INSERT INTO caixa (id, data, tipo, descricao, valor, origem) VALUES (?, ?, ?, ?, ?, ?)`).run(
      newId(),
      dataAgora,
      "entrada",
      `Pedido${cliente ? " — " + cliente : ""}`,
      total,
      `pedido:${id}`
    );

    db.exec("COMMIT");
    res.json({ ok: true, id, subtotal, desconto, total, cupomCodigo: codigoAplicado, itens: itensDetalhados });
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch (_) {}
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
