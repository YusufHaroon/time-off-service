import express from 'express';

/**
 * Creates (but does not start) the mock HCM Express server.
 *
 * @param {string} [apiKey] - expected X-HCM-API-Key value; defaults to env or 'mock-hcm-key'
 * @returns {{ app: express.Application, cleanup: () => void }}
 */
export function createServer(apiKey = process.env.HCM_API_KEY || 'mock-hcm-key') {
  const app = express();

  // In-memory store: key = `${employeeId}:${locationId}:${leaveType}`
  const balances = new Map();
  // Per-employee one-shot scenario overrides
  const scenarios = new Map();
  // Hanging response objects (timeout scenario) — cleared on shutdown
  const pendingRes = new Set();

  const storeKey = (emp, loc, leave) => `${emp}:${loc}:${leave}`;

  app.use(express.json());

  // ---------------------------------------------------------------------------
  // Auth middleware — applied to balance routes only
  // ---------------------------------------------------------------------------
  function requireApiKey(req, res, next) {
    const provided = req.headers['x-hcm-api-key'];
    if (!provided || provided !== apiKey) {
      return res.status(401).json({ error: 'Unauthorized: missing or invalid X-HCM-API-Key' });
    }
    next();
  }

  // Pop the scenario for an employee (consumes it on first use)
  function popScenario(employeeId) {
    const s = scenarios.get(employeeId) ?? 'none';
    if (s !== 'none') scenarios.delete(employeeId);
    return s;
  }

  // Handle timeout/error scenarios; returns true if the request was handled
  function applyScenario(scenario, res) {
    if (scenario === 'timeout') {
      pendingRes.add(res);
      res.on('close', () => pendingRes.delete(res));
      return true; // never respond
    }
    if (scenario === 'error500') {
      res.status(500).json({ error: 'Internal Server Error (simulated)' });
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // GET /balance
  // ---------------------------------------------------------------------------
  app.get('/balance', requireApiKey, (req, res) => {
    const { employeeId, locationId, leaveType } = req.query;
    const scenario = popScenario(employeeId);
    if (applyScenario(scenario, res)) return;

    const record = balances.get(storeKey(employeeId, locationId, leaveType));
    if (!record) {
      return res.status(404).json({ error: 'Employee/location balance not found' });
    }

    res.json({
      employeeId,
      locationId,
      leaveType,
      totalDays: record.totalDays,
      usedDays: record.usedDays,
      availableDays: record.totalDays - record.usedDays,
    });
  });

  // ---------------------------------------------------------------------------
  // POST /balance  (deduct)
  // ---------------------------------------------------------------------------
  app.post('/balance', requireApiKey, (req, res) => {
    const { employeeId, locationId, leaveType, deductDays, referenceId } = req.body;
    const scenario = popScenario(employeeId);
    if (applyScenario(scenario, res)) return;

    if (scenario === 'insufficient') {
      return res.status(422).json({ message: 'Insufficient balance (forced by scenario)' });
    }

    const record = balances.get(storeKey(employeeId, locationId, leaveType));
    if (!record) {
      return res.status(404).json({ error: 'Employee/location balance not found' });
    }

    const available = record.totalDays - record.usedDays;
    if (available < Number(deductDays)) {
      return res.status(422).json({
        message: `Insufficient balance: ${available} available, ${deductDays} requested`,
      });
    }

    record.usedDays += Number(deductDays);
    res.json({ hcmReferenceId: `hcm_${Date.now()}` });
  });

  // ---------------------------------------------------------------------------
  // POST /balance/reversal  (restore)
  // ---------------------------------------------------------------------------
  app.post('/balance/reversal', requireApiKey, (req, res) => {
    const { employeeId, locationId, leaveType, restoreDays } = req.body;

    const record = balances.get(storeKey(employeeId, locationId, leaveType));
    if (record) {
      record.usedDays = Math.max(0, record.usedDays - Number(restoreDays));
    }

    res.json({ hcmReferenceId: `hcm_rev_${Date.now()}` });
  });

  // ---------------------------------------------------------------------------
  // POST /mock/seed  — reset in-memory store
  // ---------------------------------------------------------------------------
  app.post('/mock/seed', (req, res) => {
    balances.clear();
    scenarios.clear();
    const items = Array.isArray(req.body) ? req.body : [];
    for (const item of items) {
      balances.set(storeKey(item.employeeId, item.locationId, item.leaveType), {
        totalDays: Number(item.totalDays),
        usedDays: Number(item.usedDays),
      });
    }
    res.json({ seeded: items.length });
  });

  // ---------------------------------------------------------------------------
  // POST /mock/scenario  — set a per-employee one-shot behaviour override
  // ---------------------------------------------------------------------------
  app.post('/mock/scenario', (req, res) => {
    const { employeeId, scenario } = req.body;
    if (scenario === 'none') {
      scenarios.delete(employeeId);
    } else {
      scenarios.set(employeeId, scenario);
    }
    res.json({ ok: true, employeeId, scenario });
  });

  // ---------------------------------------------------------------------------
  // POST /mock/anniversary  — add bonus days to totalDays
  // ---------------------------------------------------------------------------
  app.post('/mock/anniversary', (req, res) => {
    const { employeeId, locationId, leaveType, bonusDays } = req.body;
    const record = balances.get(storeKey(employeeId, locationId, leaveType));
    if (!record) {
      return res.status(404).json({ error: 'Balance record not found' });
    }
    record.totalDays += Number(bonusDays);
    res.json({ ok: true, employeeId, leaveType, totalDays: record.totalDays });
  });

  // ---------------------------------------------------------------------------
  // GET /mock/state  — expose full in-memory store for test assertions
  // ---------------------------------------------------------------------------
  app.get('/mock/state', (req, res) => {
    const state = {};
    for (const [k, v] of balances) {
      state[k] = { ...v, availableDays: v.totalDays - v.usedDays };
    }
    res.json(state);
  });

  // ---------------------------------------------------------------------------
  // cleanup — destroy sockets for any hanging (timeout) requests
  // ---------------------------------------------------------------------------
  function cleanup() {
    for (const r of pendingRes) {
      try { r.socket?.destroy(); } catch { /* ignore */ }
    }
    pendingRes.clear();
  }

  return { app, cleanup };
}
