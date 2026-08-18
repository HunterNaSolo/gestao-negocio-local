const express = require("express");
const db = require("./db");
const { newId } = require("./utils");

const router = express.Router();

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
  const { cliente, itens, formaPagamento } = req.body || {};
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

  const transacao = db.transaction(() => {
    let total = 0;
    const itensDetalhados = [];
    for (const item of itens) {
      const produto = db.prepare("SELECT * FROM estoque WHERE id = ?").get(item.produtoId);
      const subtotal = produto.precoVenda * item.quantidade;
      total += subtotal;
      itensDetalhados.push({
        produtoId: item.produtoId,
        produto: produto.produto,
        quantidade: item.quantidade,
        precoUnit: produto.precoVenda,
        subtotal,
      });
      db.prepare("UPDATE estoque SET quantidade = quantidade - ? WHERE id = ?").run(item.quantidade, item.produtoId);
    }

    const id = newId();
    const dataAgora = new Date().toISOString();
    db.prepare(
      `INSERT INTO pedidos (id, data, cliente, itens, total, formaPagamento, status) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, dataAgora, cliente || "", JSON.stringify(itensDetalhados), total, formaPagamento || "", "concluido");

    db.prepare(`INSERT INTO caixa (id, data, tipo, descricao, valor, origem) VALUES (?, ?, ?, ?, ?, ?)`).run(
      newId(),
      dataAgora,
      "entrada",
      `Pedido${cliente ? " — " + cliente : ""}`,
      total,
      `pedido:${id}`
    );

    return { id, total, itens: itensDetalhados };
  });

  try {
    const resultado = transacao();
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
