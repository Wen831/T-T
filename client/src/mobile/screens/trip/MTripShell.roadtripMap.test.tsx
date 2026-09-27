import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { buildPlanner, buildShell } from '../../../../tests/helpers/mobileTrip';
// The repo's own render: MemoryRouter + translation provider, both of which the shell
// needs (useNavigate, and every string it prints).
import { render } from '../../../../tests/helpers/render';

/**
 * The road trip tab's map half.
 *
 * `MapArea` used to be mounted only inside the `trTab === 'plan'` branch, so on the road
 * trip tab there was no map underneath the floating bar at all — the tab rendered its
 * chain or its stage bar over nothing, which is the "list but no map" the user saw. This
 * file pins the seam the shell owns: which tab mounts a map slot, and what that slot is
 * handed.
 *
 * The engine is stubbed. What `MMapArea` then does with the planner's fields — the drive
 * lines, their colours, the handles — is that component's own contract, asserted in its
 * terms; repeating it here would only re-test the slot.
 */
const captured: Record<string, Record<string, unknown>> = {};
const MapAreaProbe = (props: { planner: Record<string, unknown> }) => {
  captured.planner = props.planner;
  return React.createElement('div', { 'data-testid': 'map-area' });
};

// The shell calls useTripPlanner itself — it takes no planner prop — so the hook is what
// has to be stubbed for a render to see any particular state.
let plannerStub: ReturnType<typeof buildPlanner> | null = null;
vi.mock('../../../pages/tripPlanner/useTripPlanner', () => ({
  useTripPlanner: () => plannerStub,
}));

import MTripShell from './MTripShell';

/**
 * The stub's TRIP_TABS is empty, and the shell reads it to decide which dock seats
 * exist — an empty list leaves no road trip tab to stand on. This is the shape the
 * planner really publishes.
 */
const TABS = [
  { id: 'plan', label: 'Plan' },
  { id: 'roadtrip', label: 'Road trip' },
  { id: 'transports', label: 'Transports' },
  { id: 'buchungen', label: 'Bookings' },
  { id: 'finanzplan', label: 'Costs' },
] as never;

function plannerWith(overrides: Record<string, unknown> = {}) {
  plannerStub = buildPlanner({ TRIP_TABS: TABS, activeTab: 'roadtrip', ...overrides } as never);
  return plannerStub;
}

function renderShell() {
  return render(<MTripShell MapArea={MapAreaProbe as never} />);
}

describe('MTripShell — the road trip map half', () => {
  it('FE-MT-MAP-001: the map slot is mounted on the road trip tab, not only on the plan tab', () => {
    plannerWith();
    const { container } = renderShell();
    // Before the fix this was empty: MapArea lived inside the plan-tab branch alone,
    // so the drive half had nothing to float its bar over.
    expect(container.querySelector('[data-testid="map-area"]')).not.toBeNull();
  });

  it('FE-MT-MAP-002: the map slot still mounts on the plan tab, which is how it behaved before', () => {
    plannerWith({ activeTab: 'plan' });
    const { container } = renderShell();
    expect(container.querySelector('[data-testid="map-area"]')).not.toBeNull();
  });

  it('FE-MT-MAP-003: a tab that is neither map half gets no map slot', () => {
    plannerWith({ activeTab: 'finanzplan' });
    const { container } = renderShell();
    // Costs are a list, not a map; mounting one there would misrepresent the tab.
    expect(container.querySelector('[data-testid="map-area"]')).toBeNull();
  });

  it('FE-MT-MAP-004: the slot is handed the live planner, so the drive data reaches the map', () => {
    const planner = plannerWith({ activeTab: 'roadtrip' });
    renderShell();
    expect(captured.planner).toBe(planner);
  });

  it('FE-MT-MAP-005: the drive tab renders even when nothing is planned', () => {
    // A render that throws would make every assertion above vacuous, and an empty trip
    // is exactly the state a new drive starts in.
    plannerWith({ activeTab: 'roadtrip', days: [], places: [] });
    expect(() => renderShell()).not.toThrow();
  });
});
