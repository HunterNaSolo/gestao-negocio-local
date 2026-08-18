const $ = (sel) => document.querySelector(sel);

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatMoney(v) {
  return `R$ ${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

let state = { caixa: [], estoque: [], pedidos: [], pedidoItens: [] };

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
    const [caixaData, estoqueData, pedidosData] = await Promise.all([
      apiFetch("/api/caixa"),
      apiFetch("/api/estoque"),
      apiFetch("/api/pedidos"),
    ]);
    state.caixa = caixaData.entradas || [];
    state.caixaSaldo = caixaData.saldo || 0;
    state.estoque = estoqueData.produtos || [];
    state.pedidos = pedidosData.pedidos || [];
  } catch (e) {
    console.error(e);
  }
  renderCaixa();
  renderEstoque();
  renderPedidos();
  renderResumo();
  populatePedidoProdutoSelect();
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
  const valor = parseFloat($("#caixa-valor-input").value);

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
    categoria: $("#estoque-categoria-input").value.trim(),
    quantidade: parseFloat($("#estoque-quantidade-input").value) || 0,
    precoCusto: parseFloat($("#estoque-custo-input").value) || 0,
    precoVenda: parseFloat($("#estoque-venda-input").value) || 0,
    estoqueMinimo: parseFloat($("#estoque-minimo-input").value) || 0,
  };

  try {
    await apiFetch("/api/estoque", { method: "POST", body: JSON.stringify(body) });
    $("#estoque-produto-input").value = "";
    $("#estoque-categoria-input").value = "";
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
  const total = state.pedidoItens.reduce((acc, i) => acc + i.precoUnit * i.quantidade, 0);
  $("#pedido-total").textContent = formatMoney(total);
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

$("#pedido-finalizar-btn").addEventListener("click", async () => {
  const errorEl = $("#pedido-error");
  errorEl.textContent = "";

  if (state.pedidoItens.length === 0) {
    errorEl.textContent = "Adiciona pelo menos um item no pedido.";
    return;
  }

  const body = {
    cliente: $("#pedido-cliente-input").value.trim(),
    itens: state.pedidoItens.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade })),
    formaPagamento: $("#pedido-forma-pagamento-input").value,
  };

  try {
    await apiFetch("/api/pedidos", { method: "POST", body: JSON.stringify(body) });
    state.pedidoItens = [];
    $("#pedido-cliente-input").value = "";
    renderPedidoItens();
    await loadAll();
  } catch (e) {
    errorEl.textContent = e.message;
  }
});

function renderPedidos() {
  const listEl = $("#pedidos-list");
  if (state.pedidos.length === 0) {
    listEl.innerHTML = '<div class="empty">Nenhum pedido ainda</div>';
    return;
  }
  const ordenado = [...state.pedidos].sort((a, b) => new Date(b.data) - new Date(a.data));
  listEl.innerHTML = ordenado
    .map(
      (p) => `
    <div class="list-item">
      <div class="li-top">
        <span class="li-desc">${escapeHtml(p.cliente || "Cliente não informado")}</span>
        <span class="li-value stat-high">${formatMoney(p.total)}</span>
      </div>
      <div class="li-meta">${new Date(p.data).toLocaleString("pt-BR")} · ${escapeHtml(p.formaPagamento)} · ${p.itens.length} item(ns)</div>
    </div>
  `
    )
    .join("");
}

// ---------- Init ----------
if (getPassword()) {
  apiFetch("/api/caixa")
    .then(() => showApp())
    .catch(() => showLogin());
} else {
  showLogin();
}
