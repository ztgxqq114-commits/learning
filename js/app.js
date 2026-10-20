/*
 * 立德學習平台 主程式
 * ------------------------------------------------------------
 * 一般上架新單元「不需要」改這個檔案，只要改 Google 試算表。
 *
 * 結構：
 *   1. 工具函式（讀 CSV、轉換時間、跳脫 HTML）
 *   2. 載入資料 → 整理成課程
 *   3. 學習進度（存在學員自己的瀏覽器）
 *   4. 頁面：課程目錄、課程播放頁
 *   5. YouTube 播放器、測驗
 *   6. 網址路由（#/ 是目錄，#/c/課程ID/單元ID 是播放頁）
 */
(function () {
  "use strict";

  const CONFIG = window.LIDE_CONFIG || {};
  const TRACKS = CONFIG.tracks || ["搞順自己", "挺好隊友", "發揮影響力"];
  const main = document.getElementById("main");
  const state = { units: [], quizzes: {}, courses: [], filter: { q: "", track: "", term: "" } };

  /* ---------- 1. 工具函式 ---------- */

  // 解析 CSV（支援引號內的逗號與換行）
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    const headers = (rows.shift() || []).map(h => h.trim());
    return rows
      .filter(r => r.some(v => v.trim() !== ""))
      .map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] || "").trim()])));
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  // "03:15" 或 "1:02:30" → 秒數
  function toSeconds(t) {
    const parts = String(t).trim().split(":").map(Number);
    if (parts.some(isNaN)) return 0;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }

  // 接受完整 YouTube 網址或影片 ID
  function youtubeId(v) {
    v = String(v || "").trim();
    const m = v.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/);
    if (m) return m[1];
    return /^[\w-]{11}$/.test(v) ? v : "";
  }

  function lines(s) {
    return String(s || "").split(/\n/).map(x => x.trim()).filter(Boolean);
  }

  function trackIndex(track) {
    const i = TRACKS.indexOf(track);
    return i === -1 ? 0 : i;
  }

  /* ---------- 2. 載入資料 ---------- */

  async function fetchCSV(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(url + " 回應 " + res.status);
    return parseCSV(await res.text());
  }

  async function loadData() {
    const unitsUrl = CONFIG.unitsCsvUrl || "data/units.csv";
    const quizzesUrl = CONFIG.quizzesCsvUrl || "data/quizzes.csv";
    const [unitRows, quizRows] = await Promise.all([fetchCSV(unitsUrl), fetchCSV(quizzesUrl)]);

    // 只顯示「上架」欄是「是」的單元，其他當作草稿
    state.units = unitRows
      .filter(r => r["單元ID"] && /^(是|yes|true|v|1)$/i.test(r["上架"]))
      .map(r => ({
        id: r["單元ID"],
        courseId: r["課程ID"],
        courseTitle: r["課程名稱"],
        track: r["主軸"],
        term: r["學期"],
        speaker: r["講者"],
        order: Number(r["順序"]) || 0,
        title: r["單元名稱"],
        videoId: youtubeId(r["YouTube網址"]),
        duration: r["長度"],
        summary: r["單元介紹"],
        chapters: lines(r["章節"]).map(l => {
          const m = l.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*(.*)$/);
          return m ? { time: m[1], sec: toSeconds(m[1]), title: m[2] || m[1] } : null;
        }).filter(Boolean),
        notes: lines(r["重點筆記"]),
        handout: r["講義連結"]
      }));

    state.quizzes = {};
    quizRows.forEach(r => {
      if (!r["單元ID"] || !r["題目"]) return;
      const options = ["A", "B", "C", "D"]
        .map(k => ({ key: k, text: r["選項" + k] }))
        .filter(o => o.text);
      (state.quizzes[r["單元ID"]] = state.quizzes[r["單元ID"]] || []).push({
        no: Number(r["題號"]) || 0,
        question: r["題目"],
        options,
        answer: (r["答案"] || "").toUpperCase().trim(),
        explanation: r["解析"],
        time: r["對應時間"]
      });
    });
    Object.values(state.quizzes).forEach(qs => qs.sort((a, b) => a.no - b.no));

    // 依課程ID 把單元組成課程
    const map = new Map();
    state.units.forEach(u => {
      if (!map.has(u.courseId)) {
        map.set(u.courseId, {
          id: u.courseId, title: u.courseTitle, track: u.track,
          term: u.term, speaker: u.speaker, units: []
        });
      }
      map.get(u.courseId).units.push(u);
    });
    state.courses = [...map.values()];
    state.courses.forEach(c => c.units.sort((a, b) => a.order - b.order));
  }

  /* ---------- 3. 學習進度（localStorage） ---------- */

  const STORE_KEY = "lide-progress-v1";
  const NAME_KEY = "lide-learner-name";

  function readProgress() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  let progress = readProgress();

  function saveProgress() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) { /* 無法儲存時仍可使用 */ }
  }

  function isDone(unitId) { return !!(progress[unitId] && progress[unitId].done); }

  function courseProgress(course) {
    const done = course.units.filter(u => isDone(u.id)).length;
    return { done, total: course.units.length, pct: course.units.length ? Math.round(done / course.units.length * 100) : 0 };
  }

  function getName() { try { return localStorage.getItem(NAME_KEY) || ""; } catch (e) { return ""; } }
  function setName(n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* 略過 */ } }

  /* ---------- 4a. 課程目錄 ---------- */

  function matches(course) {
    const f = state.filter;
    if (f.track && course.track !== f.track) return false;
    if (f.term && course.term !== f.term) return false;
    if (!f.q) return true;
    const q = f.q.toLowerCase();
    const hay = [course.title, course.speaker, course.term, course.track]
      .concat(course.units.flatMap(u => [u.title, u.summary, u.notes.join(" ")]))
      .join(" ").toLowerCase();
    return hay.includes(q);
  }

  function renderCatalog() {
    document.title = "立德學習平台";
    const terms = [...new Set(state.courses.map(c => c.term))].sort().reverse();
    const f = state.filter;

    const trackStats = TRACKS.map((t, i) => {
      const cs = state.courses.filter(c => c.track === t);
      const units = cs.flatMap(c => c.units);
      const done = units.filter(u => isDone(u.id)).length;
      return `
        <button type="button" class="axis axis-${i}" data-track="${esc(t)}" aria-pressed="${f.track === t}">
          <span class="axis-name">${esc(t)}</span>
          <span class="axis-meta">${cs.length} 門課・${units.length} 個單元</span>
          <span class="axis-bar" aria-hidden="true"><span style="width:${units.length ? done / units.length * 100 : 0}%"></span></span>
          <span class="axis-done">已完成 ${done} / ${units.length}</span>
        </button>`;
    }).join("");

    main.innerHTML = `
      <section class="intro">
        <h1>歷屆課程與工作坊，都在這裡</h1>
        <p>依三大主軸找課程，看影片、讀重點，再用小測驗確認自己學會了。</p>
        <div class="axes">${trackStats}</div>
      </section>

      <section class="finder" aria-label="搜尋與篩選">
        <label class="search">
          <span class="visually-hidden">搜尋課程</span>
          <input id="q" type="search" placeholder="搜尋課程、單元或講者" value="${esc(f.q)}" autocomplete="off">
        </label>
        <label class="term">
          <span>學期</span>
          <select id="term">
            <option value="">全部</option>
            ${terms.map(t => `<option ${f.term === t ? "selected" : ""}>${esc(t)}</option>`).join("")}
          </select>
        </label>
        ${f.track || f.term || f.q ? '<button type="button" class="clear" id="clear">清除篩選</button>' : ""}
      </section>

      <div id="results"></div>`;

    renderResults();

    main.querySelectorAll(".axis").forEach(b => b.addEventListener("click", () => {
      state.filter.track = state.filter.track === b.dataset.track ? "" : b.dataset.track;
      renderCatalog();
    }));
    main.querySelector("#q").addEventListener("input", e => { state.filter.q = e.target.value.trim(); renderResults(); });
    main.querySelector("#term").addEventListener("change", e => { state.filter.term = e.target.value; renderCatalog(); });
    const clear = main.querySelector("#clear");
    if (clear) clear.addEventListener("click", () => { state.filter = { q: "", track: "", term: "" }; renderCatalog(); });
  }

  function renderResults() {
    const box = main.querySelector("#results");
    const list = state.courses.filter(matches);
    if (!list.length) {
      box.innerHTML = `<p class="empty">找不到符合的課程。試試其他關鍵字，或清除篩選。</p>`;
      return;
    }
    const groups = TRACKS.map(t => ({ t, cs: list.filter(c => c.track === t) }))
      .concat([{ t: "其他", cs: list.filter(c => !TRACKS.includes(c.track)) }])
      .filter(g => g.cs.length);

    box.innerHTML = groups.map(g => `
      <section class="lane lane-${trackIndex(g.t)}">
        <h2>${esc(g.t)}</h2>
        <ul class="course-list">
          ${g.cs.map(c => {
            const p = courseProgress(c);
            const next = c.units.find(u => !isDone(u.id)) || c.units[0];
            return `
              <li>
                <a class="course" href="#/c/${encodeURIComponent(c.id)}/${encodeURIComponent(next.id)}">
                  <span class="course-title">${esc(c.title)}</span>
                  <span class="course-meta">${esc(c.term)}｜${esc(c.speaker)}｜${c.units.length} 個單元</span>
                  <span class="course-progress">
                    <span class="bar" aria-hidden="true"><span style="width:${p.pct}%"></span></span>
                    <span>${p.done === p.total ? "已完成" : p.done ? `完成 ${p.done} / ${p.total}` : "尚未開始"}</span>
                  </span>
                </a>
              </li>`;
          }).join("")}
        </ul>
      </section>`).join("");
  }

  /* ---------- 4b. 課程播放頁 ---------- */

  function renderCourse(courseId, unitId) {
    const course = state.courses.find(c => c.id === courseId);
    if (!course) return renderNotFound();
    const idx = Math.max(0, course.units.findIndex(u => u.id === unitId));
    const unit = course.units[idx];
    const quiz = state.quizzes[unit.id] || [];
    const p = courseProgress(course);
    const ti = trackIndex(course.track);
    document.title = `${unit.title}｜${course.title}`;

    const prev = course.units[idx - 1];
    const next = course.units[idx + 1];
    const link = u => `#/c/${encodeURIComponent(course.id)}/${encodeURIComponent(u.id)}`;

    main.innerHTML = `
      <div class="player-layout track-${ti}">
        <aside class="course-nav" aria-label="課程單元">
          <a class="back" href="#/">← 所有課程</a>
          <p class="nav-track">${esc(course.track)}｜${esc(course.term)}</p>
          <h1 class="nav-title">${esc(course.title)}</h1>
          <div class="nav-progress">
            <span class="bar" aria-hidden="true"><span style="width:${p.pct}%"></span></span>
            <span>完成 ${p.done} / ${p.total}</span>
          </div>
          <ol class="unit-list">
            ${course.units.map((u, i) => `
              <li>
                <a href="${link(u)}" ${i === idx ? 'aria-current="page"' : ""} class="${isDone(u.id) ? "done" : ""}">
                  <span class="check" aria-hidden="true">${isDone(u.id) ? "✓" : i + 1}</span>
                  <span>${esc(u.title)}${isDone(u.id) ? '<span class="visually-hidden">（已完成）</span>' : ""}</span>
                </a>
              </li>`).join("")}
          </ol>
        </aside>

        <article class="lesson">
          <header class="lesson-head">
            <p class="lesson-step">單元 ${idx + 1} / ${course.units.length}</p>
            <h2>${esc(unit.title)}</h2>
            <p class="lesson-meta">${esc(unit.speaker)}${unit.duration ? "｜" + esc(unit.duration) : ""}${quiz.length ? `｜測驗 ${quiz.length} 題` : ""}</p>
            ${unit.summary ? `<p class="lesson-summary">${esc(unit.summary)}</p>` : ""}
          </header>

          <div class="video">
            ${unit.videoId
              ? '<div id="player"></div>'
              : '<p class="video-missing">這個單元的影片還沒上架。</p>'}
          </div>

          ${unit.chapters.length ? `
          <section class="chapters" aria-labelledby="ch-h">
            <h3 id="ch-h">章節</h3>
            <ol>
              ${unit.chapters.map(c => `
                <li><button type="button" class="seek" data-sec="${c.sec}">
                  <span class="time">${esc(c.time)}</span><span>${esc(c.title)}</span>
                </button></li>`).join("")}
            </ol>
          </section>` : ""}

          ${unit.notes.length || unit.handout ? `
          <section class="notes" aria-labelledby="notes-h">
            <h3 id="notes-h">重點筆記</h3>
            <ul>${unit.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>
            ${unit.handout ? `<p><a class="handout" href="${esc(unit.handout)}" target="_blank" rel="noopener">開啟講義</a></p>` : ""}
          </section>` : ""}

          <section class="quiz" aria-labelledby="quiz-h" id="quiz">
            ${quiz.length ? renderQuizForm(unit, quiz) : renderMarkDone(unit)}
          </section>

          <nav class="pager" aria-label="上一個與下一個單元">
            ${prev ? `<a href="${link(prev)}">上一個：${esc(prev.title)}</a>` : "<span></span>"}
            ${next ? `<a class="next" href="${link(next)}">下一個：${esc(next.title)}</a>` : `<a class="next" href="#/">回到課程目錄</a>`}
          </nav>
        </article>
      </div>`;

    if (unit.videoId) mountPlayer(unit.videoId);
    main.querySelectorAll(".seek").forEach(b => b.addEventListener("click", () => seek(Number(b.dataset.sec))));
    bindQuiz(unit, quiz, course);
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function renderNotFound() {
    main.innerHTML = `<section class="intro"><h1>找不到這個課程</h1>
      <p>課程可能已經改名或下架。<a href="#/">回到課程目錄</a></p></section>`;
  }

  /* ---------- 5a. YouTube 播放器 ---------- */

  let player = null;
  let ytReady = null;

  function loadYouTubeAPI() {
    if (ytReady) return ytReady;
    ytReady = new Promise(resolve => {
      window.onYouTubeIframeAPIReady = resolve;
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    });
    return ytReady;
  }

  function mountPlayer(videoId) {
    player = null;
    loadYouTubeAPI().then(() => {
      if (!document.getElementById("player")) return;
      player = new YT.Player("player", {
        videoId,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 }
      });
    });
  }

  function seek(sec) {
    const v = main.querySelector(".video");
    if (v) v.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    if (player && player.seekTo) { player.seekTo(sec, true); player.playVideo(); }
  }

  /* ---------- 5b. 測驗 ---------- */

  function renderQuizForm(unit, quiz) {
    const prev = progress[unit.id];
    return `
      <h3 id="quiz-h">看完了嗎？做個小測驗</h3>
      <p class="quiz-hint">${prev && prev.done ? `你上次答對 ${prev.score} / ${prev.total} 題，可以再做一次。` : "全部作答後送出，就會看到解析，這個單元也會標記為完成。"}</p>
      <form id="quiz-form" novalidate>
        ${quiz.map((q, qi) => `
          <fieldset class="q" data-qi="${qi}">
            <legend><span class="q-no">${qi + 1}.</span> ${esc(q.question)}</legend>
            ${q.options.map(o => `
              <label class="opt">
                <input type="radio" name="q${qi}" value="${o.key}">
                <span class="opt-key">${o.key}</span>
                <span>${esc(o.text)}</span>
              </label>`).join("")}
            <div class="feedback" hidden></div>
          </fieldset>`).join("")}
        <label class="learner">
          <span>你的名字（選填，用於試用紀錄）</span>
          <input type="text" id="learner" value="${esc(getName())}" autocomplete="name">
        </label>
        <p class="form-error" role="alert" hidden></p>
        <div class="quiz-actions">
          <button type="submit" class="primary">送出答案</button>
        </div>
      </form>
      <div class="result" role="status" hidden></div>`;
  }

  function renderMarkDone(unit) {
    return `
      <h3 id="quiz-h">完成這個單元</h3>
      <p class="quiz-hint">這個單元沒有測驗。看完影片後，標記完成就會記錄進度。</p>
      <button type="button" class="primary" id="mark-done" ${isDone(unit.id) ? "disabled" : ""}>
        ${isDone(unit.id) ? "已標記完成" : "標記為完成"}
      </button>`;
  }

  function bindQuiz(unit, quiz, course) {
    const markBtn = main.querySelector("#mark-done");
    if (markBtn) markBtn.addEventListener("click", () => {
      progress[unit.id] = { done: true, at: Date.now() };
      saveProgress();
      renderCourse(course.id, unit.id);
    });

    const form = main.querySelector("#quiz-form");
    if (!form) return;
    form.addEventListener("submit", e => {
      e.preventDefault();
      const answers = quiz.map((_, qi) => {
        const c = form.querySelector(`input[name="q${qi}"]:checked`);
        return c ? c.value : null;
      });
      const err = form.querySelector(".form-error");
      const missing = answers.map((a, i) => a ? null : i + 1).filter(Boolean);
      if (missing.length) {
        err.textContent = `第 ${missing.join("、")} 題還沒作答。`;
        err.hidden = false;
        return;
      }
      err.hidden = true;

      let score = 0;
      quiz.forEach((q, qi) => {
        const fs = form.querySelector(`.q[data-qi="${qi}"]`);
        const ok = answers[qi] === q.answer;
        if (ok) score++;
        fs.classList.add(ok ? "is-right" : "is-wrong");
        fs.querySelectorAll("input").forEach(i => { i.disabled = true; });
        fs.querySelectorAll(".opt").forEach(l => {
          const v = l.querySelector("input").value;
          if (v === q.answer) l.classList.add("answer");
        });
        const fb = fs.querySelector(".feedback");
        fb.innerHTML = `
          <p class="verdict">${ok ? "答對了。" : `正確答案是 ${esc(q.answer)}。`}</p>
          ${q.explanation ? `<p>${esc(q.explanation)}</p>` : ""}
          ${q.time ? `<button type="button" class="seek-back" data-sec="${toSeconds(q.time)}">回到 ${esc(q.time)} 複習這段</button>` : ""}`;
        fb.hidden = false;
      });
      form.querySelectorAll(".seek-back").forEach(b => b.addEventListener("click", () => seek(Number(b.dataset.sec))));

      const name = form.querySelector("#learner").value.trim();
      setName(name);
      progress[unit.id] = { done: true, score, total: quiz.length, at: Date.now() };
      saveProgress();
      logQuiz(name, unit.id, score, quiz.length);

      form.querySelector(".quiz-actions").innerHTML =
        `<button type="button" class="secondary" id="retry">重新作答</button>`;
      form.querySelector("#retry").addEventListener("click", () => renderCourse(course.id, unit.id));

      const result = main.querySelector(".result");
      result.innerHTML = `<p><strong>答對 ${score} / ${quiz.length} 題。</strong>這個單元已標記完成。</p>`;
      result.hidden = false;
      refreshNav(course);
    });
  }

  // 只更新左側進度，不重畫影片
  function refreshNav(course) {
    const p = courseProgress(course);
    const np = main.querySelector(".nav-progress");
    if (np) np.innerHTML = `<span class="bar" aria-hidden="true"><span style="width:${p.pct}%"></span></span><span>完成 ${p.done} / ${p.total}</span>`;
    main.querySelectorAll(".unit-list a").forEach((a, i) => {
      const u = course.units[i];
      if (isDone(u.id)) { a.classList.add("done"); a.querySelector(".check").textContent = "✓"; }
    });
  }

  // 送成績到 Google 表單（有設定才送）
  function logQuiz(name, unitId, score, total) {
    const log = CONFIG.quizLog || {};
    const f = log.fields || {};
    if (!log.formResponseUrl || !f.unit) return;
    const body = new URLSearchParams();
    if (f.name) body.append(f.name, name || "（未填）");
    body.append(f.unit, unitId);
    if (f.score) body.append(f.score, String(score));
    if (f.total) body.append(f.total, String(total));
    fetch(log.formResponseUrl, { method: "POST", mode: "no-cors", body }).catch(() => { /* 紀錄失敗不影響學習 */ });
  }

  /* ---------- 6. 路由 ---------- */

  function route() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
    if (parts[0] === "c" && parts[1]) renderCourse(parts[1], parts[2]);
    else renderCatalog();
  }

  loadData()
    .then(() => {
      window.addEventListener("hashchange", route);
      route();
    })
    .catch(err => {
      console.error(err);
      main.innerHTML = `
        <section class="intro">
          <h1>讀不到課程資料</h1>
          <p>請確認 <code>js/config.js</code> 裡的試算表網址正確，且試算表已經「發布到網路」並選擇 CSV 格式。</p>
          <p class="error-detail">${esc(err.message)}</p>
        </section>`;
    });
})();
