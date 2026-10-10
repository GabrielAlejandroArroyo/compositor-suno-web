(function (global) {
  var STORAGE_KEY = "compositor-suno-pages-session-v2";
  try {
    sessionStorage.removeItem("compositor-suno-pages-session");
  } catch (err) {}
  (function forceLogin() {
    var page = (window.location.pathname.split("/").pop() || "index.html").split("?")[0];
    if (page === "login.html") return;
    var ok = false;
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      var data = raw ? JSON.parse(raw) : null;
      ok = Boolean(data && data.login && data.repo_ok);
    } catch (err) {
      ok = false;
    }
    if (!ok) {
      window.location.replace("login.html?next=" + encodeURIComponent(page + (window.location.hash || "")));
    }
  })();
  var AUTH = {
    repo: "GabrielAlejandroArroyo/compositor-suno",
    owners: ["GabrielAlejandroArroyo"],
    github_login_url: "https://github.com/login",
    github_token_url: "https://github.com/settings/tokens/new?description=compositor-suno-pages&scopes=repo",
  };

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function loadSession() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.login || !data.repo_ok) return null;
      return data;
    } catch (err) {
      return null;
    }
  }

  function saveSession(data) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      login: data.login,
      repo_ok: true,
      at: Date.now(),
    }));
  }

  function clearSession() {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem("compositor-suno-pages-session");
    sessionStorage.removeItem("compositor-suno-llm");
    if (global.PagesLlm && global.PagesLlm.clearLlm) {
      global.PagesLlm.clearLlm();
    }
  }

  function isAuthed() {
    return Boolean(loadSession());
  }

  function showError(message) {
    var box = document.getElementById("auth-error");
    if (!box) return;
    box.hidden = !message;
    box.textContent = message || "";
  }

  function applyAuthConfig(config) {
    if (!config) return;
    if (config.repo) AUTH.repo = config.repo;
    if (config.owners && config.owners.length) AUTH.owners = config.owners;
    if (config.github_login_url) AUTH.github_login_url = config.github_login_url;
    if (config.github_token_url) AUTH.github_token_url = config.github_token_url;
    var repoLabel = document.getElementById("repo-label");
    if (repoLabel) repoLabel.textContent = AUTH.repo;
    var loginLink = document.getElementById("open-github-login");
    if (loginLink) loginLink.href = AUTH.github_login_url;
    var tokenLink = document.getElementById("open-github-token");
    if (tokenLink) tokenLink.href = AUTH.github_token_url;
  }

  function apiHeaders(token) {
    return {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  function verifyGithubToken(token) {
    var cleaned = (token || "").trim();
    if (!cleaned || cleaned.length < 20) {
      return Promise.reject(new Error("Pegá un token de GitHub válido."));
    }
    return fetch("https://api.github.com/user", { headers: apiHeaders(cleaned) })
      .then(function (response) {
        return response.json().then(function (payload) {
          return { ok: response.ok, status: response.status, payload: payload };
        });
      })
      .then(function (userResult) {
        if (userResult.status === 401) throw new Error("GitHub rechazó el token. Creá uno nuevo con 2FA.");
        if (!userResult.ok) throw new Error("No se pudo leer el usuario de GitHub.");
        var login = (userResult.payload.login || "").trim();
        var allowed = (AUTH.owners || []).map(function (item) { return String(item).toLowerCase(); });
        if (allowed.length && allowed.indexOf(login.toLowerCase()) === -1) {
          throw new Error("Este usuario de GitHub no está habilitado.");
        }
        return fetch("https://api.github.com/repos/" + AUTH.repo, { headers: apiHeaders(cleaned) })
          .then(function (response) {
            return response.json().then(function (payload) {
              return { ok: response.ok, status: response.status, payload: payload, login: login };
            });
          });
      })
      .then(function (repoResult) {
        if (repoResult.status === 404) throw new Error("No tenés acceso al repositorio privado.");
        if (!repoResult.ok) throw new Error("GitHub rechazó la verificación del repo.");
        var permissions = (repoResult.payload && repoResult.payload.permissions) || {};
        if (!(permissions.pull || permissions.push || permissions.admin)) {
          throw new Error("El token no alcanza para leer el repo.");
        }
        return { login: repoResult.login };
      });
  }

  function renderLoggedIn(login) {
    var box = document.getElementById("auth-box");
    var ok = document.getElementById("auth-ok");
    if (box) box.hidden = true;
    if (ok) ok.hidden = false;
    var user = document.getElementById("auth-user");
    if (user) user.textContent = login;
  }

  function bootLogin() {
    fetch("data/auth.json")
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (config) {
        applyAuthConfig(config);
        var session = loadSession();
        if (session) {
          renderLoggedIn(session.login);
          return;
        }
        var form = document.getElementById("github-token-form");
        if (!form) return;
        form.addEventListener("submit", function (event) {
          event.preventDefault();
          var status = document.getElementById("auth-status");
          var input = document.getElementById("github_token");
          var button = document.getElementById("verify-github");
          showError("");
          status.textContent = "Comprobando GitHub y el repo…";
          button.disabled = true;
          verifyGithubToken(input.value)
            .then(function (identity) {
              saveSession(identity);
              input.value = "";
              renderLoggedIn(identity.login);
              status.textContent = "Repo verificado.";
              var next = new URLSearchParams(window.location.search).get("next") || "index.html#configuracion";
              window.location.href = next;
            })
            .catch(function (err) {
              showError(err.message || "No se pudo autenticar.");
              status.textContent = "";
            })
            .then(function () {
              button.disabled = false;
            });
        });
        var logout = document.getElementById("auth-logout");
        if (logout) {
          logout.addEventListener("click", function () {
            clearSession();
            window.location.href = "login.html";
          });
        }
      });
  }

  function revealAppShell() {
    document.documentElement.classList.remove("auth-pending");
  }

  function bootPage() {
    return fetch("data/auth.json")
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (config) {
        applyAuthConfig(config);
        sessionStorage.removeItem("compositor-suno-pages-session");
        var session = loadSession();
        if (!session) {
          var here = window.location.pathname.split("/").pop() || "index.html";
          var hash = window.location.hash || "";
          window.location.replace("login.html?next=" + encodeURIComponent(here + hash));
          return false;
        }
        var nav = document.getElementById("pages-auth-nav");
        if (nav) {
          nav.innerHTML =
            '<span class="muted">' + esc(session.login) + '</span> <button type="button" class="btn btn-secondary" id="pages-logout">Salir</button>';
        }
        var logout = document.getElementById("pages-logout");
        if (logout) {
          logout.addEventListener("click", function () {
            clearSession();
            window.location.href = "login.html";
          });
        }
        applySecretsVisibility(session);
        if (global.PagesLlm && global.PagesLlm.restoreToForm) {
          global.PagesLlm.restoreToForm();
        }
        revealAppShell();
        return true;
      });
  }

  function applySecretsVisibility(session) {
    var authed = Boolean(session);
    var secrets = document.getElementById("sec-secrets");
    var locked = document.getElementById("sec-secrets-locked");
    if (secrets) secrets.hidden = !authed;
    if (locked) locked.hidden = authed;
  }

  function isSettingsHash() {
    var hash = window.location.hash || "";
    return hash === "#configuracion" || hash === "#sec-secrets" || hash === "#sec-auth";
  }

  function openSettings() {
    var overlay = document.getElementById("settings-overlay");
    if (!overlay) return;
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("settings-open");
  }

  function closeSettings() {
    var overlay = document.getElementById("settings-overlay");
    if (!overlay) return;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("settings-open");
    if (isSettingsHash()) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }

  function bindSettingsPanel() {
    var overlay = document.getElementById("settings-overlay");
    var openBtn = document.getElementById("open-settings");
    var closeBtn = document.getElementById("close-settings");
    if (!overlay || !openBtn) return;
    openBtn.addEventListener("click", function () {
      openSettings();
      if (window.location.hash !== "#configuracion") {
        history.replaceState(null, "", "#configuracion");
      }
    });
    if (closeBtn) closeBtn.addEventListener("click", closeSettings);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) closeSettings();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeSettings();
    });
    applySecretsVisibility(loadSession());
    if (isSettingsHash()) openSettings();
  }

  bindSettingsPanel();

  global.PagesAuth = {
    bootLogin: bootLogin,
    bootPage: bootPage,
    isAuthed: isAuthed,
    session: loadSession,
    openSettings: openSettings,
    closeSettings: closeSettings,
    getLlmConfig: function () {
      return global.PagesLlm && global.PagesLlm.getLlmForRequest
        ? global.PagesLlm.getLlmForRequest()
        : { apiKey: "", model: "", fromStorage: false };
    },
  };
})(window);
