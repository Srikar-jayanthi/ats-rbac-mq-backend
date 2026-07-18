const fs = require('fs');
const path = require('path');

const API_URL = 'http://localhost:3000/api';

async function run() {
  console.log('=== ATS Backend API Verification Script ===');

  const request = async (route, method = 'GET', body = null, token = null) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(`${API_URL}${route}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null
    });
    const status = res.status;
    let data;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    return { status, data };
  };

  try {
    // 1. Create company
    console.log('\n[1] Registering company "Acme Corp"...');
    const compRes = await request('/auth/companies', 'POST', { name: 'Acme Corp' + Math.random().toString(36).substring(7) });
    console.log('Company Register Status:', compRes.status, compRes.data);
    const companyId = compRes.data.id;

    // 2. Register recruiter
    console.log('\n[2] Registering Recruiter...');
    const recReg = await request('/auth/register', 'POST', {
      email: 'recruiter@acme.com',
      password: 'password123',
      role: 'recruiter',
      company_id: companyId
    });
    console.log('Recruiter Reg Status:', recReg.status, recReg.data);

    // 3. Register candidate
    console.log('\n[3] Registering Candidate...');
    const candReg = await request('/auth/register', 'POST', {
      email: 'candidate@domain.com',
      password: 'password123',
      role: 'candidate'
    });
    console.log('Candidate Reg Status:', candReg.status, candReg.data);

    // 4. Log in Recruiter
    console.log('\n[4] Logging in Recruiter...');
    const recLogin = await request('/auth/login', 'POST', {
      email: 'recruiter@acme.com',
      password: 'password123'
    });
    console.log('Recruiter Login Status:', recLogin.status);
    const recToken = recLogin.data.token;

    // 5. Log in Candidate
    console.log('\n[5] Logging in Candidate...');
    const candLogin = await request('/auth/login', 'POST', {
      email: 'candidate@domain.com',
      password: 'password123'
    });
    console.log('Candidate Login Status:', candLogin.status);
    const candToken = candLogin.data.token;

    // 6. Recruiter creates job
    console.log('\n[6] Recruiter creating job...');
    const jobRes = await request('/jobs', 'POST', {
      title: 'Senior Software Engineer',
      description: 'Responsible for core web applications development.'
    }, recToken);
    console.log('Job Create Status:', jobRes.status, jobRes.data);
    const jobId = jobRes.data.id;

    // 7. Candidate applies to job
    console.log('\n[7] Candidate applying to job...');
    const startApply = Date.now();
    const appRes = await request(`/jobs/${jobId}/applications`, 'POST', {
      resume_url: 'https://example.com/resumes/candidate.pdf'
    }, candToken);
    const applyLatency = Date.now() - startApply;
    console.log('Application Apply Status:', appRes.status, appRes.data);
    console.log(`Apply Latency: ${applyLatency}ms (Expected: <100ms)`);
    const appId = appRes.data.id;

    // 8. Recruiter gets application details
    console.log('\n[8] Recruiter checking application...');
    const appCheck = await request(`/applications/${appId}`, 'GET', null, recToken);
    console.log('Application Details Status:', appCheck.status, appCheck.data);

    // 9. Recruiter attempts invalid stage transition (Applied -> Offer)
    console.log('\n[9] Recruiter updating stage (Applied -> Offer) [Expected Failure: 400 Bad Request]...');
    const badTransition = await request(`/applications/${appId}/stage`, 'PUT', { stage: 'Offer' }, recToken);
    console.log('Bad Transition Status:', badTransition.status, badTransition.data);

    // 10. Recruiter advances stage sequentially: Applied -> Screening -> Interview -> Offer -> Hired
    const stages = ['Screening', 'Interview', 'Offer', 'Hired'];
    for (const stage of stages) {
      console.log(`\n[10] Advancing stage to "${stage}"...`);
      const startTrans = Date.now();
      const transRes = await request(`/applications/${appId}/stage`, 'PUT', { stage }, recToken);
      const transLatency = Date.now() - startTrans;
      console.log(`Stage transition to ${stage} status:`, transRes.status, transRes.data);
      console.log(`Transition Latency: ${transLatency}ms (Expected: <100ms)`);
    }

    // 11. Wait 2 seconds for worker to process messages
    console.log('\n[11] Waiting 2 seconds for Redis broker and worker to process emails...');
    await new Promise(r => setTimeout(r, 2000));

    const logPath = path.join(__dirname, 'mock_emails.log');
    if (fs.existsSync(logPath)) {
      console.log('\n[12] Reading mock_emails.log file contents:');
      const logs = fs.readFileSync(logPath, 'utf8');
      console.log(logs);
    } else {
      console.error('\n[12] ERROR: mock_emails.log was not created!');
    }

    console.log('\n=== Verification Flow Completed ===');
  } catch (error) {
    console.error('Test Execution failed:', error);
  }
}

run();
