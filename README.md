# Gestão do Negócio — Versão Local

Roda inteiramente no computador do cliente, sem depender de nuvem. Usa
**SQLite** (um arquivo de banco de dados só, sem precisar instalar nada
separado) e se atualiza sozinho quando você publica uma versão nova.

## O que você (quem instala) precisa fazer, uma vez por cliente

### Passo 1 — Instalar o Node.js no computador do cliente

1. Acessa **https://nodejs.org** naquele computador
2. Baixa a versão **LTS** (a recomendada) e instala normalmente (Next, Next, Finish)

### Passo 2 — Copiar o programa pro computador

1. Copia essa pasta inteira (`gestao-negocio-local`) pro computador do
   cliente — pode ser por pendrive, ou baixando do seu repositório do
   GitHub
2. Dá dois cliques no arquivo **`instalar.bat`**
3. Espera terminar (só demora na primeira vez)

### Passo 3 — Ligar o programa

1. Dá dois cliques em **`iniciar.bat`**
2. Uma janela preta abre e mostra um link tipo `http://localhost:3000`
3. Abre esse link no navegador (Chrome, Edge, etc.)
4. **Não fecha a janela preta** — ela precisa ficar aberta rodando o
   programa. Pode minimizar ela.

### Passo 4 — Deixar ligando sozinho com o Windows (recomendado)

Pra não precisar abrir manualmente todo dia:

1. Aperta `Win + R`, digita `shell:startup` e aperta Enter — abre uma pasta
2. Copia um **atalho** do `iniciar.bat` pra dentro dessa pasta
3. Pronto — a partir de agora, o programa liga sozinho quando o Windows
   inicia

## Como funciona a atualização automática

1. No `.env` (dentro da pasta do programa, abre com o Bloco de Notas),
   preenche `UPDATE_REPO=seu-usuario/gestao-negocio-local` (o nome do seu
   repositório no GitHub, onde você publica as versões novas)
2. Toda vez que o programa **inicia**, ele confere sozinho se você
   publicou uma versão mais nova ali
3. Se tiver, baixa e aplica **sem apagar os dados do cliente** (o banco de
   dados fica numa pasta separada, `data/`, que a atualização nunca toca)
4. Como o programa liga sozinho com o Windows (Passo 4), a atualização
   acontece sozinha na próxima vez que o computador for religado — você não
   precisa visitar o cliente de novo

### Como você publica uma atualização nova (do seu lado)

1. Faz as mudanças no código
2. No GitHub, vai em **"Releases"** → **"Draft a new release"**
3. Cria uma **tag** nova, tipo `v1.1.0` (sempre maior que a anterior)
4. Anexa um arquivo `.zip` com o conteúdo atualizado da pasta do projeto
   (sem a pasta `node_modules` nem `data`)
5. Publica o release

Na próxima vez que cada cliente ligar o computador, a versão nova é
aplicada sozinha.

## Estrutura de pastas

```
gestao-negocio-local/
  src/           → código do servidor
  public/        → a telinha do app (HTML/CSS/JS)
  data/          → o banco de dados do cliente (criado sozinho, NUNCA mexer)
  version.json   → controla a versão instalada
  .env           → configurações desse computador (senha, repositório de atualização)
```

## Sobre a senha

Se quiser proteger o app com senha (útil se o PC for compartilhado),
preenche `APP_PASSWORD=algumasenha` no `.env`. Se deixar em branco, o app
abre direto sem pedir senha.
