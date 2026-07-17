const SHEET_ID = "1qMO6737LTf6w96VDUp4iYdRwrzRCcaQQJMbq_wNJMsc";
const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "572594";

const SCHEMA = {
  Questions: ["question_id", "exam_type", "subject", "topic", "question", "option_a", "option_b", "option_c", "option_d", "correct_answer", "explanation", "difficulty", "status"],
  Students: ["student_id", "name", "mobile", "email", "password_hash", "district", "exam_target", "status", "created_at", "last_login", "photo_url", "address", "gender", "school", "father_name", "guardian_mobile", "payment_status", "payment_note", "dob", "mother_name", "qualification", "village_town", "post", "police_station", "pin", "preferred_batch", "photo_position", "declaration"],
  Exams: ["exam_id", "exam_name", "exam_type", "subjects", "total_questions", "duration_minutes", "marks_per_question", "negative_marks", "status", "created_at"],
  Results: ["result_id", "student_id", "exam_id", "exam_name", "student_name", "mobile", "total_questions", "attempted", "correct", "wrong", "skipped", "score", "percentage", "submitted_at", "answers_json"],
  Sessions: ["token", "user_type", "user_id", "created_at", "expires_at", "status"],
  Settings: ["key", "value"]
};

function setup() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  Object.keys(SCHEMA).forEach((name) => ensureSheet(ss, name, SCHEMA[name]));
  seedSettings();
  seedExam();
  seedQuestions();
  return "Setup complete. Tabs, headers, default exam, settings and sample questions are ready.";
}

function doGet() {
  setup();
  return json({ ok: true, message: "Digital Coaching Exam Center API is ready." });
}

function doPost(e) {
  try {
    setup();
    const body = JSON.parse(e.postData.contents || "{}");
    const routes = {
      registerStudent,
      loginStudent,
      getAvailableExams,
      getStudentDashboard,
      startExam,
      submitExam,
      getResultHistory,
      getResultDetails,
      updateStudentProfile,
      changeStudentPassword,
      adminLogin,
      getAdminDashboard,
      getAllStudents,
      getPendingStudents,
      setStudentStatus,
      approveStudent,
      blockStudent,
      getAllExams,
      saveExam,
      deleteExam,
      getQuestionSummary,
      saveQuestion,
      getAllResults,
      getPrintableExam
    };
    if (!routes[body.action]) throw new Error("Invalid action.");
    return json(routes[body.action](body));
  } catch (err) {
    return json({ ok: false, message: err.message });
  }
}

function registerStudent(data) {
  const required = ["name", "gender", "dob", "fatherName", "school", "qualification", "villageTown", "post", "policeStation", "district", "pin", "mobile", "email", "guardianMobile", "examTarget", "preferredBatch", "password", "declaration"];
  required.forEach((key) => {
    if (!data[key]) throw new Error(key + " required.");
  });
  if (data.password !== data.confirmPassword) throw new Error("Password and confirm password do not match.");
  const students = readObjects("Students");
  const exists = students.some((s) => String(s.email).toLowerCase() === String(data.email).toLowerCase() || String(s.mobile) === String(data.mobile));
  if (exists) throw new Error("This email/mobile already exists.");
  const studentId = uid("STU");
  appendObject("Students", {
    student_id: studentId,
    name: data.name,
    mobile: data.mobile,
    email: String(data.email).toLowerCase(),
    password_hash: hashPassword(data.password),
    district: data.district || "",
    exam_target: data.examTarget || data.exam_target || "",
    photo_url: data.photoUrl || data.photo_url || "",
    address: data.address || "",
    gender: data.gender || "",
    school: data.school || "",
    father_name: data.fatherName || data.father_name || "",
    guardian_mobile: data.guardianMobile || data.guardian_mobile || "",
    payment_status: data.paymentStatus || data.payment_status || "pending",
    payment_note: data.paymentNote || data.payment_note || "",
    dob: data.dob || "",
    mother_name: data.motherName || data.mother_name || "",
    qualification: data.qualification || "",
    village_town: data.villageTown || data.village_town || "",
    post: data.post || "",
    police_station: data.policeStation || data.police_station || "",
    pin: data.pin || "",
    preferred_batch: data.preferredBatch || data.preferred_batch || "",
    photo_position: data.photoPosition || data.photo_position || "center center",
    declaration: data.declaration ? "yes" : "",
    status: "pending",
    created_at: now(),
    last_login: ""
  });
  return { ok: true, message: "Account created. Please wait for admin approval.", student_id: studentId };
}

function loginStudent(data) {
  const students = readObjects("Students");
  const key = String(data.emailOrMobile || "").toLowerCase();
  const student = students.find((s) => String(s.email).toLowerCase() === key || String(s.mobile) === key);
  if (!student || student.password_hash !== hashPassword(data.password || "")) throw new Error("Wrong login details.");
  if (student.status !== "approved") throw new Error("Your account is " + student.status + ". Admin approval required.");
  updateById("Students", "student_id", student.student_id, { last_login: now() });
  const token = createSession("student", student.student_id);
  return { ok: true, student: publicStudent(student, token) };
}

function adminLogin(data) {
  const username = getSetting("admin_username") || DEFAULT_ADMIN_USERNAME;
  const passwordHash = getSetting("admin_password_hash") || hashPassword(DEFAULT_ADMIN_PASSWORD);
  if (data.username !== username || hashPassword(data.password || "") !== passwordHash) throw new Error("Wrong admin login.");
  const token = createSession("admin", "ADMIN");
  return { ok: true, admin: { username, token } };
}

function getAvailableExams(data) {
  if (data.admin) requireAdmin(data.token); else requireStudent(data.token);
  const exams = readObjects("Exams").filter((e) => e.status === "active");
  return { ok: true, exams };
}

function getStudentDashboard(data) {
  const student = requireStudent(data.token);
  const exams = readObjects("Exams").filter((e) => e.status === "active");
  const results = readObjects("Results")
    .filter((r) => r.student_id === student.student_id)
    .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)))
    .map((r) => stripAnswerJson(r));
  const stats = studentStats(results);
  return { ok: true, student: publicStudent(student, data.token), exams, results, stats };
}

function startExam(data) {
  const student = requireStudent(data.token);
  const exam = getById("Exams", "exam_id", data.examId);
  if (!exam || exam.status !== "active") throw new Error("Exam not found.");
  const questions = pickQuestions(exam);
  if (!questions.length) throw new Error("No active question found for the selected subject setup. Check Questions sheet subject names and status.");
  return {
    ok: true,
    student: publicStudent(student, data.token),
    exam,
    questions: questions.map((q) => ({
      question_id: q.question_id,
      question: q.question,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d
    }))
  };
}

function submitExam(data) {
  const student = requireStudent(data.token);
  const exam = getById("Exams", "exam_id", data.examId);
  if (!exam) throw new Error("Exam not found.");
  const ids = data.questionIds || [];
  const answers = data.answers || {};
  const questionMap = {};
  readObjects("Questions").forEach((q) => questionMap[q.question_id] = q);
  let correct = 0;
  let wrong = 0;
  let skipped = 0;
  const review = ids.map((id) => {
    const q = questionMap[id];
    if (!q) return null;
    const given = answers[id] || "";
    if (!given) skipped += 1;
    else if (String(given).toUpperCase() === String(q.correct_answer).toUpperCase()) correct += 1;
    else wrong += 1;
    const isCorrect = Boolean(given) && String(given).toUpperCase() === String(q.correct_answer).toUpperCase();
    return {
      question_id: id,
      question: q.question,
      given_answer: given,
      correct_answer: q.correct_answer,
      is_correct: isCorrect,
      explanation: q.explanation
    };
  }).filter(Boolean);
  const marks = Number(exam.marks_per_question || 1);
  const negative = Number(exam.negative_marks || 0);
  const score = (correct * marks) - (wrong * negative);
  const total = ids.length;
  const percentage = total ? Math.round((score / (total * marks)) * 10000) / 100 : 0;
  const result = {
    result_id: uid("RES"),
    student_id: student.student_id,
    exam_id: exam.exam_id,
    exam_name: exam.exam_name,
    student_name: student.name,
    mobile: student.mobile,
    total_questions: total,
    attempted: correct + wrong,
    correct,
    wrong,
    skipped,
    score,
    percentage,
    submitted_at: now(),
    answers_json: JSON.stringify({ answers, review })
  };
  appendObject("Results", result);
  result.review = review;
  return { ok: true, result };
}

function getResultHistory(data) {
  const student = requireStudent(data.token);
  const results = readObjects("Results")
    .filter((r) => r.student_id === student.student_id)
    .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)))
    .map((r) => stripAnswerJson(r));
  return { ok: true, results };
}

function getResultDetails(data) {
  const student = requireStudent(data.token);
  const result = getById("Results", "result_id", data.resultId);
  if (!result || result.student_id !== student.student_id) throw new Error("Result not found.");
  return { ok: true, result: hydrateResult(result) };
}

function updateStudentProfile(data) {
  const student = requireStudent(data.token);
  const profile = data.profile || {};
  const updates = {
    name: profile.name || student.name,
    mobile: profile.mobile || student.mobile,
    email: profile.email ? String(profile.email).toLowerCase() : student.email,
    district: profile.district || "",
    exam_target: profile.examTarget || profile.exam_target || "",
    photo_url: profile.photoUrl || profile.photo_url || "",
    address: profile.address || "",
    gender: profile.gender || "",
    school: profile.school || "",
    father_name: profile.fatherName || profile.father_name || "",
    guardian_mobile: profile.guardianMobile || profile.guardian_mobile || "",
    payment_status: profile.paymentStatus || profile.payment_status || student.payment_status || "pending",
    payment_note: profile.paymentNote || profile.payment_note || "",
    dob: profile.dob || "",
    mother_name: profile.motherName || profile.mother_name || "",
    qualification: profile.qualification || "",
    village_town: profile.villageTown || profile.village_town || "",
    post: profile.post || "",
    police_station: profile.policeStation || profile.police_station || "",
    pin: profile.pin || "",
    preferred_batch: profile.preferredBatch || profile.preferred_batch || "",
    photo_position: profile.photoPosition || profile.photo_position || "center center",
    declaration: profile.declaration ? "yes" : student.declaration || ""
  };
  updateById("Students", "student_id", student.student_id, updates);
  return { ok: true, message: "Profile updated.", student: publicStudent({ ...student, ...updates }, data.token) };
}

function changeStudentPassword(data) {
  const student = requireStudent(data.token);
  if (!data.currentPassword || !data.newPassword) throw new Error("Current and new password required.");
  if (student.password_hash !== hashPassword(data.currentPassword)) throw new Error("Current password is wrong.");
  if (String(data.newPassword).length < 4) throw new Error("New password must be at least 4 characters.");
  updateById("Students", "student_id", student.student_id, { password_hash: hashPassword(data.newPassword) });
  return { ok: true, message: "Password changed successfully." };
}

function getPendingStudents(data) {
  requireAdmin(data.token);
  return { ok: true, students: readObjects("Students").filter((s) => s.status === "pending").map((s) => ({ ...s, password_hash: "" })) };
}

function getAdminDashboard(data) {
  requireAdmin(data.token);
  const students = readObjects("Students");
  const questions = readObjects("Questions");
  const exams = readObjects("Exams");
  const results = readObjects("Results").map((r) => stripAnswerJson(r)).reverse();
  return {
    ok: true,
    stats: {
      students: students.length,
      pending: students.filter((s) => s.status === "pending").length,
      exams: exams.filter((e) => e.status === "active").length,
      questions: questions.length,
      results: results.length
    },
    recentResults: results.slice(0, 8)
  };
}

function getAllStudents(data) {
  requireAdmin(data.token);
  const students = readObjects("Students").map((s) => ({ ...s, password_hash: "" })).reverse();
  return { ok: true, students };
}

function setStudentStatus(data) {
  requireAdmin(data.token);
  const allowed = ["pending", "approved", "blocked"];
  if (allowed.indexOf(data.status) === -1) throw new Error("Invalid student status.");
  updateById("Students", "student_id", data.studentId, { status: data.status });
  return { ok: true, message: "Student status updated." };
}

function approveStudent(data) {
  requireAdmin(data.token);
  updateById("Students", "student_id", data.studentId, { status: "approved" });
  return { ok: true, message: "Student approved." };
}

function blockStudent(data) {
  requireAdmin(data.token);
  updateById("Students", "student_id", data.studentId, { status: "blocked" });
  return { ok: true, message: "Student blocked." };
}

function getAllExams(data) {
  requireAdmin(data.token);
  return { ok: true, exams: readObjects("Exams").reverse() };
}

function saveExam(data) {
  requireAdmin(data.token);
  const exam = data.exam || {};
  if (!exam.exam_name || !exam.exam_type || !exam.subjects) throw new Error("Exam name, type and subjects required.");
  const row = {
    exam_id: exam.exam_id || uid("EXAM"),
    exam_name: exam.exam_name,
    exam_type: exam.exam_type,
    subjects: exam.subjects,
    total_questions: Number(exam.total_questions || 50),
    duration_minutes: Number(exam.duration_minutes || 60),
    marks_per_question: Number(exam.marks_per_question || 1),
    negative_marks: Number(exam.negative_marks || 0),
    status: exam.status || "active",
    created_at: exam.created_at || now()
  };
  const existing = getById("Exams", "exam_id", row.exam_id);
  if (existing) updateById("Exams", "exam_id", row.exam_id, row);
  else appendObject("Exams", row);
  return { ok: true, exam: row };
}

function deleteExam(data) {
  requireAdmin(data.token);
  deleteById("Exams", "exam_id", data.examId);
  return { ok: true, message: "Exam deleted." };
}

function getQuestionSummary(data) {
  requireAdmin(data.token);
  const questions = readObjects("Questions");
  return {
    ok: true,
    total: questions.length,
    active: questions.filter((q) => q.status === "active").length,
    inactive: questions.filter((q) => q.status !== "active").length,
    latest: questions.slice().reverse()
  };
}

function saveQuestion(data) {
  requireAdmin(data.token);
  const q = data.question || {};
  if (!q.subject || !q.question || !q.option_a || !q.option_b || !q.option_c || !q.option_d || !q.correct_answer) {
    throw new Error("Subject, question, options and answer required.");
  }
  const row = {
    question_id: q.question_id || uid("Q"),
    exam_type: q.exam_type || "All",
    subject: q.subject,
    topic: q.topic || "",
    question: q.question,
    option_a: q.option_a,
    option_b: q.option_b,
    option_c: q.option_c,
    option_d: q.option_d,
    correct_answer: String(q.correct_answer).toUpperCase(),
    explanation: q.explanation || "",
    difficulty: q.difficulty || "Medium",
    status: q.status || "active"
  };
  const existing = getById("Questions", "question_id", row.question_id);
  if (existing) updateById("Questions", "question_id", row.question_id, row);
  else appendObject("Questions", row);
  return { ok: true, question: row };
}

function getAllResults(data) {
  requireAdmin(data.token);
  return { ok: true, results: readObjects("Results").map((r) => stripAnswerJson(r)).reverse() };
}

function getPrintableExam(data) {
  const isAdmin = Boolean(data.admin);
  if (isAdmin) requireAdmin(data.token); else requireStudent(data.token);
  const exam = getById("Exams", "exam_id", data.examId);
  if (!exam) throw new Error("Exam not found.");
  const questions = pickQuestions(exam);
  return {
    ok: true,
    exam,
    questions: isAdmin ? questions : questions.map((q) => ({
      question_id: q.question_id,
      question: q.question,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d
    }))
  };
}

function ensureSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const current = sheet.getRange(1, 1, 1, Math.max(headers.length, sheet.getLastColumn() || 1)).getValues()[0];
  const missingHeader = headers.some((h, i) => current[i] !== h);
  if (missingHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  if (sheet.getLastColumn() < headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function seedSettings() {
  if (readObjects("Settings").length) return;
  appendObject("Settings", { key: "admin_username", value: DEFAULT_ADMIN_USERNAME });
  appendObject("Settings", { key: "admin_password_hash", value: hashPassword(DEFAULT_ADMIN_PASSWORD) });
}

function seedExam() {
  if (readObjects("Exams").length) return;
  appendObject("Exams", {
    exam_id: "EXAM_DEMO_50",
    exam_name: "Demo Competitive Mock Test",
    exam_type: "SSC",
    subjects: "Math,Reasoning,GK,Bengali",
    total_questions: 50,
    duration_minutes: 60,
    marks_per_question: 1,
    negative_marks: 0,
    status: "active",
    created_at: now()
  });
}

function seedQuestions() {
  if (readObjects("Questions").length) return;
  const samples = [
    ["Q001", "SSC", "Math", "Percentage", "20% of 500 is?", "50", "100", "150", "200", "B", "20% of 500 = 100.", "Easy", "active"],
    ["Q002", "SSC", "Reasoning", "Series", "2, 4, 8, 16, next number?", "18", "24", "32", "36", "C", "Every number is multiplied by 2.", "Easy", "active"],
    ["Q003", "ICDS", "GK", "India", "Capital of India?", "Kolkata", "Delhi", "Mumbai", "Chennai", "B", "New Delhi is the capital of India.", "Easy", "active"]
  ];
  const sheet = getSheet("Questions");
  sheet.getRange(2, 1, samples.length, SCHEMA.Questions.length).setValues(samples);
}

function parseSubjectBlueprint(subjects) {
  return String(subjects || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const pieces = part.split(":");
      return {
        subject: String(pieces[0] || "").trim(),
        count: Number(pieces[1] || 0)
      };
    })
    .filter((item) => item.subject);
}

function normalizeSubject(value) {
  return String(value || "").trim().toLowerCase();
}

function questionMatchesBlueprintSubject(q, subjectLower) {
  return normalizeSubject(q.subject) === subjectLower;
}

function pickQuestions(exam) {
  const blueprint = parseSubjectBlueprint(exam.subjects);
  const all = readObjects("Questions").filter((q) => String(q.status || "active").toLowerCase() === "active");

  if (!blueprint.length) {
    shuffle(all);
    return all.slice(0, Number(exam.total_questions || 50));
  }

  const selected = [];
  const used = {};
  blueprint.forEach((item) => {
    const subjectLower = normalizeSubject(item.subject);
    const pool = all.filter((q) => questionMatchesBlueprintSubject(q, subjectLower) && !used[q.question_id]);
    shuffle(pool);
    const limit = item.count > 0 ? item.count : pool.length;
    pool.slice(0, limit).forEach((q) => {
      used[q.question_id] = true;
      selected.push(q);
    });
  });

  const requestedTotal = blueprint.reduce((sum, item) => sum + Number(item.count || 0), 0) || Number(exam.total_questions || 50);
  shuffle(selected);
  return selected.slice(0, requestedTotal);
}

function getSheet(name) {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
}

function readObjects(name) {
  const sheet = getSheet(name);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter((row) => row.some((cell) => cell !== "")).map((row) => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function appendObject(name, obj) {
  const headers = SCHEMA[name];
  getSheet(name).appendRow(headers.map((h) => obj[h] === undefined ? "" : obj[h]));
}

function updateById(name, idKey, idValue, updates) {
  const sheet = getSheet(name);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf(idKey);
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(idValue)) {
      Object.keys(updates).forEach((key) => {
        const c = headers.indexOf(key);
        if (c >= 0) sheet.getRange(r + 1, c + 1).setValue(updates[key]);
      });
      return;
    }
  }
  throw new Error(name + " row not found.");
}

function deleteById(name, idKey, idValue) {
  const sheet = getSheet(name);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf(idKey);
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(idValue)) {
      sheet.deleteRow(r + 1);
      return;
    }
  }
  throw new Error(name + " row not found.");
}

function getById(name, idKey, idValue) {
  return readObjects(name).find((row) => String(row[idKey]) === String(idValue));
}

function createSession(userType, userId) {
  const token = uid("TOK");
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
  appendObject("Sessions", { token, user_type: userType, user_id: userId, created_at: now(), expires_at: expires.toISOString(), status: "active" });
  return token;
}

function requireStudent(token) {
  const session = requireSession(token, "student");
  const student = getById("Students", "student_id", session.user_id);
  if (!student || student.status !== "approved") throw new Error("Student access denied.");
  return student;
}

function requireAdmin(token) {
  requireSession(token, "admin");
  return true;
}

function requireSession(token, userType) {
  if (!token) throw new Error("Login required.");
  const session = readObjects("Sessions").find((s) => s.token === token && s.user_type === userType && s.status === "active");
  if (!session) throw new Error("Invalid session.");
  if (new Date(session.expires_at).getTime() < Date.now()) throw new Error("Session expired.");
  return session;
}

function hashPassword(password) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password));
  return bytes.map((b) => (b + 256).toString(16).slice(-2)).join("");
}

function getSetting(key) {
  const row = readObjects("Settings").find((item) => item.key === key);
  return row ? row.value : "";
}

function publicStudent(student, token) {
  return {
    student_id: student.student_id,
    name: student.name,
    mobile: student.mobile,
    email: student.email,
    district: student.district || "",
    exam_target: student.exam_target || "",
    photo_url: student.photo_url || "",
    address: student.address || "",
    gender: student.gender || "",
    school: student.school || "",
    father_name: student.father_name || "",
    guardian_mobile: student.guardian_mobile || "",
    payment_status: student.payment_status || "pending",
    payment_note: student.payment_note || "",
    dob: student.dob || "",
    mother_name: student.mother_name || "",
    qualification: student.qualification || "",
    village_town: student.village_town || "",
    post: student.post || "",
    police_station: student.police_station || "",
    pin: student.pin || "",
    preferred_batch: student.preferred_batch || "",
    photo_position: student.photo_position || "center center",
    declaration: student.declaration || "",
    status: student.status,
    token
  };
}

function stripAnswerJson(result) {
  const copy = { ...result };
  delete copy.answers_json;
  return copy;
}

function hydrateResult(result) {
  const copy = { ...result };
  try {
    const details = JSON.parse(copy.answers_json || "{}");
    copy.review = details.review || [];
  } catch (err) {
    copy.review = [];
  }
  delete copy.answers_json;
  return copy;
}

function studentStats(results) {
  if (!results.length) return { total_exams: 0, best_score: 0, avg_percentage: 0 };
  const best = results.reduce((max, r) => Math.max(max, Number(r.score || 0)), 0);
  const avg = results.reduce((sum, r) => sum + Number(r.percentage || 0), 0) / results.length;
  return {
    total_exams: results.length,
    best_score: Math.round(best * 100) / 100,
    avg_percentage: Math.round(avg * 100) / 100
  };
}

function uid(prefix) {
  return prefix + "_" + Utilities.getUuid().slice(0, 8).toUpperCase();
}

function now() {
  return new Date().toISOString();
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = items[i];
    items[i] = items[j];
    items[j] = temp;
  }
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}



