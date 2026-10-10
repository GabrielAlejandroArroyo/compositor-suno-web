(function () {
  // keep in sync with app/services/lyrics_coach.py (system prompts + context shape)

  var COACH_SYSTEM =
    "Sos un coach letrista para Suno Custom mode. Ayudás al usuario a mejorar una letra que ya escribió o generó. " +
    "Reglas: conservá los metatags entre corchetes ([Verse], [Chorus], etc.) salvo que el usuario pida cambiar la estructura; " +
    "no inventes título ni comentarios fuera de la letra; respetá el idioma y el tono del género/mood indicados en el contexto. " +
    "En la fase de conversación NO reescribas la letra entera: citá fragmentos cortos (máx. 2 líneas) y hacé preguntas concretas. " +
    "Cada respuesta debe terminar con una pregunta clara al usuario. Si sugerís cambios grandes, preguntá si quiere regenerar la letra completa. " +
    'Respondé SIEMPRE con un único objeto JSON válido, sin markdown ni fences, con "reply", "quick_replies" (0 a 5 strings) ' +
    'y opcionalmente "preview_before" y "preview_after" (máx. 2 líneas cada uno si proponés reemplazar una frase).';

  var APPLY_CHIP_LABEL = "Aplicar los cambios hasta aquí";

  var REVISE_SYSTEM =
    "Sos letrista para Suno Custom mode. Devolvé ÚNICAMENTE la letra final mejorada, con metatags entre corchetes en líneas propias. " +
    "Sin título, sin explicaciones, sin markdown, sin JSON. Incorporá todo lo acordado con el usuario en el historial; " +
    "si hay conflicto, priorizá su última instrucción explícita.";

  var FETCH_OPTS = { credentials: "same-origin" };

  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function stripJsonFences(text) {
    var cleaned = (text || "").trim();
    if (cleaned.indexOf("```") === 0) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    }
    return cleaned;
  }

  function quickFromList(chips) {
    if (!Array.isArray(chips)) return [];
    return chips
      .map(function (c) {
        return String(c).trim();
      })
      .filter(Boolean)
      .slice(0, 5);
  }

  function quickRepliesRegexFallback(text) {
    var match = text.match(/"quick_replies"\s*:\s*\[([\s\S]*?)\]/);
    if (!match) return [];
    var inner = match[1];
    var out = [];
    var re = /"((?:\\.|[^"\\])*)"/g;
    var m;
    while ((m = re.exec(inner)) && out.length < 5) {
      out.push(m[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim());
    }
    return out;
  }

  function coachPayloadFromDict(data) {
    var reply = String(data.reply || "").trim();
    var out = {
      reply: reply,
      quick_replies: quickFromList(data.quick_replies),
      preview_before: String(data.preview_before || "").trim(),
      preview_after: String(data.preview_after || "").trim(),
    };
    if (reply.charAt(0) === "{") {
      var nested = parseCoachJson(reply);
      if (nested.reply) {
        if (!out.quick_replies.length && nested.quick_replies.length) out.quick_replies = nested.quick_replies;
        if (!out.preview_before && nested.preview_before) out.preview_before = nested.preview_before;
        if (!out.preview_after && nested.preview_after) out.preview_after = nested.preview_after;
        out.reply = nested.reply;
      }
    }
    return out;
  }

  function parseCoachJson(raw) {
    var text = stripJsonFences(raw);
    if (!text) return { reply: "", quick_replies: [], preview_before: "", preview_after: "" };
    try {
      var data = JSON.parse(text);
      if (data && typeof data === "object") {
        return coachPayloadFromDict(data);
      }
    } catch (err) {
      /* fallback below */
    }
    var match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        var inner = JSON.parse(match[0]);
        if (inner && typeof inner === "object") {
          return coachPayloadFromDict(inner);
        }
      } catch (err2) {
        /* continue */
      }
    }
    var replyMatch = text.match(/"reply"\s*:\s*"((?:\\.|[^"\\])*)"/);
    var reply = text;
    if (replyMatch) {
      try {
        reply = JSON.parse('"' + replyMatch[1] + '"');
      } catch (err3) {
        reply = replyMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n");
      }
    }
    return {
      reply: String(reply).trim(),
      quick_replies: quickRepliesRegexFallback(text),
      preview_before: "",
      preview_after: "",
    };
  }

  function normalizeCoachResponse(data) {
    if (!data) return { reply: "", quick_replies: [], preview_before: "", preview_after: "" };
    if (typeof data === "string") return parseCoachJson(data);
    if (typeof data.reply === "string") {
      if (data.reply.indexOf('"quick_replies"') !== -1 && data.reply.trim().charAt(0) === "{") {
        var blob = parseCoachJson(data.reply);
        if (blob.reply && blob.quick_replies.length) return blob;
      }
      return coachPayloadFromDict(data);
    }
    return parseCoachJson(JSON.stringify(data));
  }

  function detailMessage(data, fallback) {
    var detail = data && data.detail;
    if (!detail) return fallback;
    if (typeof detail === "string") return detail;
    return detail.message || fallback;
  }

  function apiErrorMessage(status, data, fallback) {
    if (status === 404) {
      return "Ruta del asistente no encontrada. Reiniciá uvicorn (puerto 8000) con el código actual.";
    }
    return detailMessage(data, fallback);
  }

  function parseJsonResponse(response) {
    return response.text().then(function (text) {
      var data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (err) {
          data = { detail: text.slice(0, 200) };
        }
      }
      return { ok: response.ok, status: response.status, data: data };
    });
  }

  function initLyricsCoach(options) {
    options = options || {};
    var form = options.form || document.getElementById(options.formId || "workflow-form");
    if (!form) return;

    var details = document.getElementById("lyrics-coach");
    if (!details) return;

    var thread = document.getElementById("lyrics-coach-thread");
    var chipsBox = document.getElementById("lyrics-coach-chips");
    var input = document.getElementById("lyrics-coach-input");
    var status = document.getElementById("lyrics-coach-status");
    var compare = document.getElementById("lyrics-coach-compare");
    var compareBefore = document.getElementById("lyrics-coach-compare-before");
    var compareAfter = document.getElementById("lyrics-coach-compare-after");
    var retryBtn = document.getElementById("lyrics-coach-retry");
    var lyricsField = form.querySelector("#lyrics_block") || document.getElementById("lyrics_block");

    var history = [];
    var pending = false;
    var pendingPreview = "";
    var lyricsBeforeRevise = "";
    var lyricsBaseline = "";
    var lastSnippetPreview = null;
    var started = false;
    var bootstrapFailed = false;

    function getLyrics() {
      return lyricsField ? lyricsField.value.trim() : "";
    }

    function setStatus(msg) {
      if (status) status.textContent = msg || "";
    }

    function setRetryVisible(show) {
      if (retryBtn) retryBtn.hidden = !show;
    }

    function setPending(on) {
      pending = on;
      ["lyrics-coach-send", "lyrics-coach-revise", "lyrics-coach-reset", "lyrics-coach-retry"].forEach(function (id) {
        var btn = document.getElementById(id);
        if (btn) btn.disabled = on;
      });
    }

    function hideCompare() {
      if (compare) compare.hidden = true;
      pendingPreview = "";
      lyricsBeforeRevise = "";
    }

    function snippetDiffHtml(before, after) {
      if (!before && !after) return "";
      return (
        '<div class="lyrics-coach-snippet-diff">' +
        '<div class="lyrics-coach-snippet-col"><h5>Antes</h5><pre class="preview-text">' +
        esc(before || "—") +
        "</pre></div>" +
        '<div class="lyrics-coach-snippet-col"><h5>Después</h5><pre class="preview-text">' +
        esc(after || "—") +
        "</pre></div></div>"
      );
    }

    function renderThread() {
      if (!thread) return;
      var html = history
        .map(function (msg) {
          var roleClass = msg.role === "user" ? "lyrics-coach-msg--user" : "lyrics-coach-msg--assistant";
          var label = msg.role === "user" ? "Vos" : "Coach";
          return (
            '<div class="lyrics-coach-msg ' +
            roleClass +
            '"><span class="lyrics-coach-msg-label">' +
            esc(label) +
            "</span><p>" +
            esc(msg.content) +
            "</p></div>"
          );
        })
        .join("");
      if (lastSnippetPreview && (lastSnippetPreview.before || lastSnippetPreview.after)) {
        html += snippetDiffHtml(lastSnippetPreview.before, lastSnippetPreview.after);
      }
      thread.innerHTML = html;
      thread.scrollTop = thread.scrollHeight;
    }

    function renderChips(list) {
      if (!chipsBox) return;
      chipsBox.innerHTML = "";
      (list || []).forEach(function (chip) {
        if (chip === APPLY_CHIP_LABEL) return;
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "option-chip lyrics-coach-chip";
        btn.textContent = chip;
        btn.addEventListener("click", function () {
          if (input) input.value = chip;
          sendUserMessage(chip);
        });
        chipsBox.appendChild(btn);
      });
      var applyChip = document.createElement("button");
      applyChip.type = "button";
      applyChip.className = "option-chip lyrics-coach-chip lyrics-coach-chip-apply";
      applyChip.textContent = APPLY_CHIP_LABEL;
      applyChip.addEventListener("click", function () {
        runRevise();
      });
      chipsBox.appendChild(applyChip);
    }

    function presentCoachTurn(data) {
      var parsed = normalizeCoachResponse(data);
      appendMessage("assistant", parsed.reply);
      lastSnippetPreview =
        parsed.preview_before || parsed.preview_after
          ? { before: parsed.preview_before || "", after: parsed.preview_after || "" }
          : null;
      renderThread();
      renderChips(parsed.quick_replies || []);
    }

    function ensureLyrics() {
      if (getLyrics()) return true;
      setStatus("Escribí o generá una letra arriba antes de usar el asistente.");
      return false;
    }

    function appendMessage(role, content) {
      history.push({ role: role, content: content });
      renderThread();
    }

    function popLastUserMessage() {
      if (!history.length || history[history.length - 1].role !== "user") return;
      history.pop();
      renderThread();
    }

    function coachHistoryJson() {
      return JSON.stringify(
        history.map(function (msg) {
          return { role: msg.role, content: msg.content };
        })
      );
    }

    function localChat() {
      var body = new FormData(form);
      body.set("lyrics_block", getLyrics());
      body.set("coach_history", coachHistoryJson());
      return fetch("/guia/lyrics/coach/chat", {
        method: "POST",
        body: body,
        headers: { Accept: "application/json" },
        credentials: FETCH_OPTS.credentials,
      }).then(parseJsonResponse);
    }

    function localRevise() {
      var body = new FormData(form);
      body.set("lyrics_block", getLyrics());
      body.set("coach_history", coachHistoryJson());
      return fetch("/guia/lyrics/coach/revise", {
        method: "POST",
        body: body,
        headers: { Accept: "application/json" },
        credentials: FETCH_OPTS.credentials,
      }).then(parseJsonResponse);
    }

    function pagesBuildContext(lyrics) {
      if (typeof options.buildContextBlock === "function") {
        return options.buildContextBlock(lyrics);
      }
      return lyrics;
    }

    function pagesCompleteChat(messages, temperature) {
      if (typeof options.completeChat !== "function") {
        return Promise.reject(new Error("LLM no configurado en Pages."));
      }
      return options.completeChat(messages, temperature);
    }

    function pagesChat() {
      var lyrics = getLyrics();
      var context = pagesBuildContext(lyrics);
      var messages = [{ role: "system", content: COACH_SYSTEM }];
      if (!history.length) {
        messages.push({
          role: "user",
          content:
            context +
            "\n\nIniciá la conversación: leé la letra, mencioná 2–3 observaciones concretas (citando secciones reales), " +
            "hacé UNA pregunta abierta sobre qué quiere mejorar y ofrecé 3–5 quick_replies accionables en el JSON.",
        });
      } else {
        messages.push({ role: "user", content: context });
        history.forEach(function (msg) {
          messages.push({ role: msg.role, content: msg.content });
        });
      }
      return pagesCompleteChat(messages, 0.65).then(function (raw) {
        return normalizeCoachResponse(raw);
      });
    }

    function pagesRevise() {
      var lyrics = getLyrics();
      var context = pagesBuildContext(lyrics);
      var histLines = history
        .map(function (msg) {
          return "- " + (msg.role === "user" ? "Usuario" : "Coach") + ": " + msg.content;
        })
        .join("\n");
      var messages = [
        { role: "system", content: REVISE_SYSTEM },
        {
          role: "user",
          content:
            context +
            "\n\nHistorial de acuerdos con el usuario (aplicá todo esto en la letra final):\n" +
            (histLines || "(sin mensajes previos; mejorá la letra de forma general manteniendo el sentido.)"),
        },
      ];
      return pagesCompleteChat(messages, 0.5).then(function (raw) {
        return String(raw || "").trim();
      });
    }

    function handleAuthRedirect(result) {
      var detail = result.data && result.data.detail;
      if (detail && typeof detail === "object" && detail.code === "auth_required") {
        window.location.href = "/auth/login?next=/guia/workflow";
        return true;
      }
      if (detail && typeof detail === "object" && detail.code === "expired") {
        setStatus(detail.message || "La clave del LLM está vencida. Actualizala en Configuración.");
        return true;
      }
      return false;
    }

    function showCompare(before, after) {
      pendingPreview = after;
      lyricsBeforeRevise = before;
      if (compareBefore) compareBefore.textContent = before;
      if (compareAfter) compareAfter.textContent = after;
      if (compare) compare.hidden = false;
      setStatus("Compará antes del cambio (izquierda) vs después (derecha).");
      if (compare) compare.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function runChat(isBootstrap) {
      if (!ensureLyrics()) return Promise.resolve();
      setPending(true);
      setRetryVisible(false);
      bootstrapFailed = false;
      setStatus(isBootstrap ? "Leyendo tu letra…" : "Pensando…");
      var chain =
        options.mode === "pages"
          ? pagesChat().then(function (parsed) {
              return { ok: true, status: 200, data: parsed };
            })
          : localChat();

      return chain
        .then(function (result) {
          if (options.mode !== "pages") {
            if (!result.ok) {
              if (handleAuthRedirect(result)) return;
              throw new Error(apiErrorMessage(result.status, result.data, "No se pudo contactar al asistente."));
            }
            return result.data;
          }
          return result.data;
        })
        .then(function (data) {
          if (!data) return;
          presentCoachTurn(data);
          setStatus("");
          if (isBootstrap) {
            started = true;
            lyricsBaseline = getLyrics();
          }
        })
        .catch(function (err) {
          if (isBootstrap) {
            bootstrapFailed = true;
            started = false;
            setRetryVisible(true);
          }
          setStatus(err.message || "Error del asistente.");
        })
        .then(function () {
          setPending(false);
        });
    }

    function sendUserMessage(text) {
      var msg = (text || "").trim();
      if (!msg) return;
      if (!ensureLyrics()) return;
      appendMessage("user", msg);
      if (input && text === input.value.trim()) input.value = "";
      renderChips([]);
      setPending(true);
      setRetryVisible(false);
      setStatus("Pensando…");
      var chain =
        options.mode === "pages"
          ? pagesChat().then(function (parsed) {
              return { ok: true, status: 200, data: parsed };
            })
          : localChat();

      chain
        .then(function (result) {
          if (options.mode !== "pages") {
            if (!result.ok) {
              if (handleAuthRedirect(result)) return;
              popLastUserMessage();
              throw new Error(apiErrorMessage(result.status, result.data, "No se pudo contactar al asistente."));
            }
            return result.data;
          }
          return result.data;
        })
        .then(function (data) {
          if (!data) return;
          presentCoachTurn(data);
          setStatus("");
        })
        .catch(function (err) {
          setStatus(err.message || "Error del asistente.");
        })
        .then(function () {
          setPending(false);
        });
    }

    function confirmRevise() {
      var msg =
        history.length > 0
          ? "¿Regenerar la letra con todo lo que hablamos? Vas a ver la versión anterior y la nueva lado a lado antes de aplicar."
          : "¿Regenerar la letra con mejoras generales? Vas a comparar anterior vs nueva antes de aplicar.";
      return window.confirm(msg);
    }

    function runRevise() {
      if (!ensureLyrics()) return;
      if (!confirmRevise()) return;
      lyricsBeforeRevise = getLyrics() || lyricsBaseline;
      setPending(true);
      if (compare) compare.hidden = true;
      pendingPreview = "";
      setStatus("Generando versión mejorada…");
      var chain =
        options.mode === "pages"
          ? pagesRevise().then(function (lyrics) {
              return { ok: true, status: 200, data: { lyrics: lyrics } };
            })
          : localRevise();

      chain
        .then(function (result) {
          if (options.mode !== "pages") {
            if (!result.ok) {
              if (handleAuthRedirect(result)) return;
              throw new Error(apiErrorMessage(result.status, result.data, "No se pudo generar la versión mejorada."));
            }
            return result.data;
          }
          return result.data;
        })
        .then(function (data) {
          if (!data || !data.lyrics) return;
          showCompare(lyricsBeforeRevise, data.lyrics);
        })
        .catch(function (err) {
          setStatus(err.message || "Error al revisar la letra.");
        })
        .then(function () {
          setPending(false);
        });
    }

    function resetCoach() {
      history = [];
      started = false;
      bootstrapFailed = false;
      lastSnippetPreview = null;
      hideCompare();
      renderThread();
      renderChips([]);
      if (input) input.value = "";
      setStatus("");
      setRetryVisible(false);
    }

    function applyPreview() {
      if (!pendingPreview || !lyricsField) return;
      lyricsField.value = pendingPreview;
      lyricsBaseline = pendingPreview;
      if (typeof options.onApply === "function") options.onApply(pendingPreview);
      lyricsField.dispatchEvent(new Event("input", { bubbles: true }));
      setStatus("Letra actualizada. Podés seguir editando o chatear de nuevo.");
      hideCompare();
    }

    function keepOldLyrics() {
      hideCompare();
      setStatus("Se mantuvo la letra anterior.");
    }

    details.addEventListener("toggle", function () {
      if (!details.open || pending) return;
      if (!ensureLyrics()) return;
      if (!lyricsBaseline) lyricsBaseline = getLyrics();
      if (started && !bootstrapFailed) return;
      runChat(true);
    });

    var sendBtn = document.getElementById("lyrics-coach-send");
    if (sendBtn) {
      sendBtn.addEventListener("click", function () {
        sendUserMessage(input ? input.value : "");
      });
    }
    var reviseBtn = document.getElementById("lyrics-coach-revise");
    if (reviseBtn) reviseBtn.addEventListener("click", runRevise);
    var resetBtn = document.getElementById("lyrics-coach-reset");
    if (resetBtn) resetBtn.addEventListener("click", resetCoach);
    if (retryBtn) {
      retryBtn.addEventListener("click", function () {
        if (!ensureLyrics()) return;
        runChat(true);
      });
    }
    var applyBtn = document.getElementById("lyrics-coach-apply");
    if (applyBtn) applyBtn.addEventListener("click", applyPreview);
    var keepOldBtn = document.getElementById("lyrics-coach-keep-old");
    if (keepOldBtn) keepOldBtn.addEventListener("click", keepOldLyrics);
    var dismissBtn = document.getElementById("lyrics-coach-dismiss-preview");
    if (dismissBtn) {
      dismissBtn.addEventListener("click", function () {
        hideCompare();
        setStatus("");
      });
    }
    if (input) {
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" && !ev.shiftKey) {
          ev.preventDefault();
          sendUserMessage(input.value);
        }
      });
    }
  }

  window.initLyricsCoach = initLyricsCoach;
})();
