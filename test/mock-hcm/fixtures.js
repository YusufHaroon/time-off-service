/**
 * Default seed data for the mock HCM server.
 * Re-POST to /mock/seed at the start of each test to reset state.
 */
export const DEFAULT_FIXTURES = [
  // emp_001 — full entitlement, nothing used
  { employeeId: 'emp_001', locationId: 'loc_us_nyc', leaveType: 'ANNUAL', totalDays: 20, usedDays: 0 },
  { employeeId: 'emp_001', locationId: 'loc_us_nyc', leaveType: 'SICK',   totalDays: 10, usedDays: 0 },

  // emp_002 — partially used
  { employeeId: 'emp_002', locationId: 'loc_us_nyc', leaveType: 'ANNUAL', totalDays: 15, usedDays: 5 },
  { employeeId: 'emp_002', locationId: 'loc_us_nyc', leaveType: 'SICK',   totalDays: 10, usedDays: 2 },

  // emp_003 — borderline: only 1 day available
  { employeeId: 'emp_003', locationId: 'loc_us_nyc', leaveType: 'ANNUAL', totalDays: 5,  usedDays: 4 },
];
