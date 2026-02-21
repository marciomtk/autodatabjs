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

app.listen(PORT, () => {
  console.log(`✅ Backend rodando em http://localhost:${PORT}`);
});
