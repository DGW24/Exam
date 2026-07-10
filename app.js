const API_URL = "https://script.google.com/macros/s/AKfycbzf3HA0TYh-mJ_I968w8co2Q1JYByvEw-LEtIwDrH-IfDU8beEAyjFLeCS3urNY7-sC/exec";
const AUTO_LOGOUT_MS = 2 * 60 * 1000;

const state = {
  student: null,
  admin: null,
  currentExam: null,
  timerId: null,
  inactivityId: null,
  secondsLeft: 0,
  adminTab: "overview",
  studentTab: "exams",
  printableExamId: null,
  printableData: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

function showView(id) {
  const isAuthRequired = (id === "student" && !state.student) || (id === "admin" && !state.admin);

  if (id === "student" && !state.student) {
    $("#studentAuth")?.classList.remove("hidden");
    $("#studentSignupAuth")?.classList.add("hidden");
  }
  if (id === "admin" && !state.admin) {
    $("#adminAuth")?.classList.remove("hidden");
  }

  document.body.classList.toggle("auth-open", isAuthRequired);
  $$(".view").forEach((view) => view.classList.remove("active"));

  const targetView = $("#" + id);
  if (targetView) targetView.classList.add("active");

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function hasLoggedInUser() {
  return Boolean(state.student || state.admin);
}

function resetInactivityTimer() {
  if (!hasLoggedInUser()) return;
  clearTimeout(state.inactivityId);
  state.inactivityId = setTimeout(() => autoLogout(), AUTO_LOGOUT_MS);
}

function startInactivityWatch() {
  ["click", "input", "keydown", "scroll", "touchstart", "mousemove"].forEach((eventName) => {
    window.addEventListener(eventName, resetInactivityTimer, { passive: true });
  });
  resetInactivityTimer();
}

function stopInactivityWatch() {
  clearTimeout(state.inactivityId);
}

function autoLogout() {
  if (!hasLoggedInUser()) return;
  const wasStudent = Boolean(state.student);
  state.student = null;
  state.admin = null;
  state.currentExam = null;
  clearInterval(state.timerId);
  stopInactivityWatch();
  $("#studentDashboard").classList.add("hidden");
  $("#adminDashboard").classList.add("hidden");
  $("#studentAuth").classList.remove("hidden");
  $("#studentSignupAuth").classList.add("hidden");
  $("#adminAuth").classList.remove("hidden");
  toast("2 minutes inactivity. Auto logout complete.");
  showView(wasStudent ? "student" : "admin");
}

function loadingHtml(text = "Loading...", type = "dots", compact = false) {
  const loaders = {
    dots: `<span class="loader-dots"><span></span><span></span><span></span></span>`,
    bars: `<span class="loader-bars"><span></span><span></span><span></span><span></span></span>`,
    pulse: `<span class="loader-pulse"></span>`,
    skeleton: `<span class="skeleton-stack"><span class="skeleton-line medium"></span><span class="skeleton-line"></span><span class="skeleton-line short"></span></span>`
  };
  return `<div class="inline-loader ${compact ? "compact" : ""}">${loaders[type] || loaders.dots}<strong>${esc(text)}</strong></div>`;
}

function setButtonLoading(button, isLoading, text = "Please wait") {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.classList.add("is-loading");
    button.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span>${esc(text)}</span>`;
  } else {
    button.disabled = false;
    button.classList.remove("is-loading");
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

function setMessage(selector, text, type = "info") {
  const el = $(selector);
  if (!el) return;
  el.textContent = text || "";
  el.className = "message";
  if (text) el.classList.add("status-note", type);
}

function toast(text, type = "success") {
  const el = $("#toast");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden", "error", "success", "info");
  el.classList.add(type);
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add("hidden"), 3800);
}

function openSignupModal() {
  $("#studentAuth").classList.add("hidden");
  $("#studentSignupAuth").classList.remove("hidden");
  document.body.classList.add("auth-open");
  setMessage("#signupMessage", "");
}

function closeSignupModal() {
  $("#studentSignupAuth").classList.add("hidden");
  $("#studentAuth").classList.remove("hidden");
  document.body.classList.add("auth-open");
}

async function api(action, payload = {}) {
  if (!API_URL || API_URL.includes("PASTE_YOUR")) {
    throw new Error("Set the Apps Script Web App URL in app.js API_URL.");
  }
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await response.json();
  if (!data.ok) throw new Error(data.message || "Request failed");
  return data;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function actionButtons(buttons) {
  return `<div class="action-row">${buttons.join("")}</div>`;
}

function renderStudentDashboard() {
  if (!state.student) return;
  document.body.classList.remove("auth-open");
  $("#studentAuth").classList.add("hidden");
  $("#studentDashboard").classList.remove("hidden");
  $("#studentName").textContent = `Welcome, ${state.student.name}`;
  showView("student");
  loadStudentDashboard();
}

async function loadStudentDashboard() {
  const examBox = $("#examList");
  const historyBox = $("#resultHistory");
  examBox.innerHTML = loadingHtml("Preparing available exams", "skeleton");
  historyBox.innerHTML = loadingHtml("Loading result history", "dots", true);
  try {
    const data = await api("getStudentDashboard", { token: state.student.token });
    examBox.innerHTML = `
      <div class="mini-stats">
        <div><strong>${data.stats.total_exams}</strong><span>Tests</span></div>
        <div><strong>${data.stats.best_score}</strong><span>Best score</span></div>
        <div><strong>${data.stats.avg_percentage}%</strong><span>Average</span></div>
      </div>
      <div class="filter-row">
        <input id="studentExamSearch" placeholder="Search exam" oninput="filterCards('studentExamSearch','exam-card')">
      </div>
      ${data.exams.map((exam) => `
        <div class="list-item exam-card" data-search="${esc(`${exam.exam_name} ${exam.exam_type} ${exam.subjects}`.toLowerCase())}">
          <strong>${esc(exam.exam_name)}</strong>
          <span>${esc(exam.exam_type)} | ${esc(exam.subjects)} | ${exam.total_questions} questions | ${exam.duration_minutes} min</span>
          ${actionButtons([`<button class="primary" onclick="startExam('${esc(exam.exam_id)}', this)">Start Exam</button>`])}
        </div>
      `).join("") || "<p>No active exam found.</p>"}
    `;
    historyBox.innerHTML = data.results.map((item) => `
      <div class="list-item">
        <strong>${esc(item.exam_name || item.exam_id)}: ${esc(item.score)}</strong>
        <span>Correct ${esc(item.correct)}, Wrong ${esc(item.wrong)}, ${esc(item.percentage)}%</span>
        ${actionButtons([
          `<button class="secondary" onclick="viewResult('${esc(item.result_id)}', this)">Review</button>`
        ])}
      </div>
    `).join("") || "<p>No previous result.</p>";
  } catch (err) {
    examBox.innerHTML = `<div class="status-note error">${esc(err.message)}</div>`;
    historyBox.innerHTML = `<div class="status-note error">${esc(err.message)}</div>`;
  }
}

function filterCards(inputId, className) {
  const term = $("#" + inputId).value.toLowerCase();
  $$("." + className).forEach((card) => {
    card.style.display = card.dataset.search.includes(term) ? "" : "none";
  });
}

async function startExam(examId, button = null) {
  setButtonLoading(button, true, "Opening");
  try {
    const data = await api("startExam", { token: state.student.token, examId });
    if (!data.questions.length) throw new Error("No active question found. Check subject names and question status.");
    state.currentExam = data;
    state.secondsLeft = Number(data.exam.duration_minutes) * 60;
    $("#examTitle").textContent = data.exam.exam_name;
    $("#examMeta").textContent = `${data.exam.exam_type} | ${data.questions.length} Questions | ${data.exam.marks_per_question} mark each`;
    $("#examForm").innerHTML = data.questions.map((q, index) => `
      <div class="question">
        <div class="question-head">
          <span class="question-number">Q${index + 1}</span>
          <span class="question-count">${index + 1} / ${data.questions.length}</span>
        </div>
        <div class="question-text">${esc(q.question)}</div>
        <div class="option-list">
          ${["A", "B", "C", "D"].map((key) => `
            <label class="option-card">
              <input type="radio" name="${esc(q.question_id)}" value="${key}">
              <span class="option-key">${key}</span>
              <span class="option-text">${esc(q["option_" + key.toLowerCase()])}</span>
            </label>
          `).join("")}
        </div>
      </div>
    `).join("");
    showView("examView");
    startTimer();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    setButtonLoading(button, false);
  }
}

function startTimer() {
  clearInterval(state.timerId);
  updateTimer();
  state.timerId = setInterval(() => {
    state.secondsLeft -= 1;
    updateTimer();
    if (state.secondsLeft <= 0) submitExam();
  }, 1000);
}

function updateTimer() {
  const min = Math.floor(Math.max(state.secondsLeft, 0) / 60);
  const sec = Math.max(state.secondsLeft, 0) % 60;
  $("#timer").textContent = `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

async function submitExam() {
  clearInterval(state.timerId);
  if (!state.currentExam) return;
  const submitBtn = $("#submitExam");
  setButtonLoading(submitBtn, true, "Submitting");
  const answers = {};
  new FormData($("#examForm")).forEach((value, key) => answers[key] = value);
  try {
    const data = await api("submitExam", {
      token: state.student.token,
      examId: state.currentExam.exam.exam_id,
      questionIds: state.currentExam.questions.map((q) => q.question_id),
      answers
    });
    renderResult(data.result);
    showView("resultView");
    toast("Exam submitted successfully.");
    loadStudentDashboard();
  } catch (err) {
    toast(err.message, "error");
    startTimer();
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

async function viewResult(resultId, button = null) {
  setButtonLoading(button, true, "Opening");
  try {
    const data = await api("getResultDetails", { token: state.student.token, resultId });
    renderResult(data.result);
    showView("resultView");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    setButtonLoading(button, false);
  }
}

function renderResult(result) {
  $("#resultCard").innerHTML = `
    <div class="result-print-head">
      <div>
        <p class="eyebrow">Result Review</p>
        <h2>${esc(result.exam_name || result.exam_id)}</h2>
        <p class="print-subtitle">Digital Coaching Exam Center</p>
      </div>
      <div class="print-score">
        <span>Score</span>
        <strong>${esc(result.score)}</strong>
      </div>
    </div>
    <div class="result-summary">
      <div><span>Attempted</span><strong>${esc(result.attempted)}</strong></div>
      <div><span>Correct</span><strong>${esc(result.correct)}</strong></div>
      <div><span>Wrong</span><strong>${esc(result.wrong)}</strong></div>
      <div><span>Skipped</span><strong>${esc(result.skipped)}</strong></div>
      <div><span>Percentage</span><strong>${esc(result.percentage)}%</strong></div>
    </div>
    <div class="hero-actions no-print">
      <button class="primary" onclick="window.print()">Print Result</button>
      <button class="secondary" data-view="student">Back to Dashboard</button>
    </div>
    <h3 class="print-section-title">Answer Review</h3>
    <div class="list result-review-list">
      ${(result.review || []).map((q, index) => {
        const answered = Boolean(q.given_answer);
        const isCorrect = answered && String(q.given_answer).toUpperCase() === String(q.correct_answer).toUpperCase();
        const statusClass = isCorrect ? "correct" : answered ? "wrong" : "skipped";
        return `
          <div class="list-item result-review-item ${statusClass}">
            <strong>${index + 1}. ${esc(q.question)}</strong>
            <span><b>Your:</b> ${esc(q.given_answer || "Skipped")} | <b>Correct:</b> ${esc(q.correct_answer)}</span>
            <span class="explain">${esc(q.explanation || "")}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
  $$("[data-view]").forEach((btn) => btn.addEventListener("click", () => showView(btn.dataset.view)));
}

async function loadAdmin(tab = state.adminTab || "overview") {
  state.adminTab = tab;
  const box = $("#adminContent");
  box.innerHTML = loadingHtml(`Loading ${tab}`, "bars");
  try {
    if (tab === "overview") return renderAdminOverview(box);
    if (tab === "students") return renderAdminStudents(box);
    if (tab === "exams") return renderAdminExams(box);
    if (tab === "questions") return renderAdminQuestions(box);
    if (tab === "results") return renderAdminResults(box);
    if (tab === "print") return renderAdminPrint(box);
  } catch (err) {
    box.innerHTML = `<div class="status-note error">${esc(err.message)}</div>`;
  }
}

async function renderAdminOverview(box) {
  const data = await api("getAdminDashboard", { token: state.admin.token });
  box.innerHTML = `
    <h3>Overview</h3>
    <div class="mini-stats">
      <div><strong>${data.stats.students}</strong><span>Students</span></div>
      <div><strong>${data.stats.pending}</strong><span>Pending</span></div>
      <div><strong>${data.stats.exams}</strong><span>Active Exams</span></div>
      <div><strong>${data.stats.questions}</strong><span>Questions</span></div>
      <div><strong>${data.stats.results}</strong><span>Results</span></div>
    </div>
    <h3>Recent Results</h3>
    <div class="list">${data.recentResults.map(resultLine).join("") || "<p>No results yet.</p>"}</div>
  `;
}

async function renderAdminStudents(box) {
  const data = await api("getAllStudents", { token: state.admin.token });
  box.innerHTML = `
    <h3>Students</h3>
    <div class="filter-row"><input id="studentSearch" placeholder="Search student" oninput="filterCards('studentSearch','student-card')"></div>
    <div class="list">
      ${data.students.map((s) => `
        <div class="list-item student-card" data-search="${esc(`${s.name} ${s.mobile} ${s.email} ${s.status}`.toLowerCase())}">
          <strong>${esc(s.name)} <small>(${esc(s.status)})</small></strong>
          <span>${esc(s.mobile)} | ${esc(s.email)} | ${esc(s.district)} | ${esc(s.exam_target)}</span>
          ${actionButtons([
            `<button class="primary" onclick="setStudentStatus('${esc(s.student_id)}','approved', this)">Approve</button>`,
            `<button class="secondary" onclick="setStudentStatus('${esc(s.student_id)}','pending', this)">Pending</button>`,
            `<button class="danger" onclick="setStudentStatus('${esc(s.student_id)}','blocked', this)">Block</button>`
          ])}
        </div>
      `).join("") || "<p>No students found.</p>"}
    </div>
  `;
}

const EXAM_SUBJECTS = [
  { code: "MATH", label: "Math" },
  { code: "REAS", label: "Reasoning" },
  { code: "GK", label: "GK" },
  { code: "ENG", label: "English" },
  { code: "BEN", label: "Bengali" },
  { code: "COMP", label: "Computer" },
  { code: "ICDS", label: "ICDS" },
  { code: "CA", label: "Current Affairs" },
  { code: "GS", label: "General Science" },
  { code: "HIST", label: "History" },
  { code: "GEO", label: "Geography" },
  { code: "CONST", label: "Constitution" },
  { code: "ECO", label: "Economy" }
];

const SUBJECT_ALIASES = {
  math: "MATH",
  mathematics: "MATH",
  reasoning: "REAS",
  reas: "REAS",
  gk: "GK",
  "general knowledge": "GK",
  english: "ENG",
  eng: "ENG",
  bengali: "BEN",
  bangla: "BEN",
  ben: "BEN",
  computer: "COMP",
  comp: "COMP",
  icds: "ICDS",
  "current affairs": "CA",
  ca: "CA",
  "general science": "GS",
  science: "GS",
  gs: "GS",
  history: "HIST",
  hist: "HIST",
  geography: "GEO",
  geo: "GEO",
  constitution: "CONST",
  const: "CONST",
  economy: "ECO",
  economics: "ECO",
  eco: "ECO"
};

function subjectCode(value) {
  const raw = String(value || "").trim();
  return SUBJECT_ALIASES[raw.toLowerCase()] || raw.toUpperCase();
}

function parseSubjectBlueprint(subjects) {
  return String(subjects || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, count] = part.split(":").map((item) => item.trim());
      return { subject: subjectCode(name), count: Number(count || 0) };
    })
    .filter((item) => item.subject);
}

function formatSubjectBlueprint(items) {
  return items.map((item) => item.count > 0 ? `${subjectCode(item.subject)}:${item.count}` : subjectCode(item.subject)).join(",");
}

function renderSubjectBlueprintControls(subjects = "") {
  const selected = parseSubjectBlueprint(subjects);
  const countBySubject = Object.fromEntries(selected.map((item) => [subjectCode(item.subject), item.count]));
  const selectedNames = new Set(selected.map((item) => subjectCode(item.subject)));
  return `
    <div class="subject-box-container" style="flex: 2 1 100%; border: 1px solid #ccc; border-radius: 4px; padding: 10px; background: #fff; display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px;">
      ${EXAM_SUBJECTS.map((subject) => {
        const checked = selectedNames.has(subject.code) ? "checked" : "";
        const count = countBySubject[subject.code] || "";
        return `
          <label style="display: grid; grid-template-columns: auto 1fr 72px; align-items: center; gap: 6px; font-size: 14px;">
            <input type="checkbox" name="subjects" value="${esc(subject.code)}" ${checked} onchange="toggleSubjectCount(this)">
            <span><b>${esc(subject.code)}</b> - ${esc(subject.label)}</span>
            <input type="number" name="subject_count_${esc(subject.code)}" min="0" placeholder="Q" value="${esc(count)}" ${checked ? "" : "disabled"} oninput="syncExamTotalFromSubjects(this.form)" style="width: 72px;">
          </label>
        `;
      }).join("")}
    </div>
  `;
}
function toggleSubjectCount(checkbox) {
  const input = checkbox.form.elements[`subject_count_${checkbox.value}`];
  if (!input) return;
  input.disabled = !checkbox.checked;
  if (!checkbox.checked) input.value = "";
  else if (!input.value) input.value = 0;
  syncExamTotalFromSubjects(checkbox.form);
}

function syncExamTotalFromSubjects(form) {
  const total = [...form.querySelectorAll("input[name='subjects']:checked")]
    .reduce((sum, cb) => sum + Number(form.elements[`subject_count_${cb.value}`]?.value || 0), 0);
  if (total > 0 && form.elements.total_questions) form.elements.total_questions.value = total;
}
async function renderAdminExams(box) {
  const data = await api("getAllExams", { token: state.admin.token });
  box.innerHTML = `
    <h3>Create / Update Exam</h3>

<form id="examEditor" class="inline-form" style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center;">
  <input name="exam_id" placeholder="Exam ID, blank for new" style="flex: 1; min-width: 220px;">
  <input name="exam_name" placeholder="Exam name" required style="flex: 1; min-width: 250px;">
  
  <!-- Exam Type à¦¡à§à¦°à¦ªà¦¡à¦¾à¦‰à¦¨ -->
  <select name="exam_type" required style="flex: 1; min-width: 230px; height: 38px;">
    <option value="">-- Exam Type --</option>
    <option value="SSC">SSC</option>
    <option value="Railway">Railway</option>
    <option value="WB Police">WB Police</option>
    <option value="ICDS">ICDS</option>
    <option value="Group-D">Group-D</option>
    <option value="Primary TET">Primary TET</option>
    <option value="WBCS">WBCS</option>
    <option value="Food SI">Food SI</option>
    <option value="KP Constable">KP Constable</option>
    <option value="PSC Clerkship">PSC Clerkship</option>
    <option value="Miscellaneous">Miscellaneous</option>
    <option value="General Practice">General Practice</option>
  </select>
  
  ${renderSubjectBlueprintControls()}    <input name="total_questions" type="number" placeholder="Total questions" value="50" required style="width: 110px;">
  <input name="duration_minutes" type="number" placeholder="Duration minutes" value="60" required style="width: 110px;">
  <input name="marks_per_question" type="number" step="0.01" placeholder="Marks" value="1" required style="width: 80px;">
  <input name="negative_marks" type="number" step="0.01" placeholder="Negative marks" value="0" style="width: 110px;">
  
  <select name="status" style="width: 100px; height: 38px;">
    <option value="active">active</option>
    <option value="inactive">inactive</option>
  </select>
  
  <button class="primary" type="submit" style="height: 38px; padding: 0 15px;">Save Exam</button>
</form>
    <h3>All Exams</h3>
    <div class="list">
      ${data.exams.map((e) => `
        <div class="list-item">
          <strong>${esc(e.exam_name)} <small>(${esc(e.status)})</small></strong>
          <span>${esc(e.exam_id)} | ${esc(e.exam_type)} | ${esc(e.subjects)} | ${esc(e.total_questions)} Q | ${esc(e.duration_minutes)} min</span>
          ${actionButtons([
            `<button class="secondary" onclick='fillExam(${JSON.stringify(e).replace(/'/g, "&apos;")})'>Edit</button>`,
            `<button class="danger" onclick="deleteExam('${esc(e.exam_id)}', this)">Delete</button>`
          ])}
        </div>
      `).join("") || "<p>No exam found.</p>"}
    </div>
  `;
  $("#examEditor").addEventListener("submit", saveExam);
}

async function renderAdminQuestions(box) {
  const data = await api("getQuestionSummary", { token: state.admin.token });
  box.innerHTML = `
    <h3>Question Bank</h3>
    <p class="note">New data structure: use subject short codes like BEN, ENG, GK, MATH, REAS, GS. Exam type/category is optional and will not control question selection.</p>
    <div class="mini-stats">
      <div><strong>${data.total}</strong><span>Total</span></div>
      <div><strong>${data.active}</strong><span>Active</span></div>
      <div><strong>${data.inactive}</strong><span>Inactive</span></div>
    </div>
    <form id="questionEditor" class="inline-form">
      <input name="question_id" placeholder="Question ID, blank for new">
      <input name="exam_type" placeholder="Category optional, blank = All">
      <select name="subject" required><option value="">-- Subject Code --</option>${EXAM_SUBJECTS.map((s) => `<option value="${esc(s.code)}">${esc(s.code)} - ${esc(s.label)}</option>`).join("")}</select>
      <input name="topic" placeholder="Topic">
      <input name="question" placeholder="Question" required>
      <input name="option_a" placeholder="Option A" required>
      <input name="option_b" placeholder="Option B" required>
      <input name="option_c" placeholder="Option C" required>
      <input name="option_d" placeholder="Option D" required>
      <select name="correct_answer"><option>A</option><option>B</option><option>C</option><option>D</option></select>
      <input name="explanation" placeholder="Explanation">
      <select name="difficulty"><option>Easy</option><option>Medium</option><option>Hard</option></select>
      <select name="status"><option value="active">active</option><option value="inactive">inactive</option></select>
      <button class="primary" type="submit">Save Question</button>
      <button class="secondary" type="reset" onclick="clearQuestionEditor()">New Question</button>
    </form>
    <h3>All Questions</h3>
    <div class="filter-row"><input id="questionSearch" placeholder="Search question" oninput="filterCards('questionSearch','question-card')"></div>
    <div class="list">
      ${data.latest.map((q) => `
        <div class="list-item question-card" data-search="${esc(`${q.question_id} ${q.exam_type} ${q.subject} ${q.topic} ${q.question} ${q.correct_answer} ${q.status}`.toLowerCase())}">
          <strong>${esc(q.question_id)} - ${esc(q.question)}</strong>
          <span>${esc(q.exam_type)} | ${esc(q.subject)} | Answer: ${esc(q.correct_answer)} | ${esc(q.status)}</span>
          ${actionButtons([
            `<button class="secondary" onclick="fillQuestion('${encodeURIComponent(JSON.stringify(q))}')">Edit</button>`
          ])}
        </div>
      `).join("") || "<p>No question found.</p>"}
    </div>
  `;
  $("#questionEditor").addEventListener("submit", saveQuestion);
}

async function renderAdminResults(box) {
  const data = await api("getAllResults", { token: state.admin.token });
  box.innerHTML = `
    <h3>All Results</h3>
    <div class="filter-row"><input id="resultSearch" placeholder="Search result" oninput="filterCards('resultSearch','result-card-row')"></div>
    <div class="list">${data.results.map((r) => resultLine(r, "result-card-row")).join("") || "<p>No results yet.</p>"}</div>
  `;
}

async function renderAdminPrint(box) {
  const data = await api("getAvailableExams", { token: state.admin.token, admin: true });
  box.innerHTML = `
    <h3>Print Question Paper / OMR / Answer Key</h3>
    <div class="print-controls">
      <select id="printExam" onchange="clearPrintableCache()">${data.exams.map((e) => `<option value="${esc(e.exam_id)}">${esc(e.exam_name)}</option>`).join("")}</select>
      <button class="primary" onclick="printExamPaper(this)">Question Paper</button>
      <button class="secondary" onclick="printAnswerKey(this)">Answer Key</button>
      <button class="secondary" onclick="printOmr(this)">OMR Sheet</button>
      <button class="secondary" onclick="clearPrintableCache(); toast('New random paper set will be generated on next print.', 'info')">New Random Set</button>
    </div>
    <p class="note">Question Paper এবং Answer Key একই selected question set থেকে print হবে। নতুন random set চাইলে New Random Set চাপুন।</p>
  `;
  clearPrintableCache();
}

function resultLine(r, cls = "") {
  return `
    <div class="list-item ${cls}" data-search="${esc(`${r.student_name} ${r.mobile} ${r.exam_name} ${r.score}`.toLowerCase())}">
      <strong>${esc(r.student_name)} - ${esc(r.score)}</strong>
      <span>${esc(r.exam_name || r.exam_id)} | ${esc(r.mobile)} | ${esc(r.percentage)}% | ${esc(r.submitted_at)}</span>
    </div>
  `;
}

async function setStudentStatus(studentId, status, button = null) {
  setButtonLoading(button, true, "Saving");
  try {
    const data = await api("setStudentStatus", { token: state.admin.token, studentId, status });
    toast(data.message || "Student updated.");
    loadAdmin("students");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    setButtonLoading(button, false);
  }
}

async function saveExam(event) {
  event.preventDefault();
  const submitBtn = event.target.querySelector("button[type='submit']");
  setButtonLoading(submitBtn, true, "Saving");
  try {
    const rawData = formData(event.target);
    const checkedSubjects = [...event.target.querySelectorAll("input[name='subjects']:checked")].map((cb) => ({
      subject: subjectCode(cb.value),
      count: Number(event.target.elements[`subject_count_${subjectCode(cb.value)}`]?.value || 0)
    }));

    if (!checkedSubjects.length) throw new Error("Please select at least one subject.");
    const subjectTotal = checkedSubjects.reduce((sum, item) => sum + item.count, 0);
    if (subjectTotal > 0) rawData.total_questions = subjectTotal;
    rawData.subjects = formatSubjectBlueprint(checkedSubjects);

    const data = await api("saveExam", { token: state.admin.token, exam: rawData });
    toast(`Exam saved: ${data.exam.exam_id}`);
    loadAdmin("exams");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

function fillExam(exam) {
  const form = $("#examEditor");
  Object.keys(exam).forEach((key) => {
    if (key !== "subjects" && form.elements[key]) form.elements[key].value = exam[key];
  });
  const blueprint = parseSubjectBlueprint(exam.subjects);
  const countBySubject = Object.fromEntries(blueprint.map((item) => [subjectCode(item.subject), item.count]));
  const selectedNames = new Set(blueprint.map((item) => subjectCode(item.subject)));
  [...form.querySelectorAll("input[name='subjects']")].forEach((checkbox) => {
    const key = subjectCode(checkbox.value);
    const input = form.elements[`subject_count_${checkbox.value}`];
    checkbox.checked = selectedNames.has(key);
    if (input) {
      input.disabled = !checkbox.checked;
      input.value = checkbox.checked ? (countBySubject[key] || "") : "";
    }
  });
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function deleteExam(examId, button = null) {
  if (!confirm("Delete this exam?")) return;
  setButtonLoading(button, true, "Deleting");
  try {
    const data = await api("deleteExam", { token: state.admin.token, examId });
    toast(data.message || "Exam deleted.");
    loadAdmin("exams");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    setButtonLoading(button, false);
  }
}

async function saveQuestion(event) {
  event.preventDefault();
  const submitBtn = event.target.querySelector("button[type='submit']");
  setButtonLoading(submitBtn, true, "Saving");
  try {
    const data = await api("saveQuestion", { token: state.admin.token, question: formData(event.target) });
    toast(`Question saved: ${data.question.question_id}`);
    event.target.reset();
    loadAdmin("questions");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

function fillQuestion(encodedQuestion) {
  const form = $("#questionEditor");
  if (!form) return;
  const question = JSON.parse(decodeURIComponent(encodedQuestion));
  Object.keys(question).forEach((key) => {
    if (form.elements[key]) form.elements[key].value = question[key] ?? "";
  });
  form.querySelector("button[type='submit']").textContent = "Update Question";
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearQuestionEditor() {
  const form = $("#questionEditor");
  if (!form) return;
  form.querySelector("button[type='submit']").textContent = "Save Question";
}

function clearPrintableCache() {
  state.printableExamId = null;
  state.printableData = null;
}

async function getPrintableData() {
  const examId = $("#printExam").value;
  if (state.printableData && state.printableExamId === examId) {
    return state.printableData;
  }
  const data = await api("getPrintableExam", { token: state.admin.token, examId });
  state.printableExamId = examId;
  state.printableData = data;
  return data;
}

async function printExamPaper(button = null) {
  const win = openPrintWindow("<p>Preparing question paper...</p>", "Question Paper", false);
  if (!win) return;
  setButtonLoading(button, true, "Preparing");
  try {
    const data = await getPrintableData();
    writePrintWindow(win, renderQuestionPaper(data, false), "Question Paper", true);
  } catch (err) {
    win.close();
    toast(err.message, "error");
  } finally {
    setButtonLoading(button, false);
  }
}

async function printAnswerKey(button = null) {
  const win = openPrintWindow("<p>Preparing answer key...</p>", "Answer Key", false);
  if (!win) return;
  setButtonLoading(button, true, "Preparing");
  try {
    const data = await getPrintableData();
    writePrintWindow(win, renderQuestionPaper(data, true), "Answer Key", true);
  } catch (err) {
    win.close();
    toast(err.message, "error");
  } finally {
    setButtonLoading(button, false);
  }
}

function renderQuestionPaper(data, withAnswers) {
  return `
    <div class="print-head">
      <h1>${esc(data.exam.exam_name)}</h1>
      <p>${esc(data.exam.exam_type)} | ${esc(data.exam.total_questions)} Questions | ${esc(data.exam.duration_minutes)} Minutes</p>
      <p>Name: __________________________ Roll: ______________ Date: ______________</p>
    </div>
    ${data.questions.map((q, i) => `
      <div class="question">
        <strong>${i + 1}. ${esc(q.question)}</strong>
        <ol class="options" type="A">
          <li>${esc(q.option_a)}</li>
          <li>${esc(q.option_b)}</li>
          <li>${esc(q.option_c)}</li>
          <li>${esc(q.option_d)}</li>
        </ol>
        ${withAnswers ? `<p class="answer-key"><b>Answer:</b> ${esc(q.correct_answer)}</p><p><b>Explanation:</b> ${esc(q.explanation || "")}</p>` : ""}
      </div>
    `).join("")}
  `;
}

function printOmr(button = null) {
  const total = Number(prompt("How many OMR rows?", "100") || 100);
  if (!total) return;
  setButtonLoading(button, true, "Opening");
  const rows = Array.from({ length: total }, (_, i) => `
    <tr><td>${i + 1}</td><td>○ A</td><td>○ B</td><td>○ C</td><td>○ D</td></tr>
  `).join("");
  openPrintWindow(`<div class="print-head"><h1>OMR Answer Sheet</h1><p>Name: __________________________ Roll: ______________ Date: ______________</p></div><table>${rows}</table>`, "OMR Sheet");
  setButtonLoading(button, false);
}

function printDocument(content, title = "Print", autoPrint = true) {
  return `<html><head><title>${esc(title)}</title><style>
    @page{size:A4;margin:12mm}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font-family:Arial,sans-serif;color:#111827;padding:0;margin:0;line-height:1.4}
    .print-head{border-bottom:2px solid #111827;margin-bottom:14px;padding-bottom:10px}
    h1{font-size:22px;margin:0 0 6px}
    p{margin:4px 0}
    .question{page-break-inside:avoid;margin:12px 0;padding:8px;border:1px solid #d1d5db}
    .question strong{display:block;margin-bottom:7px}
    .options{display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;margin:7px 0 0;padding-left:24px}
    .answer-key{color:#0f766e;font-weight:700}
    table{width:100%;border-collapse:collapse;font-size:13px}
    td{width:20%;border:1px solid #111827;padding:7px;text-align:center}
  </style></head><body>${content}${autoPrint ? `<script>window.onload=function(){window.focus();window.print();};<\/script>` : ""}</body></html>`;
}

function writePrintWindow(win, content, title = "Print", autoPrint = true) {
  win.document.open();
  win.document.write(printDocument(content, title, autoPrint));
  win.document.close();
}

function openPrintWindow(content, title = "Print", autoPrint = true) {
  const win = window.open("", "_blank");
  if (!win) {
    toast("Please allow popup permission for printing.", "error");
    return null;
  }
  writePrintWindow(win, content, title, autoPrint);
  return win;
}

$$("[data-view]").forEach((btn) => btn.addEventListener("click", () => showView(btn.dataset.view)));

$("#registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitBtn = event.target.querySelector("button[type='submit']");
  setButtonLoading(submitBtn, true, "Creating");
  try {
    const data = await api("registerStudent", formData(event.target));
    setMessage("#signupMessage", `${data.message} Student ID: ${data.student_id}`, "success");
    toast(`Account created. Student ID: ${data.student_id}`);
    event.target.reset();
  } catch (err) {
    setMessage("#signupMessage", err.message, "error");
    toast(err.message, "error");
  } finally {
    setButtonLoading(submitBtn, false);
  }
});

// à¦ªà§à¦°à¦¾à¦¤à¦¨ $("#loginForm").addEventListener... à¦ªà¦°à¦¿à¦¬à¦°à§à¦¤à¦¨ à¦•à¦°à§‡ à¦à¦Ÿà¦¿ à¦²à¦¿à¦–à§à¦¨:
$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitBtn = event.target.querySelector("button[type='submit']");
  setButtonLoading(submitBtn, true, "Checking");
  
  try {
    const data = await api("loginStudent", formData(event.target));
    state.student = data.student;
    toast(`Login successful. Welcome ${state.student.name}.`);
    startInactivityWatch();
    renderStudentDashboard();
    setMessage("#studentMessage", "");
  } catch (err) {
    setMessage("#studentMessage", err.message, "error");
    toast(err.message, "error");
  } finally {
    setButtonLoading(submitBtn, false);
  }
});

$("#studentLogout").addEventListener("click", () => {
  state.student = null;
  stopInactivityWatch();
  $("#studentDashboard").classList.add("hidden");
  $("#studentAuth").classList.remove("hidden");
  $("#studentSignupAuth").classList.add("hidden");
  toast("Logged out.");
  showView("home");
});

$("#submitExam").addEventListener("click", submitExam);

// à¦ªà§à¦°à¦¾à¦¤à¦¨ $("#adminLoginForm").addEventListener... à¦ªà¦°à¦¿à¦¬à¦°à§à¦¤à¦¨ à¦•à¦°à§‡ à¦à¦Ÿà¦¿ à¦²à¦¿à¦–à§à¦¨:
$("#adminLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitBtn = event.target.querySelector("button[type='submit']");
  setButtonLoading(submitBtn, true, "Checking");

  try {
    const data = await api("adminLogin", formData(event.target));
    state.admin = data.admin;
    document.body.classList.remove("auth-open");
    $("#adminAuth").classList.add("hidden");
    $("#adminDashboard").classList.remove("hidden");
    toast("Admin login successful.");
    startInactivityWatch();
    showView("admin");
    loadAdmin("overview");
  } catch (err) {
    setMessage("#adminMessage", err.message, "error");
    toast(err.message, "error");
  } finally {
    setButtonLoading(submitBtn, false);
  }
});

$("#openSignup").addEventListener("click", openSignupModal);
$("#closeSignup").addEventListener("click", closeSignupModal);
$("#backToLogin").addEventListener("click", closeSignupModal);

$$("[data-admin-tab]").forEach((btn) => btn.addEventListener("click", () => {
  $$("[data-admin-tab]").forEach((item) => item.classList.remove("active"));
  btn.classList.add("active");
  loadAdmin(btn.dataset.adminTab);
}));










