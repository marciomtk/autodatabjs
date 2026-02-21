/**
 * automacao.js — Beija-Flor ERP
 * Suporta cancelamento seguro via sinal externo (parar())
 */

const puppeteer = require("puppeteer");

const SITE_URL =
  process.env.SITE_URL || "https://revenda.beijaflorerp.com.br/Home/Login";
const LOGIN_USER = process.env.LOGIN_USER || "marcio";
const LOGIN_PASS = process.env.LOGIN_PASS || "231989mtk";

const SEL = {
  campoUsuario: "input[name='Login']",
  campoSenha: "input[name='Senha']",
  botaoLogin: "#btnEnviar",
  tabelaLinhas: "#revendas tbody tr[role='row']",
  campoDelta: "#ValidadeLicenca",
  botaoSalvar: "#btnGravar",
};

// ── Sinal de cancelamento ──────────────────────────────────────
// O server.js chama cancelar() para pedir parada.
// A automação verifica deveParar() a cada iteração.
let _parar = false;
function cancelar() {
  _parar = true;
}
function deveParar() {
  return _parar;
}
function resetarSinal() {
  _parar = false;
}

function calcularNovaData() {
  const hoje = new Date();
  const proximo = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 20);
  return `20/${String(proximo.getMonth() + 1).padStart(2, "0")}/${proximo.getFullYear()}`;
}

function deveEditarData(dataAtualBruta) {
  const dataSomente = (dataAtualBruta || "").split(" ")[0].trim();
  if (!dataSomente) return false;
  const partes = dataSomente.split("/");
  if (partes.length !== 3) return false;
  const dia = parseInt(partes[0], 10);
  const mes = parseInt(partes[1], 10);
  const ano = parseInt(partes[2], 10);
  const hoje = new Date();
  return (
    dia === 20 && mes === hoje.getMonth() + 1 && ano === hoje.getFullYear()
  );
}

async function irPara(page, url, seletorEsperar) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (seletorEsperar) {
    await page.waitForSelector(seletorEsperar, { timeout: 30000 });
  }
}

async function executarAutomacao(onLog) {
  resetarSinal(); // garante que começa sem sinal de parada

  const log = (msg, tipo = "info") => {
    console.log(`[${tipo.toUpperCase()}] ${msg}`);
    onLog({ msg, tipo, hora: new Date().toLocaleTimeString("pt-BR") });
  };

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  );
  page.setDefaultTimeout(60000);

  let sucesso = 0;
  let pulados = 0;
  let falha = 0;
  let parado = false;

  const novaData = calcularNovaData();
  log(`📅 Nova data que será aplicada: ${novaData}`);

  try {
    // ── Login ──────────────────────────────────────────────────
    log("🌐 Abrindo Beija-Flor ERP...");
    await page.goto(SITE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(SEL.campoUsuario);

    log("🔑 Fazendo login — usuário: " + LOGIN_USER);
    await page.type(SEL.campoUsuario, LOGIN_USER, { delay: 80 });
    await page.type(SEL.campoSenha, LOGIN_PASS, { delay: 80 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
      page.click(SEL.botaoLogin),
    ]);
    log("✅ Login realizado!", "sucesso");

    // ── Meus Clientes ──────────────────────────────────────────
    log("📋 Abrindo Meus Clientes...");
    await irPara(
      page,
      "https://revenda.beijaflorerp.com.br/MeusClientes",
      SEL.tabelaLinhas,
    );
    await new Promise((r) => setTimeout(r, 2000));
    log("✅ Lista carregada!", "sucesso");

    // ── Coletar registros ──────────────────────────────────────
    const registros = await page.$$eval(SEL.tabelaLinhas, (rows) =>
      rows
        .map((tr) => {
          const colunas = tr.querySelectorAll("td");
          const situacao = colunas[0] ? colunas[0].innerText.trim() : "";
          const nome = colunas[3] ? colunas[3].innerText.trim() : "";
          const linkEdit = tr.querySelector("a[href*='/MeusClientes/Editar/']");
          return { situacao, nome, url: linkEdit ? linkEdit.href : null };
        })
        .filter((r) => r.url),
    );

    const total = registros.length;
    log(`📊 ${total} cliente(s) encontrado(s).`);

    if (total === 0) {
      log("⚠️  Nenhum cliente encontrado.", "aviso");
      return { sucesso: 0, pulados: 0, falha: 0, total: 0, parado: false };
    }

    const contSituacoes = registros.reduce((acc, r) => {
      acc[r.situacao] = (acc[r.situacao] || 0) + 1;
      return acc;
    }, {});
    Object.entries(contSituacoes).forEach(([sit, qtd]) =>
      log(`   ${sit}: ${qtd} cliente(s)`),
    );

    // ── Loop principal ─────────────────────────────────────────
    for (let i = 0; i < registros.length; i++) {
      // ✋ Verifica sinal de parada ANTES de cada cliente
      if (deveParar()) {
        parado = true;
        log(
          `✋ Automação interrompida pelo usuário após ${i} cliente(s).`,
          "aviso",
        );
        break;
      }

      const { situacao, nome, url } = registros[i];
      const nomeLabel = nome ? ` ${nome}` : "";
      log(
        `── Cliente ${i + 1}${nomeLabel} / ${total} — Situação: "${situacao}"`,
      );

      if (situacao.toLowerCase() !== "ativa") {
        log(`  ⏭️  Pulado — situação: "${situacao}"`, "aviso");
        pulados++;
        continue;
      }

      try {
        await irPara(page, url, SEL.campoDelta);

        const dataAtualBruta = await page.$eval(
          SEL.campoDelta,
          (el) => el.value,
        );

        if (!deveEditarData(dataAtualBruta)) {
          log(
            `  ⏭️  Pulado — validade "${dataAtualBruta}" não é dia 20 do mês atual`,
            "aviso",
          );
          pulados++;
          continue;
        }

        await page.click(SEL.campoDelta, { clickCount: 3 });
        await page.keyboard.press("Delete");
        await page.type(SEL.campoDelta, novaData, { delay: 30 });
        log(`  📅 "${dataAtualBruta}" → "${novaData}"`);

        await Promise.all([
          page
            .waitForNavigation({
              waitUntil: "domcontentloaded",
              timeout: 30000,
            })
            .catch(() => {}),
          page.click(SEL.botaoSalvar),
        ]);

        log(`  ✅ Salvo!`, "sucesso");
        sucesso++;

        await new Promise((r) => setTimeout(r, 800));
      } catch (err) {
        log(`  ❌ Erro: ${err.message}`, "erro");
        falha++;
        await page.keyboard.press("Escape").catch(() => {});
      }
    }

    log("─".repeat(45));
    if (parado) {
      log(`✋ Interrompido pelo usuário.`, "aviso");
    } else {
      log(`🏁 Concluído com sucesso!`);
    }
    log(`   ✅ Atualizados : ${sucesso}`);
    log(`   ⏭️  Pulados     : ${pulados}`);
    log(`   ❌ Erros        : ${falha}`);
    log(
      `   📊 Processados  : ${sucesso + pulados + falha} de ${registros.length}`,
    );
  } catch (err) {
    log(`💥 Erro crítico: ${err.message}`, "erro");
    throw err;
  } finally {
    await browser.close();
  }

  return { sucesso, pulados, falha, total: sucesso + pulados + falha, parado };
}

module.exports = { executarAutomacao, cancelar };
