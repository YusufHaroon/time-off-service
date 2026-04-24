import axios from 'axios';
import { startMockHcm, stopMockHcm } from './start.js';
import { DEFAULT_FIXTURES } from './fixtures.js';

const BASE = 'http://localhost:3099';
const HEADERS = { 'X-HCM-API-Key': 'mock-hcm-key' };

async function seed(fixtures = DEFAULT_FIXTURES) {
  await axios.post(`${BASE}/mock/seed`, fixtures);
}

describe('mock-hcm server', () => {
  beforeAll(() => startMockHcm(3099));
  afterAll(() => stopMockHcm());
  beforeEach(() => seed());

  // -------------------------------------------------------------------------
  // GET /balance
  // -------------------------------------------------------------------------

  describe('GET /balance', () => {
    it('returns seeded balance for emp_001 ANNUAL', async () => {
      const { data } = await axios.get(`${BASE}/balance`, {
        headers: HEADERS,
        params: { employeeId: 'emp_001', locationId: 'loc_us_nyc', leaveType: 'ANNUAL' },
      });

      expect(data.employeeId).toBe('emp_001');
      expect(data.leaveType).toBe('ANNUAL');
      expect(data.totalDays).toBe(20);
      expect(data.usedDays).toBe(0);
      expect(data.availableDays).toBe(20);
    });

    it('returns 404 for an unknown employee', async () => {
      await expect(
        axios.get(`${BASE}/balance`, {
          headers: HEADERS,
          params: { employeeId: 'no_such', locationId: 'loc_us_nyc', leaveType: 'ANNUAL' },
        }),
      ).rejects.toMatchObject({ response: { status: 404 } });
    });

    it('returns 401 when API key is missing', async () => {
      await expect(
        axios.get(`${BASE}/balance`, {
          params: { employeeId: 'emp_001', locationId: 'loc_us_nyc', leaveType: 'ANNUAL' },
        }),
      ).rejects.toMatchObject({ response: { status: 401 } });
    });
  });

  // -------------------------------------------------------------------------
  // POST /balance  (deduct)
  // -------------------------------------------------------------------------

  describe('POST /balance', () => {
    it('deducts days and reflects on subsequent GET', async () => {
      const { data } = await axios.post(
        `${BASE}/balance`,
        { employeeId: 'emp_001', locationId: 'loc_us_nyc', leaveType: 'ANNUAL', deductDays: 3, referenceId: 'ref-1' },
        { headers: HEADERS },
      );

      expect(data.hcmReferenceId).toMatch(/^hcm_/);

      const { data: after } = await axios.get(`${BASE}/balance`, {
        headers: HEADERS,
        params: { employeeId: 'emp_001', locationId: 'loc_us_nyc', leaveType: 'ANNUAL' },
      });
      expect(after.usedDays).toBe(3);
      expect(after.availableDays).toBe(17);
    });

    it('returns 422 when requested days exceed available balance', async () => {
      // emp_003 has only 1 day available (totalDays=5, usedDays=4)
      await expect(
        axios.post(
          `${BASE}/balance`,
          { employeeId: 'emp_003', locationId: 'loc_us_nyc', leaveType: 'ANNUAL', deductDays: 2, referenceId: 'ref-2' },
          { headers: HEADERS },
        ),
      ).rejects.toMatchObject({ response: { status: 422 } });
    });
  });

  // -------------------------------------------------------------------------
  // POST /mock/scenario — timeout
  // -------------------------------------------------------------------------

  describe('POST /mock/scenario — timeout', () => {
    it('causes next GET /balance to hang until the client times out', async () => {
      await axios.post(`${BASE}/mock/scenario`, { employeeId: 'emp_001', scenario: 'timeout' });

      let caught;
      try {
        await axios.get(`${BASE}/balance`, {
          headers: HEADERS,
          params: { employeeId: 'emp_001', locationId: 'loc_us_nyc', leaveType: 'ANNUAL' },
          timeout: 200,
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      const isTimeoutLike =
        caught.code === 'ECONNABORTED' ||
        caught.code === 'ERR_CANCELED' ||
        caught.code === 'ECONNRESET' ||
        (caught.message && caught.message.toLowerCase().includes('timeout'));
      expect(isTimeoutLike).toBe(true);

      // scenario is one-shot — subsequent request should succeed
      const { data } = await axios.get(`${BASE}/balance`, {
        headers: HEADERS,
        params: { employeeId: 'emp_001', locationId: 'loc_us_nyc', leaveType: 'ANNUAL' },
      });
      expect(data.availableDays).toBe(20);
    });
  });

  // -------------------------------------------------------------------------
  // POST /mock/anniversary
  // -------------------------------------------------------------------------

  describe('POST /mock/anniversary', () => {
    it('adds bonus days visible on next GET /balance', async () => {
      await axios.post(`${BASE}/mock/anniversary`, {
        employeeId: 'emp_001',
        locationId: 'loc_us_nyc',
        leaveType: 'ANNUAL',
        bonusDays: 5,
      });

      const { data } = await axios.get(`${BASE}/balance`, {
        headers: HEADERS,
        params: { employeeId: 'emp_001', locationId: 'loc_us_nyc', leaveType: 'ANNUAL' },
      });

      expect(data.totalDays).toBe(25);
      expect(data.availableDays).toBe(25);
    });

    it('returns 404 for unknown employee', async () => {
      await expect(
        axios.post(`${BASE}/mock/anniversary`, {
          employeeId: 'no_such',
          locationId: 'loc_us_nyc',
          leaveType: 'ANNUAL',
          bonusDays: 5,
        }),
      ).rejects.toMatchObject({ response: { status: 404 } });
    });
  });

  // -------------------------------------------------------------------------
  // POST /balance/reversal
  // -------------------------------------------------------------------------

  describe('POST /balance/reversal', () => {
    it('restores deducted days', async () => {
      // First deduct 5 days from emp_002 (has 10 available)
      await axios.post(
        `${BASE}/balance`,
        { employeeId: 'emp_002', locationId: 'loc_us_nyc', leaveType: 'ANNUAL', deductDays: 5, referenceId: 'ref-3' },
        { headers: HEADERS },
      );

      await axios.post(
        `${BASE}/balance/reversal`,
        { employeeId: 'emp_002', locationId: 'loc_us_nyc', leaveType: 'ANNUAL', restoreDays: 5 },
        { headers: HEADERS },
      );

      const { data } = await axios.get(`${BASE}/balance`, {
        headers: HEADERS,
        params: { employeeId: 'emp_002', locationId: 'loc_us_nyc', leaveType: 'ANNUAL' },
      });
      expect(data.usedDays).toBe(5); // original usedDays=5 restored
    });
  });

  // -------------------------------------------------------------------------
  // GET /mock/state
  // -------------------------------------------------------------------------

  describe('GET /mock/state', () => {
    it('exposes full in-memory store with availableDays computed', async () => {
      const { data } = await axios.get(`${BASE}/mock/state`);
      const key = 'emp_001:loc_us_nyc:ANNUAL';
      expect(data[key]).toEqual({ totalDays: 20, usedDays: 0, availableDays: 20 });
    });
  });
});
