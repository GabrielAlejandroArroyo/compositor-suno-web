(function (global) {
  var STORAGE_KEY = "compositor-suno-llm";
  var GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
  var GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";
  var DEFAULT_MODEL = "llama-3.3-70b-versatile";
  var NON_CHAT = ["whisper", "prompt-guard", "llama-guard", "tts", "orpheus", "playai"];

  function readInput(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || "").trim() : "";
  }

  function writeInput(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = value || "";
  }

  function setProbeEnabled(enabled) {
    var probeBtn = document.getElementById("llm-pages-probe");
    if (probeBtn) probeBtn.disabled = !enabled;
  }

  function showManualModelFallback(show) {
    var manual = document.getElementById("llm_model_manual");
    var label = document.getElementById("llm_model_manual_label");
    var select = document.getElementById("llm_model");
    if (manual) manual.hidden = !show;
    if (label) label.hidden = !show;
    if (select && show) select.disabled = true;
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
      return { ok: false, message: "Elegí un modelo de la lista." };
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
    setProbeEnabled(false);
  }

  function getSelectedModel() {
    var manual = document.getElementById("llm_model_manual");
    if (manual && !manual.hidden && manual.value.trim()) {
      return manual.value.trim();
    }
    return readInput("llm_model");
  }

  function getLlmForRequest() {
    var stored = loadLlm();
    var domKey = readInput("llm_api_key");
    var domModel = getSelectedModel();
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
    var model = stored.model || getSelectedModel() || "—";
    var keyLabel = stored.hasKey ? "configurada" : "falta key";
    line.textContent = "Modelo: " + model + " · Key: " + keyLabel;
  }

  function idsFromPayload(payload) {
    var raw = (payload && payload.data) || (payload && payload.models) || [];
    var names = [];
    raw.forEach(function (item) {
      if (typeof item === "string") names.push(item);
      else if (item && typeof item === "object") {
        names.push(String(item.id || item.name || item.model || ""));
      }
    });
    return names.filter(Boolean);
  }

  function filterChatModels(names) {
    var kept = names.filter(function (name) {
      var lower = name.toLowerCase();
      return !NON_CHAT.some(function (token) {
        return lower.indexOf(token) !== -1;
      });
    });
    return kept.length ? kept : names;
  }

  function renderModelSelect(names, selectedId) {
    var select = document.getElementById("llm_model");
    if (!select) return;
    showManualModelFallback(false);
    select.disabled = false;
    select.innerHTML = "";
    if (!names.length) {
      var empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "No hay modelos en la respuesta";
      select.appendChild(empty);
      setProbeEnabled(false);
      return;
    }
    var selected = selectedId || DEFAULT_MODEL;
    var hasSelected = false;
    names.forEach(function (id) {
      var opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      if (id === selected) {
        opt.selected = true;
        hasSelected = true;
      }
      select.appendChild(opt);
    });
    if (selected && !hasSelected && names.indexOf(selected) === -1) {
      var extra = document.createElement("option");
      extra.value = selected;
      extra.textContent = selected + " (guardado)";
      extra.selected = true;
      select.insertBefore(extra, select.firstChild);
      hasSelected = true;
    }
    if (!hasSelected && select.options.length) {
      select.options[0].selected = true;
    }
    setProbeEnabled(Boolean(select.value));
    updateStatusLine();
  }

  function fetchGroqModels(apiKey, selectedId) {
    var status = document.getElementById("llm-pages-save-status");
    var refreshBtn = document.getElementById("llm-pages-refresh-models");
    if (status) status.textContent = "Cargando modelos disponibles…";
    if (refreshBtn) refreshBtn.disabled = true;
    setProbeEnabled(false);

    return fetch(GROQ_MODELS_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + apiKey,
      },
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, status: response.status, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          var errMsg =
            (result.data && result.data.error && result.data.error.message) ||
            "No se pudo listar modelos (HTTP " + result.status + ").";
          if (result.status === 401) {
            errMsg = "API key inválida o vencida al listar modelos.";
          }
          if (status) status.textContent = errMsg;
          showManualModelFallback(true);
          var manual = document.getElementById("llm_model_manual");
          if (manual && selectedId) manual.value = selectedId;
          setProbeEnabled(Boolean(readInput("llm_model_manual")));
          return { ok: false, message: errMsg };
        }
        var names = filterChatModels(idsFromPayload(result.data)).sort();
        renderModelSelect(names, selectedId || readInput("llm_model") || DEFAULT_MODEL);
        if (status) status.textContent = names.length + " modelos disponibles. Elegí uno y probá la conexión.";
        return { ok: true, models: names };
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        if (/failed to fetch|networkerror|load failed/i.test(msg)) {
          msg =
            "No se pudo listar modelos desde el navegador (CORS). Podés escribir el modelo a mano abajo o usar la app local.";
        }
        if (status) status.textContent = msg;
        showManualModelFallback(true);
        var manual = document.getElementById("llm_model_manual");
        if (manual) {
          if (selectedId) manual.value = selectedId;
          else if (!manual.value) manual.value = DEFAULT_MODEL;
        }
        setProbeEnabled(Boolean(readInput("llm_model_manual")));
        return { ok: false, message: msg, cors: true };
      })
      .then(function (out) {
        if (refreshBtn) refreshBtn.disabled = false;
        return out;
      });
  }

  function restoreToForm() {
    var stored = loadLlm();
    if (stored.apiKey) writeInput("llm_api_key", stored.apiKey);
    updateStatusLine();
    if (stored.hasKey && stored.apiKey) {
      fetchGroqModels(stored.apiKey, stored.model || DEFAULT_MODEL);
    } else {
      var select = document.getElementById("llm_model");
      if (select) {
        select.disabled = true;
        select.innerHTML =
          '<option value="">Guardá la API key para cargar modelos…</option>';
      }
      setProbeEnabled(false);
    }
  }

  function saveFromForm() {
    var key = readInput("llm_api_key");
    var model = getSelectedModel() || DEFAULT_MODEL;
    var result = saveLlm(key, model);
    var status = document.getElementById("llm-pages-save-status");
    if (!result.ok) {
      if (status) status.textContent = result.message || "";
      return Promise.resolve(result);
    }
    if (status) status.textContent = result.message + " Cargando modelos…";
    return fetchGroqModels(key, model).then(function (fetchResult) {
      if (fetchResult.ok && fetchResult.models && fetchResult.models.length) {
        var picked = getSelectedModel() || fetchResult.models[0];
        saveLlm(key, picked);
      }
      return result;
    });
  }

  function refreshModelsFromStorage() {
    var stored = loadLlm();
    var key = readInput("llm_api_key") || stored.apiKey;
    if (!key) {
      var status = document.getElementById("llm-pages-save-status");
      if (status) status.textContent = "Pegá y guardá la API key primero.";
      return Promise.resolve({ ok: false });
    }
    return fetchGroqModels(key, getSelectedModel() || stored.model || DEFAULT_MODEL);
  }

  function persistModelSelection() {
    var stored = loadLlm();
    var key = readInput("llm_api_key") || stored.apiKey;
    var model = getSelectedModel();
    if (!key || !model) return;
    saveLlm(key, model);
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
    persistModelSelection();
    var cfg = getLlmForRequest();
    if (!cfg.apiKey || !cfg.model) {
      return Promise.resolve({
        ok: false,
        message: "Pegá API key, guardá, elegí un modelo de la lista y probá de nuevo.",
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
    var refreshBtn = document.getElementById("llm-pages-refresh-models");
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        saveFromForm();
      });
    }
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        refreshModelsFromStorage();
      });
    }
    if (probeBtn) {
      probeBtn.disabled = true;
      probeBtn.addEventListener("click", function () {
        var status = document.getElementById("llm-pages-save-status");
        if (status) status.textContent = "Probando…";
        probeBtn.disabled = true;
        probeGroq()
          .then(function (result) {
            if (status) status.textContent = result.message;
          })
          .then(function () {
            setProbeEnabled(Boolean(getSelectedModel() && (loadLlm().apiKey || readInput("llm_api_key"))));
          });
      });
    }
    var modelSelect = document.getElementById("llm_model");
    if (modelSelect) {
      modelSelect.addEventListener("change", function () {
        persistModelSelection();
        setProbeEnabled(Boolean(modelSelect.value));
        updateStatusLine();
      });
    }
    var manual = document.getElementById("llm_model_manual");
    if (manual) {
      manual.addEventListener("input", function () {
        updateStatusLine();
        setProbeEnabled(Boolean(manual.value.trim() && (loadLlm().apiKey || readInput("llm_api_key"))));
      });
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
    fetchGroqModels: fetchGroqModels,
    probeGroq: probeGroq,
    updateStatusLine: updateStatusLine,
    DEFAULT_MODEL: DEFAULT_MODEL,
  };
})(window);
