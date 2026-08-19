const $ = (sel) => document.querySelector(sel);

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatMoney(v) {
  return `R$ ${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Máscara de moeda: a pessoa só digita números (0-9), e a formatação com
// vírgula/ponto acontece sozinha — não dá pra digitar vírgula/ponto na mão.
function applyCurrencyMask(input) {
  input.addEventListener("input", () => {
    const digits = input.value.replace(/\D/g, "");
    if (!digits) {
      input.value = "";
      return;
    }
    const reais = (parseInt(digits, 10) / 100).toFixed(2);
    let [intPart, decPart] = reais.split(".");
    intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    input.value = `${intPart},${decPart}`;
  });
}

function currencyValueToNumber(input) {
  const digits = input.value.replace(/\D/g, "");
  if (!digits) return 0;
  return parseInt(digits, 10) / 100;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

let state = {
  caixa: [],
  estoque: [],
  pedidos: [],
  pedidoItens: [],
  categorias: [],
  cupons: [],
  clientesFieis: [],
  devolucoes: [],
  pedidoCupomAplicado: null,
  adminPassword: null,
};

// ---------- Auth ----------
function getPassword() {
  return localStorage.getItem("gestao_password") || "";
}
function setPassword(pw) {
  localStorage.setItem("gestao_password", pw);
}

async function apiFetch(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  let res;
  try {
    res = await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-app-password": getPassword(),
        ...(options.headers || {}),
      },
    });
  } catch (networkErr) {
    throw new Error(
      networkErr.name === "AbortError"
        ? "O servidor demorou demais pra responder (timeout)."
        : "Não foi possível conectar ao servidor."
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (res.status === 401) {
    localStorage.removeItem("gestao_password");
    showLogin("Senha incorreta. Tente novamente.");
    throw new Error("unauthorized");
  }

  if (!res.ok) {
    let detail = `Erro do servidor (HTTP ${res.status}).`;
    try {
      const body = await res.json();
      if (body?.error) detail = body.error;
    } catch (_) {}
    throw new Error(detail);
  }

  return res.json();
}

function showLogin(errorMsg) {
  $("#login-screen").classList.remove("hidden");
  $("#app-screen").classList.add("hidden");
  $("#login-error").textContent = errorMsg || "";
}

function showApp() {
  $("#login-screen").classList.add("hidden");
  $("#app-screen").classList.remove("hidden");
  loadAll();
  checkBackupReminder();
}

$("#login-btn").addEventListener("click", async () => {
  const pw = $("#password-input").value.trim();
  if (!pw) return;
  setPassword(pw);
  $("#login-error").textContent = "Entrando...";
  try {
    await apiFetch("/api/caixa");
    showApp();
  } catch (e) {
    if (e.message !== "unauthorized") $("#login-error").textContent = e.message;
  }
});

function doLogout() {
  localStorage.removeItem("gestao_password");
  showLogin();
}
$("#logout-btn").addEventListener("click", doLogout);
$("#sidebar-logout-btn").addEventListener("click", doLogout);

// ---------- Tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    document.querySelectorAll(`.tab-btn[data-tab="${btn.dataset.tab}"]`).forEach((b) => b.classList.add("active"));
    $(`#tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "resumo") renderResumo();
  });
});

// ---------- Load everything ----------
async function loadAll() {
  try {
    const [caixaData, estoqueData, pedidosData, categoriasData, cuponsData, clientesData, devolucoesData] =
      await Promise.all([
        apiFetch("/api/caixa"),
        apiFetch("/api/estoque"),
        apiFetch("/api/pedidos"),
        apiFetch("/api/categorias"),
        apiFetch("/api/cupons"),
        apiFetch("/api/clientes-fieis"),
        apiFetch("/api/devolucoes"),
      ]);
    state.caixa = caixaData.entradas || [];
    state.caixaSaldo = caixaData.saldo || 0;
    state.estoque = estoqueData.produtos || [];
    state.pedidos = pedidosData.pedidos || [];
    state.categorias = categoriasData.categorias || [];
    state.cupons = cuponsData.cupons || [];
    state.clientesFieis = clientesData.clientes || [];
    state.devolucoes = devolucoesData.devolucoes || [];
  } catch (e) {
    console.error(e);
  }
  renderCaixa();
  renderEstoque();
  renderPedidos();
  renderDevolucoes();
  renderResumo();
  populatePedidoProdutoSelect();
  populateCategoriaSelect();
  renderCategoriasChips();
  populateCupomSelect();
  renderCuponsList();
  renderClientesFieis();
}

function populateCategoriaSelect() {
  const select = $("#estoque-categoria-input");
  const current = select.value;
  if (state.categorias.length === 0) {
    select.innerHTML = '<option value="">Nenhuma categoria cadastrada ainda</option>';
    return;
  }
  select.innerHTML = state.categorias.map((c) => `<option value="${escapeAttr(c.nome)}">${escapeHtml(c.nome)}</option>`).join("");
  if (state.categorias.some((c) => c.nome === current)) select.value = current;
}

function escapeAttr(v) {
  return (v ?? "").toString().replace(/"/g, "&quot;");
}

// ---------- Resumo ----------
let caixaChartInstance = null;

function renderResumo() {
  $("#resumo-saldo").textContent = formatMoney(state.caixaSaldo);
  $("#resumo-saldo").className = "balance-value " + (state.caixaSaldo < 0 ? "stat-low" : "stat-high");

  const valorEstoque = state.estoque.reduce((acc, p) => acc + p.quantidade * p.precoVenda, 0);
  $("#resumo-estoque").textContent = formatMoney(valorEstoque);

  const trintaDiasAtras = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const pedidosRecentes = state.pedidos.filter((p) => new Date(p.data).getTime() >= trintaDiasAtras);
  $("#resumo-pedidos").textContent = pedidosRecentes.length;

  const estoqueBaixo = state.estoque.filter((p) => p.estoqueMinimo > 0 && p.quantidade <= p.estoqueMinimo);
  const baixoCard = $("#estoque-baixo-card");
  if (estoqueBaixo.length === 0) {
    baixoCard.classList.add("hidden");
  } else {
    baixoCard.classList.remove("hidden");
    $("#estoque-baixo-list").innerHTML = estoqueBaixo
      .map(
        (p) => `
      <div class="low-stock-item">
        <span>${escapeHtml(p.produto)}</span>
        <span class="stat-low">${p.quantidade} restante(s) (mín: ${p.estoqueMinimo})</span>
      </div>
    `
      )
      .join("");
  }

  renderCaixaChart();
}

function renderCaixaChart() {
  const canvas = $("#caixa-chart");
  const emptyMsg = $("#caixa-chart-empty");
  const trintaDiasAtras = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentes = state.caixa
    .filter((e) => new Date(e.data).getTime() >= trintaDiasAtras)
    .sort((a, b) => new Date(a.data) - new Date(b.data));

  if (recentes.length === 0) {
    canvas.classList.add("hidden");
    emptyMsg.classList.remove("hidden");
    return;
  }
  canvas.classList.remove("hidden");
  emptyMsg.classList.add("hidden");

  try {
    if (typeof Chart === "undefined") throw new Error("Biblioteca de gráficos não carregou.");

    let saldoAcumulado = 0;
    const pontos = recentes.map((e) => {
      saldoAcumulado += e.tipo === "entrada" ? e.valor : -e.valor;
      return { x: e.data, y: saldoAcumulado };
    });

    if (caixaChartInstance) caixaChartInstance.destroy();
    caixaChartInstance = new Chart(canvas, {
      type: "line",
      data: {
        datasets: [
          {
            label: "Saldo acumulado",
            data: pontos,
            borderColor: "#f59e0b",
            backgroundColor: "#f59e0b33",
            fill: true,
            tension: 0.25,
          },
        ],
      },
      options: {
        responsive: true,
        scales: {
          x: { type: "time", ticks: { color: "#8b8b96" }, grid: { color: "#20202a" } },
          y: { ticks: { color: "#8b8b96", callback: (v) => `R$ ${v}` }, grid: { color: "#20202a" } },
        },
        plugins: { legend: { display: false } },
      },
    });
  } catch (e) {
    console.error(e);
    canvas.classList.add("hidden");
    emptyMsg.classList.remove("hidden");
    emptyMsg.textContent = `Não foi possível carregar: ${e.message}`;
  }
}

// ---------- Caixa ----------
function renderCaixa() {
  $("#caixa-saldo").textContent = formatMoney(state.caixaSaldo);
  $("#caixa-saldo").className = "balance-value " + (state.caixaSaldo < 0 ? "stat-low" : "stat-high");

  const listEl = $("#caixa-list");
  if (state.caixa.length === 0) {
    listEl.innerHTML = '<div class="empty">Nenhuma movimentação ainda</div>';
    return;
  }
  const ordenado = [...state.caixa].sort((a, b) => new Date(b.data) - new Date(a.data));
  listEl.innerHTML = ordenado
    .map(
      (e) => `
    <div class="list-item">
      <div class="li-top">
        <span class="li-desc">${escapeHtml(e.descricao || "(sem descrição)")}</span>
        <span class="li-value ${e.tipo === "entrada" ? "stat-high" : "stat-low"}">${e.tipo === "entrada" ? "+" : "-"} ${formatMoney(e.valor)}</span>
      </div>
      <div class="li-meta">${new Date(e.data).toLocaleString("pt-BR")}</div>
    </div>
  `
    )
    .join("");
}

$("#caixa-add-btn").addEventListener("click", async () => {
  const tipo = $("#caixa-tipo-input").value;
  const descricao = $("#caixa-descricao-input").value.trim();
  const valor = currencyValueToNumber($("#caixa-valor-input"));

  if (!valor || valor <= 0) {
    alert("Informe um valor válido.");
    return;
  }

  try {
    await apiFetch("/api/caixa", {
      method: "POST",
      body: JSON.stringify({ tipo, descricao, valor }),
    });
    $("#caixa-descricao-input").value = "";
    $("#caixa-valor-input").value = "";
    await loadAll();
  } catch (e) {
    alert(`Erro ao lançar: ${e.message}`);
  }
});

// ---------- Estoque ----------
function renderEstoque() {
  const container = $("#estoque-rows");
  if (state.estoque.length === 0) {
    container.innerHTML = '<tr><td colspan="7" class="empty">Nenhum produto ainda</td></tr>';
    return;
  }
  container.innerHTML = state.estoque
    .map(
      (p) => `
    <tr>
      <td>${escapeHtml(p.produto)}</td>
      <td>${escapeHtml(p.categoria)}</td>
      <td class="${p.estoqueMinimo > 0 && p.quantidade <= p.estoqueMinimo ? "stat-low" : ""}">${p.quantidade}</td>
      <td>${formatMoney(p.precoCusto)}</td>
      <td>${formatMoney(p.precoVenda)}</td>
      <td>${p.estoqueMinimo}</td>
      <td class="cell-remove"><button data-id="${p.id}">✕</button></td>
    </tr>
  `
    )
    .join("");

  container.querySelectorAll(".cell-remove button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remover esse produto do estoque?")) return;
      try {
        await apiFetch("/api/estoque", { method: "DELETE", body: JSON.stringify({ id: btn.dataset.id }) });
        await loadAll();
      } catch (e) {
        alert(`Erro ao remover: ${e.message}`);
      }
    });
  });
}

$("#estoque-add-btn").addEventListener("click", async () => {
  const produto = $("#estoque-produto-input").value.trim();
  if (!produto) {
    alert("Digite o nome do produto.");
    return;
  }
  const body = {
    produto,
    categoria: $("#estoque-categoria-input").value,
    quantidade: parseFloat($("#estoque-quantidade-input").value) || 0,
    precoCusto: currencyValueToNumber($("#estoque-custo-input")),
    precoVenda: currencyValueToNumber($("#estoque-venda-input")),
    estoqueMinimo: parseFloat($("#estoque-minimo-input").value) || 0,
  };

  try {
    await apiFetch("/api/estoque", { method: "POST", body: JSON.stringify(body) });
    $("#estoque-produto-input").value = "";
    $("#estoque-quantidade-input").value = "";
    $("#estoque-custo-input").value = "";
    $("#estoque-venda-input").value = "";
    $("#estoque-minimo-input").value = "";
    await loadAll();
  } catch (e) {
    alert(`Erro ao adicionar: ${e.message}`);
  }
});

// ---------- Pedidos ----------
function populatePedidoProdutoSelect() {
  const select = $("#pedido-produto-select");
  select.innerHTML = state.estoque
    .map((p) => `<option value="${p.id}">${escapeHtml(p.produto)} (${p.quantidade} disp. — ${formatMoney(p.precoVenda)})</option>`)
    .join("");
}

function updatePedidoTotal() {
  const subtotal = state.pedidoItens.reduce((acc, i) => acc + i.precoUnit * i.quantidade, 0);
  const cupom = state.pedidoCupomAplicado;

  if (!cupom) {
    $("#pedido-resumo-preco").classList.add("hidden");
    $("#pedido-total-simples").classList.remove("hidden");
    $("#pedido-total").textContent = formatMoney(subtotal);
    return;
  }

  const desconto = Math.round(subtotal * (cupom.percentual / 100) * 100) / 100;
  const total = Math.round((subtotal - desconto) * 100) / 100;

  $("#pedido-total-simples").classList.add("hidden");
  $("#pedido-resumo-preco").classList.remove("hidden");
  $("#pb-subtotal").textContent = formatMoney(subtotal);
  $("#pb-cupom-label").textContent = `Desconto (${cupom.codigo} -${cupom.percentual}%)`;
  $("#pb-desconto").textContent = `- ${formatMoney(desconto)}`;
  $("#pb-total").textContent = formatMoney(total);
}

function renderPedidoItens() {
  const container = $("#pedido-itens-list");
  if (state.pedidoItens.length === 0) {
    container.innerHTML = "";
    updatePedidoTotal();
    return;
  }
  container.innerHTML = state.pedidoItens
    .map(
      (item, idx) => `
    <div class="pedido-item-row">
      <span>${item.quantidade}x ${escapeHtml(item.produtoNome)} — ${formatMoney(item.precoUnit * item.quantidade)}</span>
      <button data-idx="${idx}">✕</button>
    </div>
  `
    )
    .join("");
  container.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.pedidoItens.splice(parseInt(btn.dataset.idx, 10), 1);
      renderPedidoItens();
    });
  });
  updatePedidoTotal();
}

$("#pedido-add-item-btn").addEventListener("click", () => {
  const produtoId = $("#pedido-produto-select").value;
  const quantidade = parseFloat($("#pedido-quantidade-input").value) || 0;
  const produto = state.estoque.find((p) => p.id === produtoId);

  if (!produto) {
    alert("Nenhum produto cadastrado ainda.");
    return;
  }
  if (quantidade <= 0) {
    alert("Informe uma quantidade válida.");
    return;
  }

  state.pedidoItens.push({
    produtoId,
    produtoNome: produto.produto,
    quantidade,
    precoUnit: produto.precoVenda,
  });
  $("#pedido-quantidade-input").value = "1";
  renderPedidoItens();
});

function populateCupomSelect() {
  const select = $("#pedido-cupom-select");
  const current = select.value;
  select.innerHTML =
    '<option value="">Nenhum cupom</option>' +
    state.cupons.map((c) => `<option value="${c.codigo}">${c.codigo} (-${c.percentual}%)</option>`).join("");
  if (state.cupons.some((c) => c.codigo === current)) select.value = current;
}

$("#pedido-cupom-select").addEventListener("change", () => {
  const codigo = $("#pedido-cupom-select").value;
  if (!codigo) {
    state.pedidoCupomAplicado = null;
  } else {
    const cupom = state.cupons.find((c) => c.codigo === codigo);
    state.pedidoCupomAplicado = cupom ? { codigo: cupom.codigo, percentual: cupom.percentual } : null;
  }
  updatePedidoTotal();
});

// ---------- Verificação de cliente fiel (pelo CPF) ----------
let cpfFidelidadeRecusado = null;

$("#pedido-cpf-input").addEventListener("input", () => {
  const cpf = $("#pedido-cpf-input").value.trim();
  const avisoEl = $("#pedido-fiel-aviso");

  if (!cpf || cpf === cpfFidelidadeRecusado) {
    avisoEl.classList.add("hidden");
    return;
  }

  const cliente = state.clientesFieis.find((c) => c.cpf === cpf);
  if (!cliente || cliente.totalCompras === 0) {
    avisoEl.classList.add("hidden");
    return;
  }

  avisoEl.classList.remove("hidden");
  avisoEl.innerHTML = `
    Esse cliente já comprou <strong>${cliente.totalCompras}x</strong>! Deseja premiá-lo com um cupom de fidelidade (5% de desconto)?
    <div class="loyalty-actions">
      <button id="aplicar-fidelidade-btn" class="loyalty-yes">Sim, aplicar 5%</button>
      <button id="recusar-fidelidade-btn" class="loyalty-no">Não, obrigado</button>
    </div>
  `;
  $("#aplicar-fidelidade-btn").addEventListener("click", () => {
    state.pedidoCupomAplicado = { codigo: "FIDELIDADE5", percentual: 5 };
    $("#pedido-cupom-select").value = ""; // é um cupom especial, fora da lista normal
    updatePedidoTotal();
    avisoEl.classList.add("hidden");
  });
  $("#recusar-fidelidade-btn").addEventListener("click", () => {
    cpfFidelidadeRecusado = cpf; // não pergunta de novo enquanto o CPF não mudar
    avisoEl.classList.add("hidden");
  });
});

$("#pedido-finalizar-btn").addEventListener("click", async () => {
  const errorEl = $("#pedido-error");
  errorEl.textContent = "";

  if (state.pedidoItens.length === 0) {
    errorEl.textContent = "Adiciona pelo menos um item no pedido.";
    return;
  }

  const body = {
    cliente: $("#pedido-cliente-input").value.trim(),
    cpf: $("#pedido-cpf-input").value.trim(),
    itens: state.pedidoItens.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade })),
    formaPagamento: $("#pedido-forma-pagamento-input").value,
    cupomCodigo: state.pedidoCupomAplicado ? state.pedidoCupomAplicado.codigo : null,
  };

  try {
    await apiFetch("/api/pedidos", { method: "POST", body: JSON.stringify(body) });
    state.pedidoItens = [];
    state.pedidoCupomAplicado = null;
    $("#pedido-cliente-input").value = "";
    $("#pedido-cpf-input").value = "";
    $("#pedido-cupom-select").value = "";
    $("#pedido-fiel-aviso").classList.add("hidden");
    renderPedidoItens();
    await loadAll();
  } catch (e) {
    errorEl.textContent = e.message;
  }
});

function jaDevolvidoPorItem(pedidoId) {
  const mapa = {};
  state.devolucoes
    .filter((d) => d.pedidoId === pedidoId)
    .forEach((d) => {
      d.itens.forEach((i) => {
        mapa[i.produtoId] = (mapa[i.produtoId] || 0) + i.quantidade;
      });
    });
  return mapa;
}

function totalDisponivelParaDevolucao(pedido) {
  const jaDevolvido = jaDevolvidoPorItem(pedido.id);
  return pedido.itens.reduce((acc, item) => {
    const restante = item.quantidade - (jaDevolvido[item.produtoId] || 0);
    return acc + Math.max(restante, 0);
  }, 0);
}

function renderPedidos() {
  const listEl = $("#pedidos-list");
  if (state.pedidos.length === 0) {
    listEl.innerHTML = '<div class="empty">Nenhum pedido ainda</div>';
    return;
  }
  const ordenado = [...state.pedidos].sort((a, b) => new Date(b.data) - new Date(a.data));
  listEl.innerHTML = ordenado
    .map((p) => {
      const disponivel = totalDisponivelParaDevolucao(p);
      return `
    <div class="list-item">
      <div class="li-top">
        <span class="li-desc">${escapeHtml(p.cliente || "Cliente não informado")}</span>
        <span class="li-value stat-high">${formatMoney(p.total)}</span>
      </div>
      <div class="li-meta">${new Date(p.data).toLocaleString("pt-BR")} · ${escapeHtml(p.formaPagamento)} · ${p.itens.length} item(ns)</div>
      ${disponivel > 0 ? `<div class="pedido-actions"><button class="devolver-btn" data-id="${p.id}">↩ Devolver</button></div>` : ""}
    </div>
  `;
    })
    .join("");

  listEl.querySelectorAll(".devolver-btn").forEach((btn) => {
    btn.addEventListener("click", () => openDevolucaoModal(btn.dataset.id));
  });
}

// ---------- Devoluções ----------
function openDevolucaoModal(pedidoId) {
  const pedido = state.pedidos.find((p) => p.id === pedidoId);
  if (!pedido) return;

  const jaDevolvido = jaDevolvidoPorItem(pedidoId);
  const container = $("#devolucao-itens-list");
  container.innerHTML = pedido.itens
    .map((item) => {
      const jaDevolvidoQtd = jaDevolvido[item.produtoId] || 0;
      const disponivel = item.quantidade - jaDevolvidoQtd;
      if (disponivel <= 0) return "";
      return `
      <div class="devolucao-item-row">
        <div class="di-top">
          <span>${escapeHtml(item.produto)}</span>
          <span class="di-disponivel">disponível: ${disponivel}</span>
        </div>
        <input type="number" min="0" max="${disponivel}" value="0" data-produto-id="${item.produtoId}" placeholder="Quantidade a devolver" />
      </div>
    `;
    })
    .join("");

  $("#devolucao-error").textContent = "";
  $("#devolucao-modal").classList.remove("hidden");
  $("#devolucao-confirm-btn").dataset.pedidoId = pedidoId;
}

$("#devolucao-cancel-btn").addEventListener("click", () => {
  $("#devolucao-modal").classList.add("hidden");
});

$("#devolucao-confirm-btn").addEventListener("click", async () => {
  const pedidoId = $("#devolucao-confirm-btn").dataset.pedidoId;
  const errorEl = $("#devolucao-error");
  errorEl.textContent = "";

  const itens = [...document.querySelectorAll("#devolucao-itens-list input")]
    .map((input) => ({ produtoId: input.dataset.produtoId, quantidade: parseFloat(input.value) || 0 }))
    .filter((i) => i.quantidade > 0);

  if (itens.length === 0) {
    errorEl.textContent = "Informe a quantidade de pelo menos um item pra devolver.";
    return;
  }

  try {
    const resultado = await apiFetch("/api/devolucoes", {
      method: "POST",
      body: JSON.stringify({ pedidoId, itens }),
    });
    $("#devolucao-modal").classList.add("hidden");
    await loadAll();
    alert(`Devolução registrada — R$ ${resultado.valorReembolsado.toFixed(2).replace(".", ",")} descontado do Caixa.`);
  } catch (e) {
    errorEl.textContent = e.message;
  }
});

function renderDevolucoes() {
  const listEl = $("#devolucoes-list");
  if (state.devolucoes.length === 0) {
    listEl.innerHTML = '<div class="empty">Nenhuma devolução registrada ainda</div>';
    return;
  }
  const ordenado = [...state.devolucoes].sort((a, b) => new Date(b.data) - new Date(a.data));
  listEl.innerHTML = ordenado
    .map((d) => {
      const itensStr = d.itens.map((i) => `${i.quantidade}x ${escapeHtml(i.produto)}`).join(", ");
      return `
      <div class="devolucao-list-item">
        <div class="li-top">
          <span class="li-desc">${itensStr}</span>
          <span class="li-value stat-low">- ${formatMoney(d.valorReembolsado)}</span>
        </div>
        <div class="li-meta">${new Date(d.data).toLocaleString("pt-BR")}</div>
      </div>
    `;
    })
    .join("");
}

// ---------- Configurações (categorias, com senha própria) ----------
function renderCategoriasChips() {
  const container = $("#categorias-chips");
  if (state.categorias.length === 0) {
    container.innerHTML = '<span class="hint">Nenhuma ainda</span>';
    return;
  }
  container.innerHTML = "";
  state.categorias.forEach((c) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<span>${escapeHtml(c.nome)}</span>`;
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", async () => {
      if (!confirm(`Remover a categoria "${c.nome}"?`)) return;
      try {
        await apiFetch("/api/categorias", {
          method: "DELETE",
          body: JSON.stringify({ id: c.id }),
          headers: { "x-admin-password": state.adminPassword },
        });
        await loadAll();
      } catch (e) {
        alert(`Erro ao remover: ${e.message}`);
      }
    });
    chip.appendChild(removeBtn);
    container.appendChild(chip);
  });
}

$("#config-unlock-btn").addEventListener("click", async () => {
  const senha = $("#config-password-input").value;
  const errorEl = $("#config-password-error");
  errorEl.textContent = "";
  if (!senha) return;
  try {
    await apiFetch("/api/verify-admin", { method: "POST", body: JSON.stringify({ senha }) });
    state.adminPassword = senha;
    sessionStorage.setItem("gestao_admin_password", senha);
    unlockAdminAreas();
  } catch (e) {
    errorEl.textContent = e.message === "unauthorized" ? "" : e.message || "Senha incorreta.";
    if (!errorEl.textContent) errorEl.textContent = "Senha incorreta.";
  }
});

$("#add-categoria-btn").addEventListener("click", async () => {
  const input = $("#categoria-input");
  const nome = input.value.trim();
  if (!nome) return;
  try {
    await apiFetch("/api/categorias", {
      method: "POST",
      body: JSON.stringify({ nome }),
      headers: { "x-admin-password": state.adminPassword },
    });
    input.value = "";
    await loadAll();
  } catch (e) {
    alert(`Erro ao adicionar: ${e.message}`);
  }
});

// se a pessoa já entrou nas Configurações (ou Cupons) antes nessa mesma
// sessão do navegador, não precisa digitar a senha de novo toda vez
const savedAdminPassword = sessionStorage.getItem("gestao_admin_password");
if (savedAdminPassword) {
  state.adminPassword = savedAdminPassword;
  unlockAdminAreas();
}

// ---------- Máscaras de moeda ----------
applyCurrencyMask($("#caixa-valor-input"));
applyCurrencyMask($("#estoque-custo-input"));
applyCurrencyMask($("#estoque-venda-input"));

// ---------- Clientes Fiéis ----------
function tierInfo(totalCompras) {
  if (totalCompras > 10) return { label: "Ouro", cls: "tier-ouro" };
  if (totalCompras > 5) return { label: "Prata", cls: "tier-prata" };
  if (totalCompras > 1) return { label: "Bronze", cls: "tier-bronze" };
  return null;
}

function renderClientesFieis() {
  const mais1 = state.clientesFieis.filter((c) => c.totalCompras > 1).length;
  const mais5 = state.clientesFieis.filter((c) => c.totalCompras > 5).length;
  const mais10 = state.clientesFieis.filter((c) => c.totalCompras > 10).length;
  $("#clientes-tier-1").textContent = mais1;
  $("#clientes-tier-5").textContent = mais5;
  $("#clientes-tier-10").textContent = mais10;

  const container = $("#clientes-rows");
  if (state.clientesFieis.length === 0) {
    container.innerHTML = '<tr><td colspan="6" class="empty">Nenhum cliente identificado por CPF ainda</td></tr>';
    return;
  }
  container.innerHTML = state.clientesFieis
    .map((c, idx) => {
      const tier = tierInfo(c.totalCompras);
      return `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(c.nome || "(sem nome)")}</td>
        <td>${escapeHtml(c.cpf)}</td>
        <td>${c.totalCompras}</td>
        <td>${formatMoney(c.totalGasto)}</td>
        <td>${tier ? `<span class="tier-badge ${tier.cls}">${tier.label}</span>` : "—"}</td>
      </tr>
    `;
    })
    .join("");
}

// ---------- Cupons ----------
function renderCuponsList() {
  const container = $("#cupons-list");
  if (state.cupons.length === 0) {
    container.innerHTML = '<div class="empty">Nenhum cupom criado ainda</div>';
    return;
  }
  container.innerHTML = state.cupons
    .map(
      (c) => `
    <div class="cupom-item">
      <span><span class="cupom-codigo">${escapeHtml(c.codigo)}</span><span class="cupom-pct">-${c.percentual}%</span></span>
      <button data-id="${c.id}">✕</button>
    </div>
  `
    )
    .join("");
  container.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remover esse cupom?")) return;
      try {
        await apiFetch("/api/cupons", {
          method: "DELETE",
          body: JSON.stringify({ id: btn.dataset.id }),
          headers: { "x-admin-password": state.adminPassword },
        });
        await loadAll();
      } catch (e) {
        alert(`Erro ao remover: ${e.message}`);
      }
    });
  });
}

$("#add-cupom-btn").addEventListener("click", async () => {
  const codigo = $("#cupom-codigo-input").value.trim();
  const percentual = parseFloat($("#cupom-percentual-input").value);
  if (!codigo) {
    alert("Digite o código do cupom.");
    return;
  }
  if (!percentual || percentual <= 0 || percentual > 100) {
    alert("Percentual precisa ser entre 1 e 100.");
    return;
  }
  try {
    await apiFetch("/api/cupons", {
      method: "POST",
      body: JSON.stringify({ codigo, percentual }),
      headers: { "x-admin-password": state.adminPassword },
    });
    $("#cupom-codigo-input").value = "";
    $("#cupom-percentual-input").value = "";
    await loadAll();
  } catch (e) {
    alert(`Erro ao criar cupom: ${e.message}`);
  }
});

// a aba Cupons usa a MESMA senha de administrador das Configurações
$("#cupons-unlock-btn").addEventListener("click", async () => {
  const senha = $("#cupons-password-input").value;
  const errorEl = $("#cupons-password-error");
  errorEl.textContent = "";
  if (!senha) return;
  try {
    await apiFetch("/api/verify-admin", { method: "POST", body: JSON.stringify({ senha }) });
    state.adminPassword = senha;
    sessionStorage.setItem("gestao_admin_password", senha);
    unlockAdminAreas();
  } catch (e) {
    errorEl.textContent = e.message === "unauthorized" ? "Senha incorreta." : e.message || "Senha incorreta.";
  }
});

function unlockAdminAreas() {
  $("#config-lock-card").classList.add("hidden");
  $("#config-content").classList.remove("hidden");
  $("#cupons-lock-card").classList.add("hidden");
  $("#cupons-content").classList.remove("hidden");
}

// ---------- Backup ----------
$("#backup-btn").addEventListener("click", async () => {
  const statusEl = $("#backup-status");
  statusEl.textContent = "Preparando o backup...";

  try {
    const res = await fetch("/api/backup", {
      headers: {
        "x-app-password": getPassword(),
        "x-admin-password": state.adminPassword || "",
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Erro do servidor (HTTP ${res.status})`);
    }

    const blob = await res.blob();
    const nomeArquivo = `backup-negocio-${new Date().toISOString().slice(0, 10)}.db`;

    if (window.showSaveFilePicker) {
      // Chrome/Edge: abre a janela de verdade de "Salvar como", com escolha de pasta
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: nomeArquivo,
          types: [{ description: "Banco de dados", accept: { "application/octet-stream": [".db"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        statusEl.textContent = "✔ Backup salvo com sucesso!";
        return;
      } catch (pickerErr) {
        if (pickerErr.name === "AbortError") {
          statusEl.textContent = ""; // a pessoa cancelou a janela, sem problema
          return;
        }
        console.error(pickerErr);
        // se der outro erro no seletor, cai pro jeito simples abaixo
      }
    }

    // Firefox/Safari (ou fallback): baixa pela pasta padrão de Downloads
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    statusEl.textContent = "✔ Backup baixado pra pasta de Downloads.";
  } catch (e) {
    statusEl.textContent = `Erro ao baixar backup: ${e.message}`;
  }
});

// ---------- Relógio e data na sidebar ----------
function updateClock() {
  const now = new Date();
  const dataEl = $("#sidebar-date");
  const clockEl = $("#sidebar-clock");
  if (dataEl) {
    dataEl.textContent = now.toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }
  if (clockEl) {
    clockEl.textContent = now.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
}
updateClock();
setInterval(updateClock, 1000);

// ---------- Lembrete de backup a cada 7 dias ----------
const BACKUP_REMINDER_KEY = "gestao_last_backup_reminder";
const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

function checkBackupReminder() {
  const last = parseInt(localStorage.getItem(BACKUP_REMINDER_KEY), 10);
  const agora = Date.now();
  if (!last) {
    // primeira vez que o app abre — começa a contar a partir de agora
    localStorage.setItem(BACKUP_REMINDER_KEY, String(agora));
    return;
  }
  if (agora - last >= SETE_DIAS_MS) {
    $("#backup-reminder-modal").classList.remove("hidden");
  }
}

function dismissBackupReminder() {
  localStorage.setItem(BACKUP_REMINDER_KEY, String(Date.now()));
  $("#backup-reminder-modal").classList.add("hidden");
}

$("#backup-reminder-later-btn").addEventListener("click", dismissBackupReminder);

$("#backup-reminder-go-btn").addEventListener("click", () => {
  dismissBackupReminder();
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
  document.querySelectorAll('.tab-btn[data-tab="configuracoes"]').forEach((b) => b.classList.add("active"));
  $("#tab-configuracoes").classList.add("active");
});

// ---------- Init ----------
if (getPassword()) {
  apiFetch("/api/caixa")
    .then(() => showApp())
    .catch(() => showLogin());
} else {
  showLogin();
}
