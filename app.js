(function () {
  var OPTIONS = {};
  var TABLES = {};
  var currentSuggestions = [];

  function splitCsv(text) {
    return (text || "")
      .split(",")
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function joinUnique(parts) {
    var seen = {};
    var out = [];
    parts.forEach(function (p) {
      var k = String(p).toLowerCase();
      if (!seen[k]) {
        seen[k] = true;
        out.push(p);
      }
    });
    return out.join(", ");
  }

  function andJoin(items) {
    items = (items || []).filter(Boolean);
    if (!items.length) return "";
    if (items.length === 1) return items[0];
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value : "";
  }

  function setVal(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = value;
  }

  function copyToClipboard(text, statusEl) {
    if (!text) {
      statusEl.textContent = "No hay nada para copiar.";
      return;
    }
    navigator.clipboard.writeText(text).then(
      function () { statusEl.textContent = "Copiado al portapapeles."; },
      function () { statusEl.textContent = "No se pudo copiar; seleccioná el texto."; }
    );
  }

  function renderGrid(containerId, items, pickName, extra) {
    var box = document.getElementById(containerId);
    if (!box) return;
    var chips = (items || []).map(function (item) {
      return '<label class="option-chip" title="' + esc(item.hint || "") + '">' +
        '<input type="checkbox" name="' + pickName + '" value="' + esc(item.value) + '">' +
        "<span>" + esc(item.label) + "</span></label>";
    }).join("");
    box.innerHTML =
      '<fieldset class="option-fieldset"><legend>' + esc(extra || pickName) +
      '</legend><div class="option-grid">' + chips + "</div></fieldset>";
  }

  function renderRadios(containerId, items, name) {
    var box = document.getElementById(containerId);
    if (!box) return;
    box.innerHTML = "<legend>Género de voz</legend><div class=\"option-grid option-grid-radio\">" +
      (items || []).map(function (item, i) {
        return '<label class="option-chip"><input type="radio" name="' + name + '" value="' +
          esc(item.value) + '"' + (i === 0 ? " checked" : "") + "><span>" +
          esc(item.label) + "</span></label>";
      }).join("") + "</div>";
  }

  function bindSync(form) {
    form.querySelectorAll(".sync-field").forEach(function (field) {
      var pickName = field.getAttribute("data-pick");
      if (!pickName) return;
      form.querySelectorAll('input[name="' + pickName + '"]').forEach(function (cb) {
        cb.addEventListener("change", function () {
          var checked = Array.prototype.map.call(
            form.querySelectorAll('input[name="' + pickName + '"]:checked'),
            function (c) { return c.value; }
          );
          var typed = splitCsv(field.value).filter(function (v) {
            return !Array.prototype.some.call(
              form.querySelectorAll('input[name="' + pickName + '"]'),
              function (c) { return c.value.toLowerCase() === v.toLowerCase(); }
            );
          });
          field.value = joinUnique(typed.concat(checked));
        });
      });
      field.addEventListener("input", function () {
        var typed = splitCsv(field.value).map(function (v) { return v.toLowerCase(); });
        form.querySelectorAll('input[name="' + pickName + '"]').forEach(function (c) {
          c.checked = typed.indexOf(c.value.toLowerCase()) !== -1;
        });
      });
    });
  }

  function haystack(name, profile) {
    var pieces = [name, profile.label || "", profile.hint || ""];
    ["tempo_term", "mood", "instruments", "vocal_style", "production_notes", "rhythm_accompaniment"].forEach(function (k) {
      pieces = pieces.concat(profile[k] || []);
    });
    return pieces.join(" ").toLowerCase();
  }

  function suggestStyles(bpmCsv, styleQuery, instrumentsCsv) {
    var bpms = splitCsv(bpmCsv).map(Number).filter(function (n) { return n > 0; });
    var terms = splitCsv(styleQuery.replace(/ y /g, ",").replace(/;/g, ",")).map(function (t) { return t.toLowerCase(); });
    var wanted = {};
    splitCsv(instrumentsCsv).forEach(function (i) { wanted[i.toLowerCase()] = true; });
    var hasInput = bpms.length || terms.length || Object.keys(wanted).length;
    var out = [];
    Object.keys(TABLES.profiles || {}).forEach(function (name) {
      var profile = TABLES.profiles[name];
      var profileBpm = Number(profile.bpm || 0);
      var reasons = [];
      var score = 0;
      if (bpms.length && profileBpm) {
        var distance = Math.min.apply(null, bpms.map(function (b) { return Math.abs(b - profileBpm); }));
        var bpmPoints = Math.max(0, 100 - distance * 4);
        score += bpmPoints;
        if (bpmPoints > 0) reasons.push("BPM " + profileBpm + " (a " + distance + " de lo que pediste)");
      }
      var hay = haystack(name, profile);
      terms.forEach(function (term) {
        if (term && hay.indexOf(term) !== -1) {
          score += 60;
          reasons.push("coincide «" + term + "»");
        }
      });
      var overlap = (profile.instruments || []).filter(function (i) { return wanted[i.toLowerCase()]; });
      if (overlap.length) {
        score += 15 * overlap.length;
        reasons.push("instrumentos: " + overlap.join(", "));
      }
      if (hasInput && score <= 0) return;
      out.push({
        genre: name,
        label: profile.label || name,
        hint: profile.hint || "",
        bpm: profileBpm,
        score: Math.round(score),
        reasons: reasons,
        tempo_term: profile.tempo_term || [],
        mood: profile.mood || [],
        instruments: profile.instruments || [],
        vocal_style: profile.vocal_style || [],
        production_notes: profile.production_notes || [],
        rhythm_accompaniment: profile.rhythm_accompaniment || [],
        structure_template: profile.structure_template || "auto",
        suno_model: profile.suno_model || "v6"
      });
    });
    out.sort(function (a, b) { return b.score - a.score || a.bpm - b.bpm; });
    return out.slice(0, 6);
  }

  function composeStyle() {
    var palette = TABLES.style_palette || {};
    var genres = splitCsv(val("genre")).map(function (g) { return palette[g.toLowerCase()] || g; });
    var tempoTerms = splitCsv(val("tempo_term"));
    var pieces = [];
    var leadAdj = tempoTerms.slice(0, 2).join(" ");
    if (genres.length) {
      var lead = (leadAdj + " " + genres[0]).trim();
      if (genres.length > 1) lead += " blended with " + andJoin(genres.slice(1));
      pieces.push(lead);
    } else if (leadAdj) {
      pieces.push(leadAdj);
    }
    var bpms = splitCsv(val("tempo_bpm")).map(Number).filter(function (n) { return n > 0; }).sort(function (a, b) { return a - b; });
    if (bpms.length === 1) pieces.push("at " + bpms[0] + " BPM");
    else if (bpms.length > 1) pieces.push("around " + bpms[0] + "–" + bpms[bpms.length - 1] + " BPM");
    var rhythm = splitCsv(val("rhythm_accompaniment"));
    if (rhythm.length) pieces.push("driven by " + andJoin(rhythm));
    var instruments = splitCsv(val("instruments"));
    if (instruments.length) pieces.push("with " + andJoin(instruments));
    var genderEl = document.querySelector('input[name="vocal_gender"]:checked');
    var gender = genderEl && genderEl.value !== "any" ? genderEl.value : "";
    var styles = splitCsv(val("vocal_style"));
    if (styles.length || gender) {
      pieces.push(((gender + " " + (styles[0] || "")).trim() + " vocal" + (styles.length > 1 ? " with " + andJoin(styles.slice(1)) : "")).trim());
    }
    var moods = splitCsv(val("mood"));
    if (moods.length) pieces.push(andJoin(moods) + " mood");
    var already = {};
    rhythm.concat(instruments).forEach(function (x) { already[x.toLowerCase()] = true; });
    var production = splitCsv(val("production_notes")).filter(function (p) { return !already[p.toLowerCase()]; });
    if (production.length) pieces.push(andJoin(production) + " production");
    var structure = (TABLES.structure_phrases || {})[val("structure_template")] || "";
    if (structure) pieces.push(structure);
    var langs = splitCsv(val("language")).map(function (c) {
      return (TABLES.language_names_en || {})[c.toLowerCase()] || c;
    });
    if (langs.length === 1) pieces.push(langs[0] + " lyrics");
    else if (langs.length === 2) pieces.push("bilingual " + langs[0] + " and " + langs[1] + " lyrics");
    else if (langs.length) pieces.push("multilingual lyrics in " + andJoin(langs));
    var text = joinUnique(splitCsv(pieces.join(", ")));
    if (!text) return "indie pop, warm production, expressive vocal";
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function composeLyrics() {
    var lyrics = val("lyrics_block").trim();
    if (lyrics) {
      if (!/\[end\]/i.test(lyrics)) lyrics += "\n\n[End]";
      return lyrics;
    }
    var outline = (TABLES.structure_outlines || {})[val("structure_template")] || (TABLES.structure_outlines || {}).auto || [];
    var instruments = splitCsv(val("instruments"));
    var lines = [];
    outline.forEach(function (name, index) {
      var cue = "";
      if (name === "Intro") cue = andJoin(instruments.slice(0, 2));
      if (name === "Chorus") cue = index === outline.length - 1 ? "full band, big finish" : "full band";
      if (name === "Bridge") cue = "contrast, build tension";
      if (name === "Outro") cue = "fade out";
      lines.push(cue ? "[" + name + " - " + cue + "]" : "[" + name + "]");
      lines.push("");
    });
    lines.push("[End]");
    return lines.join("\n").trim();
  }

  function composePaste(style, lyrics) {
    var title = val("title").trim() || "Sin título";
    var exclude = val("exclude_styles").trim();
    var parts = ["STYLE OF MUSIC:", style, "", "LYRICS:", lyrics, "", "TITLE:", title];
    if (exclude) parts.push("", "EXCLUDE STYLES:", exclude);
    return parts.join("\n");
  }

  function buildLlmMessages() {
    var idea = val("lyrics_idea").trim();
    var outline = ((TABLES.structure_outlines || {})[val("structure_template")] || (TABLES.structure_outlines || {}).auto || [])
      .map(function (n) { return "- [" + n + "]"; })
      .join("\n");
    var user =
      "Escribí la letra completa para pegar en el campo Lyrics de Suno (Custom mode).\n\n" +
      "Idea o pedido (instrucción principal — desarrollala en la letra):\n" + idea + "\n\n" +
      "Parámetros ya elegidos:\n" +
      "- Idioma(s): " + val("language") + "\n" +
      "- Título: " + (val("title") || "(sin título)") + "\n" +
      "- Género: " + (val("genre") || "libre") + "\n" +
      "- Mood: " + (val("mood") || "libre") + "\n" +
      "- Ritmo / tempo: " + joinUnique([val("tempo_term"), val("rhythm_accompaniment"), val("tempo_bpm")].filter(Boolean)) + "\n" +
      "- Instrumentos: " + (val("instruments") || "libre") + "\n" +
      "- Estilo vocal: " + (val("vocal_style") || "libre") + "\n" +
      "- Producción: " + (val("production_notes") || "libre") + "\n\n" +
      "Estructura obligatoria:\n" + outline + "\n\n" +
      "Reglas:\n- Solo la letra. Sin título, sin comentarios, sin markdown.\n" +
      "- Cada sección empieza con un metatag, por ejemplo [Verse] o [Chorus].\n" +
      "- El estribillo se repite con la misma letra cuando hay más de un Chorus.";
    return [
      { role: "system", content: "Sos letrista para Suno Custom mode. Devolvé únicamente la letra con metatags entre corchetes." },
      { role: "user", content: user }
    ];
  }

  function applySuggestionSelection(form) {
    var picked = currentSuggestions.filter(function (item) {
      var cb = form.querySelector('input[name="genre_pick"][value="' + CSS.escape(item.genre) + '"]');
      return cb && cb.checked;
    });
    function collect(key) {
      return picked.reduce(function (acc, item) { return acc.concat(item[key] || []); }, []);
    }
    setVal("genre", joinUnique(picked.map(function (i) { return i.genre; })));
    setVal("mood", joinUnique(collect("mood")));
    setVal("tempo_term", joinUnique(collect("tempo_term")));
    setVal("rhythm_accompaniment", joinUnique(collect("rhythm_accompaniment")));
    setVal("production_notes", joinUnique(collect("production_notes")));
    setVal("vocal_style", joinUnique(collect("vocal_style")));
    setVal("instruments", joinUnique(collect("instruments")));
    var first = picked[0];
    setVal("structure_template", first ? first.structure_template : "auto");
    setVal("suno_model", first ? first.suno_model : "v6");
    var instField = document.getElementById("instruments");
    if (instField) instField.dispatchEvent(new Event("input", { bubbles: true }));
    var vocalField = document.getElementById("vocal_style");
    if (vocalField) vocalField.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function bootWorkflow() {
    if (!window.PagesAuth || !window.PagesAuth.isAuthed()) return;
    Promise.all([
      fetch("data/options.json").then(function (r) { return r.json(); }),
      fetch("data/profiles.json").then(function (r) { return r.json(); })
    ]).then(function (pair) {
    OPTIONS = pair[0];
    TABLES = pair[1];
    var form = document.getElementById("workflow-form");
    renderGrid("grid-tempo_bpm", OPTIONS.tempo_bpm_presets, "tempo_bpm_pick", "Presets BPM");
    renderGrid("grid-language", OPTIONS.languages, "language_pick", "Idiomas");
    renderGrid("grid-instruments", OPTIONS.instruments, "instruments_pick", "Instrumentos");
    renderGrid("grid-vocal_style", OPTIONS.vocal_styles, "vocal_style_pick", "Técnicas vocales");
    renderGrid("grid-exclude", OPTIONS.exclude_presets, "exclude_pick", "Excluir estilos");
    renderRadios("grid-vocal_gender", OPTIONS.vocal_genders, "vocal_gender");
    bindSync(form);
    document.getElementById("language").dispatchEvent(new Event("input", { bubbles: true }));

    // keep in sync with app/static/workflow.js (showStep / nav)
    var workflowTotalSteps = 5;
    var maxStepVisited = 1;
    var currentStep = 1;
    var pills = Array.prototype.slice.call(document.querySelectorAll(".workflow-step-pill[data-step-pill]"));

    function updateWorkflowNav(n) {
      var label = document.getElementById("workflow-step-label");
      var prevMobile = document.querySelector("[data-prev-mobile]");
      var nextMobile = document.querySelector("[data-next-mobile]");
      if (label) label.textContent = "Paso " + n + " de " + workflowTotalSteps;
      if (prevMobile) prevMobile.disabled = n <= 1;
      if (nextMobile) nextMobile.disabled = n >= workflowTotalSteps;
    }

    function updateWorkflowPills(n) {
      pills.forEach(function (pill) {
        var step = Number(pill.getAttribute("data-step-pill"));
        pill.classList.remove("is-active", "is-done", "active");
        if (step === n) {
          pill.classList.add("is-active");
          pill.setAttribute("aria-current", "step");
        } else {
          pill.removeAttribute("aria-current");
        }
        if (step < n) pill.classList.add("is-done");
        pill.disabled = step > maxStepVisited;
      });
    }

    function showStep(n) {
      if (n < 1 || n > workflowTotalSteps) return;
      currentStep = n;
      if (n > maxStepVisited) maxStepVisited = n;
      form.querySelectorAll(".workflow-step").forEach(function (section) {
        section.hidden = Number(section.getAttribute("data-step")) !== n;
      });
      updateWorkflowPills(n);
      updateWorkflowNav(n);
      var target = form.querySelector('.workflow-step[data-step="' + n + '"]');
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        var heading = target.querySelector("h2");
        if (heading) {
          heading.setAttribute("tabindex", "-1");
          heading.focus({ preventScroll: true });
        }
      }
      if (n === 5) buildBlocks();
    }

    form.querySelectorAll("[data-next]").forEach(function (btn) {
      btn.addEventListener("click", function () { showStep(Number(btn.getAttribute("data-next"))); });
    });
    form.querySelectorAll("[data-prev]").forEach(function (btn) {
      btn.addEventListener("click", function () { showStep(Number(btn.getAttribute("data-prev"))); });
    });
    pills.forEach(function (pill) {
      pill.addEventListener("click", function () {
        var step = Number(pill.getAttribute("data-step-pill"));
        if (step <= maxStepVisited) showStep(step);
      });
    });
    var prevMobile = document.querySelector("[data-prev-mobile]");
    var nextMobile = document.querySelector("[data-next-mobile]");
    if (prevMobile) {
      prevMobile.addEventListener("click", function () { showStep(currentStep - 1); });
    }
    if (nextMobile) {
      nextMobile.addEventListener("click", function () { showStep(currentStep + 1); });
    }
    showStep(1);

    document.getElementById("suggest-styles").addEventListener("click", function () {
      var status = document.getElementById("suggest-status");
      currentSuggestions = suggestStyles(val("tempo_bpm"), val("style_query"), val("instruments"));
      var box = document.getElementById("suggestions");
      if (!currentSuggestions.length) {
        box.innerHTML = '<p class="muted">Ningún estilo coincide. Probá otro BPM o término.</p>';
        status.textContent = "";
        showStep(2);
        return;
      }
      box.innerHTML = currentSuggestions.map(function (item, index) {
        return '<label class="suggestion' + (index === 0 ? " is-top" : "") + '">' +
          '<input type="checkbox" name="genre_pick" value="' + esc(item.genre) + '"' + (index === 0 ? " checked" : "") + ">" +
          "<div><strong>" + esc(item.label) + '</strong> <span class="muted">~' + item.bpm +
          " BPM · puntaje " + item.score + "</span>" +
          (item.hint ? '<p class="muted">' + esc(item.hint) + "</p>" : "") +
          '<p class="muted">Por qué: ' + esc(item.reasons.join(" · ") || "sugerencia") + "</p>" +
          '<div class="chips">' + item.instruments.map(function (i) {
            return '<span class="chip">' + esc(i) + "</span>";
          }).join("") + "</div></div></label>";
      }).join("");
      box.querySelectorAll('input[name="genre_pick"]').forEach(function (cb) {
        cb.addEventListener("change", function () { applySuggestionSelection(form); });
      });
      applySuggestionSelection(form);
      status.textContent = currentSuggestions.length + " estilos sugeridos.";
      showStep(2);
    });

    document.getElementById("build-llm-prompt").addEventListener("click", function () {
      var status = document.getElementById("lyrics-status");
      if (!val("lyrics_idea").trim()) {
        status.textContent = "Escribí la idea antes de armar el prompt.";
        return;
      }
      var messages = buildLlmMessages();
      document.getElementById("llm-prompt-preview").textContent =
        "SYSTEM:\n" + messages[0].content + "\n\nUSER:\n" + messages[1].content;
      document.getElementById("llm-prompt-details").hidden = false;
      document.getElementById("llm-prompt-details").open = true;
      status.textContent = "Prompt listo. Podés copiarlo o generar la letra.";
    });

    document.getElementById("generate-lyrics").addEventListener("click", function () {
      var status = document.getElementById("lyrics-status");
      if (!window.PagesAuth || !window.PagesAuth.isAuthed()) {
        status.textContent = "Entrá con GitHub + QR para usar el LLM en esta página, o usá la app local.";
        return;
      }
      var key = val("llm_api_key").trim();
      var model = val("llm_model").trim();
      if (!key || !model) {
        status.textContent = "En Configuración (engranaje) pegá tu API key y el modelo. La key del servidor no está en Pages.";
        if (window.PagesAuth && window.PagesAuth.openSettings) window.PagesAuth.openSettings();
        return;
      }
      if (!val("lyrics_idea").trim()) {
        status.textContent = "Escribí la idea antes de generar.";
        return;
      }
      var button = this;
      button.disabled = true;
      status.textContent = "Generando letra…";
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + key,
        },
        body: JSON.stringify({ model: model, temperature: 0.8, messages: buildLlmMessages() }),
      })
        .then(function (r) {
          return r.json().then(function (data) { return { ok: r.ok, data: data }; });
        })
        .then(function (result) {
          if (!result.ok) throw new Error((result.data && result.data.error && result.data.error.message) || "No se pudo generar la letra.");
          var text = result.data.choices && result.data.choices[0] && result.data.choices[0].message && result.data.choices[0].message.content;
          if (!text) throw new Error("El LLM no devolvió letra.");
          setVal("lyrics_block", text.trim());
          status.textContent = "Letra lista. Podés editarla.";
        })
        .catch(function (err) { status.textContent = err.message; })
        .then(function () { button.disabled = false; });
    });

    function buildBlocks() {
      var style = composeStyle();
      var lyrics = composeLyrics();
      var paste = composePaste(style, lyrics);
      document.getElementById("suno-style").textContent = style;
      document.getElementById("suno-lyrics").textContent = lyrics;
      document.getElementById("suno-paste").textContent = paste;
      document.getElementById("suno-status").textContent = "Listo. Copiá Style + Lyrics y pegalo en Suno.";
    }

    document.getElementById("build-suno-prompt").addEventListener("click", buildBlocks);
    document.getElementById("copy-all").addEventListener("click", function () {
      copyToClipboard(document.getElementById("suno-paste").textContent, document.getElementById("suno-status"));
    });
    document.querySelectorAll("[data-copy]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var pre = document.getElementById(btn.getAttribute("data-copy"));
        copyToClipboard(pre ? pre.textContent : "", document.getElementById(btn.closest(".card") ? "suno-status" : "lyrics-status") || document.getElementById("suno-status"));
      });
    });

    function buildCoachContextBlock(lyrics) {
      // keep in sync with app/services/lyrics_coach.py build_coach_context_block
      var idea = val("lyrics_idea").trim() || "(sin idea original registrada)";
      var tempo = joinUnique([val("tempo_term"), val("rhythm_accompaniment"), val("tempo_bpm")].filter(Boolean));
      return (
        "Contexto del compositor:\n" +
        "- Idea original: " + idea + "\n" +
        "- Idioma(s): " + val("language") + "\n" +
        "- Género: " + (val("genre") || "libre") + "\n" +
        "- Mood: " + (val("mood") || "libre") + "\n" +
        "- Ritmo / tempo: " + (tempo || "libre") + "\n" +
        "- Instrumentos: " + (val("instruments") || "libre") + "\n" +
        "- Estilo vocal: " + (val("vocal_style") || "libre") + "\n" +
        "- Producción: " + (val("production_notes") || "libre") + "\n" +
        "- Excluir: " + (val("exclude_styles") || "ninguno") + "\n\n" +
        'Letra actual (texto completo entre comillas triples):\n"""\n' +
        lyrics +
        '\n"""'
      );
    }

    function completeCoachChat(messages, temperature) {
      var key = val("llm_api_key").trim();
      var model = val("llm_model").trim();
      if (!window.PagesAuth || !window.PagesAuth.isAuthed()) {
        return Promise.reject(new Error("Entrá con GitHub + QR para usar el asistente en Pages."));
      }
      if (!key || !model) {
        if (window.PagesAuth.openSettings) window.PagesAuth.openSettings();
        return Promise.reject(new Error("En Configuración pegá tu API key y el modelo."));
      }
      return fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + key,
        },
        body: JSON.stringify({ model: model, temperature: temperature, messages: messages }),
      })
        .then(function (r) {
          return r.json().then(function (data) {
            return { ok: r.ok, data: data };
          });
        })
        .then(function (result) {
          if (!result.ok) {
            throw new Error(
              (result.data && result.data.error && result.data.error.message) || "No se pudo contactar al LLM."
            );
          }
          var text =
            result.data.choices &&
            result.data.choices[0] &&
            result.data.choices[0].message &&
            result.data.choices[0].message.content;
          if (!text) throw new Error("El LLM no devolvió texto.");
          return text.trim();
        });
    }

    if (window.initLyricsCoach) {
      window.initLyricsCoach({
        mode: "pages",
        form: form,
        buildContextBlock: buildCoachContextBlock,
        completeChat: completeCoachChat,
      });
    }

    }).catch(function () {
      document.body.insertAdjacentHTML("beforeend", '<p class="card">No se pudieron cargar data/options.json. Publicá la carpeta docs/ completa.</p>');
    });
  }

  if (window.PagesAuth && window.PagesAuth.bootPage) {
    window.PagesAuth.bootPage().then(function (ok) {
      if (ok) bootWorkflow();
    });
  }
})();
