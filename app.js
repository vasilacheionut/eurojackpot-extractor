(function () {
  const THEME_STORAGE_KEY = "eurojackpot_theme";
  const ZOOM_STORAGE_KEY = "eurojackpot_pinch_zoom";
  const FILTERS_STORAGE_KEY = "eurojackpot_filters";
  const HISTORY_STORAGE_KEY = "eurojackpot_gen_history";
  const DRAWS_CACHE_KEY = "eurojackpot_draws_cache";

  let allDrawsDesc = [];
  let currentMain = [];
  let currentBonus = [];
  let genHistory = [];
  let deferredPrompt = null;
  let currentOnlineState = typeof navigator.onLine === "boolean" ? navigator.onLine : true;
  let pinchZoomEnabled = false;

  function applyDrawsWordColor(isOnline) {
    currentOnlineState = Boolean(isOnline);
    const wordEl = document.getElementById("draws-word");
    if (!wordEl) return;
    wordEl.classList.toggle("online", currentOnlineState);
    wordEl.classList.toggle("offline", !currentOnlineState);
  }

  function setStatus(msg) {
    document.getElementById("status-msg").textContent = msg;
  }

  function reloadPage(e) {
    if (e) e.preventDefault();
    window.location.reload();
  }

  function applyPinchZoom(enabled) {
    pinchZoomEnabled = Boolean(enabled);
    document.documentElement.setAttribute(
      "data-pinch-zoom",
      pinchZoomEnabled ? "on" : "off"
    );

    const viewportMeta = document.querySelector('meta[name="viewport"]');
    if (viewportMeta) {
      viewportMeta.setAttribute(
        "content",
        pinchZoomEnabled
          ? "width=device-width, initial-scale=1.0, maximum-scale=4.0, user-scalable=yes"
          : "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
      );
    }

    const btn = document.getElementById("zoom-btn");
    if (btn) {
      btn.textContent = pinchZoomEnabled ? "Zoom: ON" : "Zoom: OFF";
      btn.classList.toggle("zoom-active", pinchZoomEnabled);
    }
  }

  function initZoom() {
    let saved = "off";
    try {
      saved = window.localStorage.getItem(ZOOM_STORAGE_KEY) || "off";
    } catch (e) {
      saved = "off";
    }
    applyPinchZoom(saved === "on");
  }

  function togglePinchZoom() {
    const next = !pinchZoomEnabled;
    applyPinchZoom(next);
    try {
      window.localStorage.setItem(ZOOM_STORAGE_KEY, next ? "on" : "off");
    } catch (e) {
      // ignoră dacă localStorage nu este accesibil
    }
  }

  function applyTheme(theme) {
    const normalized = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", normalized);
    const btn = document.getElementById("theme-btn");
    if (btn) {
      btn.textContent =
        normalized === "dark" ? "Temă: Întunecat" : "Temă: Deschis";
    }
    return normalized;
  }

  function initTheme() {
    let saved = null;
    try {
      saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch (e) {
      saved = null;
    }
    applyTheme(saved === "light" ? "light" : "dark");
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (e) {
      // ignoră dacă localStorage nu este accesibil
    }
  }

  function readSavedFilters() {
    try {
      const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
      if (!raw) return { year: "ALL", mainDiff: "ALL", digitDiff: "ALL", euroDiff: "ALL" };
      const parsed = JSON.parse(raw);
      return {
        year: parsed && parsed.year ? String(parsed.year) : "ALL",
        mainDiff: parsed && parsed.mainDiff ? String(parsed.mainDiff) : "ALL",
        digitDiff: parsed && parsed.digitDiff ? String(parsed.digitDiff) : "ALL",
        euroDiff: parsed && parsed.euroDiff ? String(parsed.euroDiff) : "ALL"
      };
    } catch (e) {
      return { year: "ALL", mainDiff: "ALL", digitDiff: "ALL", euroDiff: "ALL" };
    }
  }

  function saveCurrentFilters() {
    const payload = {
      year: document.getElementById("year-filter").value || "ALL",
      mainDiff: document.getElementById("main-diff-filter").value || "ALL",
      digitDiff: document.getElementById("digit-diff-filter").value || "ALL",
      euroDiff: document.getElementById("euro-diff-filter").value || "ALL"
    };
    try {
      window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      // ignoră dacă localStorage nu este accesibil
    }
  }

  function setSelectIfAvailable(selectEl, targetValue) {
    if (!selectEl) return;
    const exists = Array.from(selectEl.options).some(function (o) {
      return o.value === targetValue;
    });
    selectEl.value = exists ? targetValue : "ALL";
  }

  function switchTab(tabName) {
    const tabs = ["draws", "generator", "matrix", "json"];
    tabs.forEach(function (t) {
      const active = t === tabName;
      const btn = document.getElementById("tab-" + t + "-btn");
      const panel = document.getElementById("panel-" + t);
      if (btn) {
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", String(active));
      }
      if (panel) {
        panel.classList.toggle("active", active);
      }
    });
  }

  /* --- PWA INSTALL & SERVICE WORKER --- */
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById("install-btn");
    if (installBtn) installBtn.hidden = false;
  });

  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    const installBtn = document.getElementById("install-btn");
    if (installBtn) installBtn.hidden = true;
  });

  function triggerInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () {
      deferredPrompt = null;
      const installBtn = document.getElementById("install-btn");
      if (installBtn) installBtn.hidden = true;
    });
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(function () {});
    }
  }

  /* --- EXTRAGERI, BILE DISTANȚE & DISTANȚĂ CIFRE --- */
  function computeDiffs(nums) {
    const valid = Array.isArray(nums)
      ? nums.map(Number).filter(function (n) { return Number.isFinite(n); })
      : [];
    const diffs = [];
    for (let i = 0; i < valid.length - 1; i++) {
      diffs.push(Math.abs(valid[i + 1] - valid[i]));
    }
    return diffs;
  }

  function getTwoDigits(num) {
    const clean = Math.abs(Math.trunc(Number(num))) || 0;
    const padded = String(clean).padStart(2, "0");
    const c1 = Number(padded[padded.length - 2]);
    const c2 = Number(padded[padded.length - 1]);
    return [c1, c2];
  }

  function computeDigitDiff(num) {
    const [c1, c2] = getTwoDigits(num);
    return Math.abs(c1 - c2);
  }

  function computeMainDigitDiffs(nums) {
    const valid = Array.isArray(nums)
      ? nums.map(Number).filter(function (n) { return Number.isFinite(n); })
      : [];
    return valid.map(computeDigitDiff);
  }

  function getDigitParityCode(num) {
    const [c1, c2] = getTwoDigits(num);
    const p1 = c1 % 2 === 0 ? "P" : "I";
    const p2 = c2 % 2 === 0 ? "P" : "I";
    return p1 + p2;
  }

  function parityClass(num) {
    return "parity-" + getDigitParityCode(num);
  }

  function getMainColorsSummary(mainNumbers) {
    const orderedCodes = ["PP", "PI", "IP", "II"];
    const presentSet = new Set();

    (mainNumbers || []).slice(0, 5).forEach(function (n) {
      const code = getDigitParityCode(n);
      if (orderedCodes.includes(code)) {
        presentSet.add(code);
      }
    });

    const presentList = orderedCodes.filter(function (c) {
      return presentSet.has(c);
    });

    return {
      count: presentList.length,
      total: 4,
      codesText: presentList.length ? presentList.join(" ") : "-"
    };
  }

  /* --- PANOU 1-50, PARITATE PP/PI/IP/II & LISTĂ DISTANȚE CIFRE --- */
  function renderMatrixTab() {
    const boardEl = document.getElementById("board-1-50");
    const legendEl = document.getElementById("parity-legend");
    const diffListEl = document.getElementById("digit-diff-list");

    const groups = {
      PP: [],
      PI: [],
      IP: [],
      II: []
    };

    const diffGroups = new Map();
    for (let d = 0; d <= 9; d++) {
      diffGroups.set(d, []);
    }

    let boardHtml = "";
    for (let n = 1; n <= 50; n++) {
      const code = getDigitParityCode(n);
      groups[code].push(n);

      const dist = computeDigitDiff(n);
      if (!diffGroups.has(dist)) diffGroups.set(dist, []);
      diffGroups.get(dist).push(n);

      boardHtml +=
        '<span class="board-num parity-' +
        code +
        '" title="' +
        n +
        " (" +
        code +
        ", dist. cifre: " +
        dist +
        ')">' +
        n +
        "</span>";
    }

    if (boardEl) boardEl.innerHTML = boardHtml;

    const parityMeta = [
      { code: "PP", label: "Bleumarin" },
      { code: "PI", label: "Verde" },
      { code: "IP", label: "Violet" },
      { code: "II", label: "Roșu" }
    ];

    if (legendEl) {
      legendEl.innerHTML = parityMeta
        .map(function (item) {
          const chipsHtml = groups[item.code]
            .map(function (num) {
              return '<span class="mini-chip parity-' + item.code + '">' + num + "</span>";
            })
            .join("");

          return (
            '<div class="legend-item">' +
            '<div class="legend-head">' +
            '<span class="badge-parity parity-' +
            item.code +
            '">' +
            item.code +
            "</span>" +
            '<span class="color-name">' +
            item.label +
            "</span>" +
            "</div>" +
            '<div class="legend-nums">' +
            chipsHtml +
            "</div>" +
            "</div>"
          );
        })
        .join("");
    }

    if (diffListEl) {
      const sortedKeys = Array.from(diffGroups.keys()).sort(function (a, b) { return a - b; });
      diffListEl.innerHTML = sortedKeys
        .map(function (k) {
          const list = diffGroups.get(k) || [];
          if (!list.length) return "";
          const chipsHtml = list
            .map(function (num) {
              return '<span class="mini-chip ' + parityClass(num) + '">' + num + "</span>";
            })
            .join("");

          return (
            '<div class="digit-diff-row">' +
            '<span class="digit-diff-key">' +
            k +
            ":</span>" +
            '<div class="digit-diff-vals">' +
            chipsHtml +
            "</div>" +
            "</div>"
          );
        })
        .join("");
    }
  }

  function renderDrawMatrix(mainNumbers, euroNumbers, highlightOpts) {
    const opts = highlightOpts || {};
    const targetMainDiff = opts.mainDiff;
    const targetDigitDiff = opts.digitDiff;
    const targetEuroDiff = opts.euroDiff;

    const mainDiffs = computeDiffs(mainNumbers);
    const euroDiffs = computeDiffs(euroNumbers);

    let cellsHtml = "";

    mainNumbers.forEach(function (n, idx) {
      const col = idx * 2 + 1;
      const digitDiff = computeDigitDiff(n);
      const isDigitMatch =
        Number.isFinite(targetDigitDiff) && digitDiff === targetDigitDiff;

      cellsHtml +=
        '<span class="ball ' +
        parityClass(n) +
        (isDigitMatch ? " match-highlight" : "") +
        '" style="grid-column:' +
        col +
        ';grid-row:1;">' +
        n +
        "</span>";
      cellsHtml +=
        '<span class="digit-diff-ball' +
        (isDigitMatch ? " match-highlight" : "") +
        '" style="grid-column:' +
        col +
        ';grid-row:3;">' +
        digitDiff +
        "</span>";
    });

    mainDiffs.forEach(function (d, idx) {
      const col = idx * 2 + 2;
      const isMainMatch = Number.isFinite(targetMainDiff) && d === targetMainDiff;
      cellsHtml +=
        '<span class="diff-ball' +
        (isMainMatch ? " match-highlight" : "") +
        '" style="grid-column:' +
        col +
        ';grid-row:2;">' +
        d +
        "</span>";
    });

    cellsHtml += '<span class="sep" style="grid-column:10;grid-row:1;">+</span>';

    euroNumbers.forEach(function (n, idx) {
      const col = 11 + idx * 2;
      const euroDigitDiff = computeDigitDiff(n);
      cellsHtml +=
        '<span class="ball ' +
        parityClass(n) +
        '" style="grid-column:' +
        col +
        ';grid-row:1;">' +
        n +
        "</span>";
      cellsHtml +=
        '<span class="digit-diff-ball euro-digit" style="grid-column:' +
        col +
        ';grid-row:3;">' +
        euroDigitDiff +
        "</span>";
    });

    euroDiffs.forEach(function (d, idx) {
      const col = 12 + idx * 2;
      const isEuroMatch = Number.isFinite(targetEuroDiff) && d === targetEuroDiff;
      cellsHtml +=
        '<span class="diff-ball euro' +
        (isEuroMatch ? " match-highlight" : "") +
        '" style="grid-column:' +
        col +
        ';grid-row:2;">' +
        d +
        "</span>";
    });

    return '<div class="draw-matrix">' + cellsHtml + "</div>";
  }

  function dateToSortableInt(dateStr) {
    const m = String(dateStr || "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return 0;
    return Number(m[3] + m[2] + m[1]);
  }

  function extractYear(draw) {
    if (draw && Number.isInteger(Number(draw.year)) && Number(draw.year) > 0) {
      return Number(draw.year);
    }
    const m = String(draw && draw.date ? draw.date : "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    return m ? Number(m[3]) : 0;
  }

  function normalizeDraws(rawData) {
    const list = Array.isArray(rawData)
      ? rawData
      : Array.isArray(rawData && rawData.draws)
        ? rawData.draws
        : [];

    return list
      .map((item) => ({
        date: String(item.date || "").trim(),
        year: extractYear(item),
        mainNumbers: Array.isArray(item.mainNumbers) ? item.mainNumbers : [],
        euroNumbers: Array.isArray(item.euroNumbers) ? item.euroNumbers : []
      }))
      .filter((item) => item.date.length > 0)
      .sort((a, b) => dateToSortableInt(b.date) - dateToSortableInt(a.date));
  }

  function populateYearFilter(draws) {
    const select = document.getElementById("year-filter");
    const yearsSet = new Set(draws.map((d) => d.year).filter((y) => y > 0));
    for (let y = 2026; y >= 2012; y--) {
      yearsSet.add(y);
    }
    const sortedYears = Array.from(yearsSet).sort((a, b) => b - a);

    select.innerHTML = '<option value="ALL">Toți anii (2026–2012)</option>';
    for (const yr of sortedYears) {
      const opt = document.createElement("option");
      opt.value = String(yr);
      opt.textContent = String(yr);
      select.appendChild(opt);
    }
  }

  function populateDiffFilters(draws) {
    const mainSelect = document.getElementById("main-diff-filter");
    const digitSelect = document.getElementById("digit-diff-filter");
    const euroSelect = document.getElementById("euro-diff-filter");

    const mainSet = new Set();
    const digitSet = new Set();
    const euroSet = new Set();

    draws.forEach(function (d) {
      computeDiffs(d.mainNumbers).forEach(function (val) {
        mainSet.add(val);
      });
      computeMainDigitDiffs(d.mainNumbers).forEach(function (val) {
        digitSet.add(val);
      });
      computeDiffs(d.euroNumbers).forEach(function (val) {
        euroSet.add(val);
      });
    });

    const sortedMain = Array.from(mainSet).sort(function (a, b) { return a - b; });
    const sortedDigit = Array.from(digitSet).sort(function (a, b) { return a - b; });
    const sortedEuro = Array.from(euroSet).sort(function (a, b) { return a - b; });

    mainSelect.innerHTML = '<option value="ALL">Toate</option>';
    sortedMain.forEach(function (val) {
      const opt = document.createElement("option");
      opt.value = String(val);
      opt.textContent = "Dist. " + val;
      mainSelect.appendChild(opt);
    });

    digitSelect.innerHTML = '<option value="ALL">Toate</option>';
    sortedDigit.forEach(function (val) {
      const opt = document.createElement("option");
      opt.value = String(val);
      opt.textContent = "Cifre " + val;
      digitSelect.appendChild(opt);
    });

    euroSelect.innerHTML = '<option value="ALL">Toate</option>';
    sortedEuro.forEach(function (val) {
      const opt = document.createElement("option");
      opt.value = String(val);
      opt.textContent = "Dist. " + val;
      euroSelect.appendChild(opt);
    });
  }

  function applySavedFiltersToSelects() {
    const saved = readSavedFilters();
    setSelectIfAvailable(document.getElementById("year-filter"), saved.year);
    setSelectIfAvailable(document.getElementById("main-diff-filter"), saved.mainDiff);
    setSelectIfAvailable(document.getElementById("digit-diff-filter"), saved.digitDiff);
    setSelectIfAvailable(document.getElementById("euro-diff-filter"), saved.euroDiff);
    saveCurrentFilters();
  }

  function handleFilterChange() {
    saveCurrentFilters();
    renderDraws();
  }

  function resetDiffAndYearFilters() {
    document.getElementById("year-filter").value = "ALL";
    document.getElementById("main-diff-filter").value = "ALL";
    document.getElementById("digit-diff-filter").value = "ALL";
    document.getElementById("euro-diff-filter").value = "ALL";
    saveCurrentFilters();
    renderDraws();
  }

  function updateStatsStrip(filteredDraws, filterState) {
    const summaryEl = document.getElementById("stats-summary");
    const parityEl = document.getElementById("stats-parity");
    if (!summaryEl || !parityEl) return;

    const counts = { PP: 0, PI: 0, IP: 0, II: 0 };
    let hitsCount = 0;

    filteredDraws.forEach(function (d) {
      (d.mainNumbers || []).slice(0, 5).forEach(function (n) {
        const code = getDigitParityCode(n);
        if (counts[code] !== undefined) counts[code]++;
        if (filterState.digitDiff !== "ALL" && computeDigitDiff(n) === Number(filterState.digitDiff)) {
          hitsCount++;
        }
      });
      if (filterState.mainDiff !== "ALL") {
        hitsCount += computeDiffs(d.mainNumbers).filter(function (x) {
          return x === Number(filterState.mainDiff);
        }).length;
      }
      if (filterState.euroDiff !== "ALL") {
        hitsCount += computeDiffs(d.euroNumbers).filter(function (x) {
          return x === Number(filterState.euroDiff);
        }).length;
      }
    });

    const hasDiffFilter =
      filterState.mainDiff !== "ALL" ||
      filterState.digitDiff !== "ALL" ||
      filterState.euroDiff !== "ALL";

    summaryEl.innerHTML =
      "Extrageri: <strong>" +
      filteredDraws.length +
      "</strong>" +
      (hasDiffFilter ? " · Apariții: <strong>" + hitsCount + "</strong>" : "");

    parityEl.innerHTML = ["PP", "PI", "IP", "II"]
      .map(function (code) {
        return (
          '<span class="stat-pill parity-' +
          code +
          '">' +
          code +
          " " +
          counts[code] +
          "</span>"
        );
      })
      .join("");
  }

  function renderDraws() {
    const container = document.getElementById("draws-list");
    const selectedYear = document.getElementById("year-filter").value;
    const selectedMainDiff = document.getElementById("main-diff-filter").value;
    const selectedDigitDiff = document.getElementById("digit-diff-filter").value;
    const selectedEuroDiff = document.getElementById("euro-diff-filter").value;

    const filtered = allDrawsDesc.filter(function (d) {
      if (selectedYear !== "ALL" && String(d.year) !== selectedYear) {
        return false;
      }
      if (selectedMainDiff !== "ALL") {
        const targetMain = Number(selectedMainDiff);
        const mDiffs = computeDiffs(d.mainNumbers);
        if (!mDiffs.includes(targetMain)) {
          return false;
        }
      }
      if (selectedDigitDiff !== "ALL") {
        const targetDigit = Number(selectedDigitDiff);
        const dDiffs = computeMainDigitDiffs(d.mainNumbers);
        if (!dDiffs.includes(targetDigit)) {
          return false;
        }
      }
      if (selectedEuroDiff !== "ALL") {
        const targetEuro = Number(selectedEuroDiff);
        const eDiffs = computeDiffs(d.euroNumbers);
        if (!eDiffs.includes(targetEuro)) {
          return false;
        }
      }
      return true;
    });

    updateStatsStrip(filtered, {
      year: selectedYear,
      mainDiff: selectedMainDiff,
      digitDiff: selectedDigitDiff,
      euroDiff: selectedEuroDiff
    });

    if (!filtered.length) {
      container.innerHTML = '<div class="empty-msg">Nu există extrageri pentru filtrele selectate.</div>';
      return;
    }

    const highlightOpts = {
      mainDiff: selectedMainDiff !== "ALL" ? Number(selectedMainDiff) : NaN,
      digitDiff: selectedDigitDiff !== "ALL" ? Number(selectedDigitDiff) : NaN,
      euroDiff: selectedEuroDiff !== "ALL" ? Number(selectedEuroDiff) : NaN
    };

    container.innerHTML = filtered
      .map((d) => {
        const colorInfo = getMainColorsSummary(d.mainNumbers);
        return `
          <div class="draw-card">
            <div class="draw-header">
              <span class="draw-date">${d.date}</span>
              <div class="draw-meta-right">
                <span class="draw-colors-tag">Culori ${colorInfo.count}/${colorInfo.total}: ${colorInfo.codesText}</span>
                <span class="draw-year">${d.year || "-"}</span>
              </div>
            </div>
            ${renderDrawMatrix(d.mainNumbers, d.euroNumbers, highlightOpts)}
          </div>
        `;
      })
      .join("");
  }

  function saveDrawsCacheToLocalStorage(rawData) {
    try {
      window.localStorage.setItem(DRAWS_CACHE_KEY, JSON.stringify(rawData));
      return true;
    } catch (e) {
      return false;
    }
  }

  function readDrawsCacheFromLocalStorage() {
    try {
      const raw = window.localStorage.getItem(DRAWS_CACHE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function applyDrawsPayload(data, isOnline) {
    allDrawsDesc = normalizeDraws(data);
    populateYearFilter(allDrawsDesc);
    populateDiffFilters(allDrawsDesc);
    applySavedFiltersToSelects();
    renderDraws();

    document.getElementById("json-view").value = JSON.stringify(data, null, 2);

    const latestDate = allDrawsDesc.length ? allDrawsDesc[0].date : "-";
    const oldestDate = allDrawsDesc.length ? allDrawsDesc[allDrawsDesc.length - 1].date : "-";
    const stateClass = isOnline ? "online" : "offline";

    document.getElementById("meta-info").innerHTML =
      '<span id="draws-word" class="draws-word ' +
      stateClass +
      '">Extrageri</span>: <strong>' +
      allDrawsDesc.length +
      "</strong> | Interval: <strong>" +
      latestDate +
      " → " +
      oldestDate +
      "</strong>";
    applyDrawsWordColor(isOnline);
  }

  function fetchWithTimeout(url, timeoutMs) {
    if (typeof AbortController === "function") {
      const controller = new AbortController();
      const timer = setTimeout(function () {
        controller.abort();
      }, timeoutMs || 3500);

      return fetch(url, {
        cache: "no-store",
        signal: controller.signal
      }).finally(function () {
        clearTimeout(timer);
      });
    }
    return fetch(url, { cache: "no-store" });
  }

  function loadJsonFile() {
    setStatus("Se verifică conexiunea...");
    const cached = readDrawsCacheFromLocalStorage();

    if (typeof navigator.onLine === "boolean" && !navigator.onLine) {
      applyDrawsWordColor(false);
      if (cached) {
        applyDrawsPayload(cached, false);
        setStatus("Offline — date încărcate din localStorage.");
      } else {
        setStatus("Offline — nu există copie în localStorage.");
      }
      return;
    }

    fetchWithTimeout("./draws.json?t=" + Date.now(), 3500)
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then((data) => {
        saveDrawsCacheToLocalStorage(data);
        applyDrawsPayload(data, true);
        setStatus("Online — JSON încărcat.");
      })
      .catch((err) => {
        applyDrawsWordColor(false);
        if (cached) {
          applyDrawsPayload(cached, false);
          setStatus("Offline — date încărcate din localStorage.");
        } else {
          document.getElementById("draws-list").innerHTML =
            '<div class="empty-msg">Nu s-a putut citi draws.json (' + err.message + ').</div>';
          setStatus("Offline (" + err.message + ").");
        }
      });
  }

  function fallbackCopyText(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
    } catch (e) {
      // ignoră dacă nu este permis
    }
    document.body.removeChild(textarea);
  }

  function copyJson() {
    const text = document.getElementById("json-view").value;
    if (!text) {
      setStatus("Nu există conținut JSON de copiat.");
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => setStatus("JSON copiat în clipboard."))
        .catch(() => {
          fallbackCopyText(text);
          setStatus("JSON copiat în clipboard.");
        });
    } else {
      fallbackCopyText(text);
      setStatus("JSON copiat în clipboard.");
    }
  }

  /* --- GENERATOR 5/50 + 2/12 --- */
  function getRandomInt(maxExclusive) {
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      const buf = new Uint32Array(1);
      window.crypto.getRandomValues(buf);
      return buf[0] % maxExclusive;
    }
    return Math.floor(Math.random() * maxExclusive);
  }

  function drawUniqueNumbers(count, max) {
    const pool = [];
    for (let i = 1; i <= max; i++) {
      pool.push(i);
    }

    for (let i = pool.length - 1; i > 0; i--) {
      const j = getRandomInt(i + 1);
      const temp = pool[i];
      pool[i] = pool[j];
      pool[j] = temp;
    }

    return pool.slice(0, count).sort(function (a, b) {
      return a - b;
    });
  }

  function formatNumber(num) {
    return num < 10 ? "0" + num : String(num);
  }

  function renderGenBalls(containerId, numbers) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    numbers.forEach(function (num) {
      const col = document.createElement("div");
      col.className = "gen-col";

      const ball = document.createElement("div");
      ball.className = "gen-ball " + parityClass(num);
      ball.textContent = formatNumber(num);

      const digitDiff = document.createElement("span");
      digitDiff.className = "gen-digit-diff";
      digitDiff.textContent = String(computeDigitDiff(num));

      col.appendChild(ball);
      col.appendChild(digitDiff);
      container.appendChild(col);
    });
  }

  function renderGenDiffs(containerId, numbers, isEuro) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const diffs = computeDiffs(numbers);

    container.innerHTML = diffs
      .map(function (d) {
        return (
          '<span class="gen-diff-ball' +
          (isEuro ? " euro" : "") +
          '">' +
          d +
          "</span>"
        );
      })
      .join("");
  }

  function saveGenHistory() {
    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(genHistory.slice(0, 10)));
    } catch (e) {
      // ignoră dacă localStorage nu este accesibil
    }
  }

  function renderHistoryList() {
    const list = document.getElementById("history-list");
    if (!list) return;

    if (!genHistory.length) {
      list.innerHTML = '<li class="history-empty">Nicio variantă salvată în istoric.</li>';
      return;
    }

    list.innerHTML = genHistory
      .slice(0, 10)
      .map(function (item) {
        const main = Array.isArray(item.main) ? item.main : [];
        const bonus = Array.isArray(item.bonus) ? item.bonus : [];

        const mainHtml = main
          .map(function (n) {
            return '<span class="mini-chip ' + parityClass(n) + '">' + formatNumber(n) + "</span>";
          })
          .join("");

        const bonusHtml = bonus
          .map(function (n) {
            return '<span class="mini-chip ' + parityClass(n) + '">' + formatNumber(n) + "</span>";
          })
          .join("");

        return (
          "<li>" +
          '<span class="history-group">' +
          mainHtml +
          '</span><span class="history-group">★ ' +
          bonusHtml +
          "</span>" +
          "</li>"
        );
      })
      .join("");
  }

  function initGenHistory() {
    try {
      const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          genHistory = parsed.slice(0, 10);
        }
      }
    } catch (e) {
      genHistory = [];
    }

    if (genHistory.length) {
      currentMain = genHistory[0].main.slice();
      currentBonus = genHistory[0].bonus.slice();
      renderGenBalls("main-numbers", currentMain);
      renderGenBalls("bonus-numbers", currentBonus);
      renderGenDiffs("main-diffs", currentMain, false);
      renderGenDiffs("bonus-diffs", currentBonus, true);
      renderHistoryList();
    } else {
      generateCombination();
    }
  }

  function addToHistory(main, bonus) {
    genHistory.unshift({
      main: main.slice(),
      bonus: bonus.slice()
    });
    if (genHistory.length > 10) {
      genHistory = genHistory.slice(0, 10);
    }
    saveGenHistory();
    renderHistoryList();
  }

  function clearGenHistory() {
    genHistory = [];
    try {
      window.localStorage.removeItem(HISTORY_STORAGE_KEY);
    } catch (e) {
      // ignoră dacă localStorage nu este accesibil
    }
    renderHistoryList();
  }

  function generateCombination() {
    currentMain = drawUniqueNumbers(5, 50);
    currentBonus = drawUniqueNumbers(2, 12);

    renderGenBalls("main-numbers", currentMain);
    renderGenBalls("bonus-numbers", currentBonus);
    renderGenDiffs("main-diffs", currentMain, false);
    renderGenDiffs("bonus-diffs", currentBonus, true);
    addToHistory(currentMain, currentBonus);
  }

  function copyGenResult() {
    if (!currentMain.length || !currentBonus.length) return;

    const text =
      currentMain.map(formatNumber).join(", ") +
      " | Stele: " +
      currentBonus.map(formatNumber).join(", ");

    const btn = document.getElementById("copy-gen-btn");

    const onCopied = function () {
      if (!btn) return;
      btn.textContent = "Copiat!";
      setTimeout(function () {
        btn.textContent = "Copiază";
      }, 1500);
    };

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard
        .writeText(text)
        .then(onCopied)
        .catch(function () {
          fallbackCopyText(text);
          onCopied();
        });
    } else {
      fallbackCopyText(text);
      onCopied();
    }
  }

  window.addEventListener("online", function () {
    loadJsonFile();
  });

  window.addEventListener("offline", function () {
    applyDrawsWordColor(false);
    setStatus("Offline — date din localStorage.");
  });

  window.addEventListener("pageshow", function () {
    loadJsonFile();
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      loadJsonFile();
    }
  });

  document.addEventListener("DOMContentLoaded", function () {
    applyDrawsWordColor(currentOnlineState);
    initZoom();
    initTheme();
    registerServiceWorker();
    renderMatrixTab();

    document.getElementById("brand-reload-link").addEventListener("click", reloadPage);
    document.getElementById("install-btn").addEventListener("click", triggerInstall);
    document.getElementById("zoom-btn").addEventListener("click", togglePinchZoom);
    document.getElementById("theme-btn").addEventListener("click", toggleTheme);

    document.getElementById("tab-draws-btn").addEventListener("click", function () {
      switchTab("draws");
    });
    document.getElementById("tab-generator-btn").addEventListener("click", function () {
      switchTab("generator");
    });
    document.getElementById("tab-matrix-btn").addEventListener("click", function () {
      switchTab("matrix");
    });
    document.getElementById("tab-json-btn").addEventListener("click", function () {
      switchTab("json");
    });

    document.getElementById("year-filter").addEventListener("change", handleFilterChange);
    document.getElementById("main-diff-filter").addEventListener("change", handleFilterChange);
    document.getElementById("digit-diff-filter").addEventListener("change", handleFilterChange);
    document.getElementById("euro-diff-filter").addEventListener("change", handleFilterChange);
    document.getElementById("reset-filters-btn").addEventListener("click", resetDiffAndYearFilters);

    document.getElementById("reload-btn").addEventListener("click", loadJsonFile);
    document.getElementById("copy-btn").addEventListener("click", copyJson);

    document.getElementById("generate-btn").addEventListener("click", generateCombination);
    document.getElementById("copy-gen-btn").addEventListener("click", copyGenResult);
    document.getElementById("clear-history-btn").addEventListener("click", clearGenHistory);

    initGenHistory();
    loadJsonFile();
  });
})();
