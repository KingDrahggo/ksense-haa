// ==========================
// Config / Constants
// ==========================
const API_KEY = "ak_900944028e2b8dec35c2c9d7f3d0e115fabd80b9d6f199a1"; // unique session API key
const BASE_URL = "https://assessment.ksensetech.com/api"; // base API endpoint

// ==========================
// Utility function: sleep / delay
// ==========================
// Used to wait between retries or page requests to avoid hitting API rate limits
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==========================
// Fetch patients with pagination, retries, and rate-limit handling
// ==========================
async function fetchPatients() {
  let patients = [];        // store all fetched patients
  let page = 1;             // start at page 1
  let totalPages = 1;       // will update from API response

  while (page <= totalPages) {
    let attempts = 0;       // track retries for current page
    let success = false;    // flag for successful fetch

    while (!success && attempts < 10) { // allow up to 10 retries per page
      try {
        const res = await fetch(`${BASE_URL}/patients?page=${page}&limit=5`, {
          headers: { "x-api-key": API_KEY }
        });

        // === Rate limiting (Too Many Requests) ===
        if (res.status === 429) {
          attempts++;
          const wait = 3000 * attempts; // exponential-ish backoff
          console.warn(`429 Too Many Requests. Waiting ${wait}ms before retry`);
          await sleep(wait);
          continue;
        }

        // === Intermittent server errors (simulate real-world API instability) ===
        if ([500, 502, 503].includes(res.status)) {
          attempts++;
          const wait = 3000 * attempts;
          console.warn(`${res.status} Server Error. Waiting ${wait}ms before retry`);
          await sleep(wait);
          continue;
        }

        // Unexpected HTTP error
        if (!res.ok) throw new Error(`Unexpected Error ${res.status}`);

        const json = await res.json();

        // Add fetched patients to array
        patients = patients.concat(json.data);

        // Update totalPages from API pagination
        totalPages = json.pagination.totalPages;

        success = true; // exit retry loop
      } catch (err) {
        // Catch network errors, JSON parsing errors, etc.
        attempts++;
        const wait = 3000 * attempts;
        console.warn(`Retry ${attempts} for page ${page}. Waiting ${wait}ms`);
        await sleep(wait);
      }
    }

    // Move to next page
    page++;
    console.log(`Waiting 3s before fetching next page...`);
    await sleep(3000); // small pause between pages to reduce chance of rate limit
  }

  return patients;
}

// ==========================
// Parsing / Risk scoring functions
// ==========================

// Parse Blood Pressure string "Systolic/Diastolic" into risk score
function parseBP(bp) {
  if (!bp) return 0;                     // missing data → 0 points
  const match = bp.match(/(\d+)\/(\d+)/); 
  if (!match) return 0;

  const systolic = parseInt(match[1]);
  const diastolic = parseInt(match[2]);
  if (isNaN(systolic) || isNaN(diastolic)) return 0;

  // Scoring based on ranges
  if (systolic < 120 && diastolic < 80) return 1;
  if (systolic >= 120 && systolic <= 129 && diastolic < 80) return 2;
  if ((systolic >= 130 && systolic <= 139) || (diastolic >= 80 && diastolic <= 89)) return 3;
  if (systolic >= 140 || diastolic >= 90) return 4;

  return 0;
}

// Parse temperature into risk score
function parseTemp(temp) {
  if (temp == null || isNaN(temp)) return 0; // missing or invalid
  if (temp <= 99.5) return 0;
  if (temp <= 100.9) return 1;
  return 2; // temp > 100.9
}

// Parse age into risk score
function parseAge(age) {
  if (age == null || isNaN(age)) return 0; // missing or invalid
  if (age < 40) return 1;
  if (age <= 65) return 1;
  return 2; // age > 65
}

// ==========================
// Calculate total risk score for a patient
// ==========================
function calculateRisk(patient) {
  if (!patient) {
    // defensive check for undefined/null patient (can happen with failed fetch)
    return { total: 0, bpScore: 0, tempScore: 0, ageScore: 0, dataIssue: true };
  }

  const bpScore = parseBP(patient.blood_pressure);
  const tempScore = parseTemp(patient.temperature);
  const ageScore = parseAge(patient.age);

  const total = bpScore + tempScore + ageScore;

  // dataIssue = true if any individual score is 0 (meaning missing/invalid)
  const dataIssue = [bpScore, tempScore, ageScore].includes(0);

  return { total, bpScore, tempScore, ageScore, dataIssue };
}

// ==========================
// Build alert lists based on patient risk
// ==========================
function buildAlertLists(patients) {
  const highRisk = [];
  const fever = [];
  const dataIssues = [];

  patients.forEach(p => {
    if (!p) return; // skip undefined patients

    const { total, dataIssue } = calculateRisk(p);

    if (total >= 4) highRisk.push(p.patient_id);          // total risk score threshold
    if (p.temperature && p.temperature >= 99.6) fever.push(p.patient_id); // fever threshold
    if (dataIssue) dataIssues.push(p.patient_id);        // missing/invalid data
  });

  return { high_risk_patients: highRisk, fever_patients: fever, data_quality_issues: dataIssues };
}

// ==========================
// Submit results to API
// ==========================
async function submitResults(results) {
  const res = await fetch(`${BASE_URL}/submit-assessment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY
    },
    body: JSON.stringify(results)
  });

  const json = await res.json();
  console.log("Assessment Results:", json);
}

// ==========================
// Main flow
// ==========================
async function runAssessment() {
  console.log("Fetching patients...");
  const patients = await fetchPatients(); // fetch all patients with pagination
  console.log("Patients fetched:", patients.length);

  const alerts = buildAlertLists(patients); // compute risk scores & alerts
  console.log("Alert lists ready:", alerts);

  await submitResults(alerts); // submit to API
}

// Execute assessment
runAssessment();
