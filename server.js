require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { executarAutomacao, cancelar } = require("./automacao");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

let estado = {
  rodando: false,
  resultado: null,
  logs: [],
};

function adicionarLog(entrada) {
  estado.logs.push(entrada);
}

// Retorna status + todos os logs a partir de um índice
// O frontend chama isso a cada 1 segundo passando o último índice que já tem
app.get("/api/status", (req, res) => {
  const from = parseInt(req.query.from || "0", 10);
  res.json({
    ok: true,
    rodando: estado.rodando,
    resultado: estado.resultado,
    logs: estado.logs.slice(from), // só envia logs novos
    total: estado.logs.length,
  });
});

app.post("/api/executar", async (req, res) => {
  if (estado.rodando) {
    return res.status(409).json({ erro: "Automação já está em execução!" });
  }

  estado.rodando = true;
  estado.resultado = null;
  estado.logs = [];

  res.json({ ok: true, msg: "Automação iniciada!" });

  try {
    const resultado = await executarAutomacao(adicionarLog);
    estado.resultado = resultado;
  } catch (err) {
    estado.resultado = { erro: err.message };
  } finally {
    estado.rodando = false;
  }
});

app.post("/api/parar", (req, res) => {
  if (!estado.rodando) {
    return res.status(400).json({ erro: "Nenhuma automação em execução." });
  }
  cancelar();
  res.json({ ok: true, msg: "Sinal de parada enviado." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Backend rodando em http://0.0.0.0:${PORT}`);
});

// Endpoint para streaming de logs via SSE
app.get("/api/logs/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let lastIndex = 0;

  const sendLogs = () => {
    if (lastIndex < estado.logs.length) {
      const novosLogs = estado.logs.slice(lastIndex);
      res.write(`data: ${JSON.stringify(novosLogs)}\n\n`);
      lastIndex = estado.logs.length;
    }
  };

  const interval = setInterval(sendLogs, 1000);

  req.on("close", () => {
    clearInterval(interval);
    res.end();
  });
});
