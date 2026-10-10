(function (global) {
  var STORAGE_KEY = "compositor-suno-llm";
  var GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
  var DEFAULT_MODEL = "llama-3.3-70b-versatile";

  function readInput(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || "").trim() : "";
  }

  function writeInput(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = value || "";
  }

  function loadLlm() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return { model: "", hasKey: false, apiKey: "" };
      var data = JSON.parse(raw);
      return {
        model: String(data.model || "").trim(),
        hasKey: Boolean(data.apiKey && String(data.apiKey).trim()),
        apiKey: String(data.apiKey || "").trim(),
      };
    } catch (err) {
      return { model: "", hasKey: false, apiKey: "" };
    }
  }

  function saveLlm(apiKey, model) {
    var cleanedModel = String(model || "").trim();
    if (!cleanedModel) {
      return { ok: false, message: "Escribí el nombre del modelo (ej. llama-3.3-70b-versatile)." };
    }
    var cleanedKey = String(apiKey || "").trim();
    if (!cleanedKey) {
      return { ok: false, message: "Pegá tu API key de Groq antes de guardar." };
    }
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        model: cleanedModel,
        apiKey: cleanedKey,
        savedAt: Date.now(),
      })
    );
    updateStatusLine();
    return { ok: true, message: "Guardado en esta pestaña (sessionStorage). No se sube a GitHub." };
  }

  function clearLlm() {
    sessionStorage.removeItem(STORAGE_KEY);
    updateStatusLine();
  }

  function getLlmForRequest() {
    var stored = loadLlm();
    var domKey = readInput("llm_api_key");
    var domModel = readInput("llm_model");
    return {
      apiKey: stored.apiKey || domKey,
      model: stored.model || domModel,
      fromStorage: Boolean(stored.hasKey && stored.apiKey),
    };
  }

  function updateStatusLine() {
    var line = document.getElementById("llm-pages-status");
    if (!line) return;
    var stored = loadLlm();
    var model = stored.model || readInput("llm_model") || DEFAULT_MODEL;
    var keyLabel = stored.hasKey ? "configurada" : "falta key";
    line.textContent = "Modelo: " + model + " · Key: " + keyLabel;
  }

  function restoreToForm() {
    var stored = loadLlm();
    if (stored.model) writeInput("llm_model", stored.model);
    else if (!readInput("llm_model")) writeInput("llm_model", DEFAULT_MODEL);
    if (stored.apiKey) writeInput("llm_api_key", stored.apiKey);
    updateStatusLine();
  }

  function saveFromForm() {
    var result = saveLlm(readInput("llm_api_key"), readInput("llm_model"));
    var status = document.getElementById("llm-pages-save-status");
    if (status) status.textContent = result.message || "";
    return result;
  }

  function groqFetch(body) {
    return fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + body.apiKey,
      },
      body: JSON.stringify({
        model: body.model,
        temperature: 0,
        max_tokens: 8,
        messages: [{ role: "user", content: "Responde solo: ok" }],
      }),
    });
  }

  function probeGroq() {
    var cfg = getLlmForRequest();
    if (!cfg.apiKey || !cfg.model) {
      return Promise.resolve({
        ok: false,
        message: "Pegá API key y modelo, guardá, y probá de nuevo.",
      });
    }
    return groqFetch(cfg)
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, status: response.status, data: data };
        });
      })
      .then(function (result) {
        if (result.ok) {
          return { ok: true, message: "Conexión OK con Groq (" + cfg.model + ")." };
        }
        var errMsg =
          (result.data && result.data.error && result.data.error.message) ||
          "Groq rechazó la petición (HTTP " + result.status + ").";
        if (result.status === 401) {
          errMsg = "API key inválida o vencida. Creá una nueva en console.groq.com/keys.";
        }
        return { ok: false, message: errMsg };
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        if (/failed to fetch|networkerror|load failed/i.test(msg)) {
          return {
            ok: false,
            message:
              "No se pudo contactar a Groq desde el navegador (CORS o red). " +
              "Usá la app local en http://127.0.0.1:8000/guia/workflow donde el LLM va por el servidor.",
            cors: true,
          };
        }
        return { ok: false, message: msg };
      });
  }

  function bindUi() {
    var saveBtn = document.getElementById("llm-pages-save");
    var probeBtn = document.getElementById("llm-pages-probe");
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        saveFromForm();
      });
    }
    if (probeBtn) {
      probeBtn.addEventListener("click", function () {
        var status = document.getElementById("llm-pages-save-status");
        if (status) status.textContent = "Probando…";
        probeBtn.disabled = true;
        probeGroq()
          .then(function (result) {
            if (status) status.textContent = result.message;
          })
          .then(function () {
            probeBtn.disabled = false;
          });
      });
    }
    var modelInput = document.getElementById("llm_model");
    if (modelInput) {
      modelInput.addEventListener("input", updateStatusLine);
    }
  }

  bindUi();

  global.PagesLlm = {
    loadLlm: loadLlm,
    saveLlm: saveLlm,
    clearLlm: clearLlm,
    getLlmForRequest: getLlmForRequest,
    restoreToForm: restoreToForm,
    saveFromForm: saveFromForm,
    probeGroq: probeGroq,
    updateStatusLine: updateStatusLine,
    DEFAULT_MODEL: DEFAULT_MODEL,
  };
})(window);
