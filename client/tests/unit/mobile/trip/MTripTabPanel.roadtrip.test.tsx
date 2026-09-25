import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MTripTabPanel from '../../../../src/mobile/screens/trip/tabs/MTripTabPanel';
import { buildPlanner, buildShell } from '../../../helpers/mobileTrip';

// FE-MOB-TABPANEL-ROADTRIP: the roadtrip tab is the only one that routes to its
// own half-switching component. This pins the routing — the r3 state contract
// (rtView/rtReach) exists precisely so this branch can be wired, and an orphaned
// MRoadtripTab was exactly the kind of gap this assertion keeps closed.
vi.mock('../../../../src/mobile/screens/trip/roadtrip/MRoadtripTab', () => ({
  default: ({ planner, shell, tab }: Record<string, unknown>) => (
    <div
      data-testid="stub-roadtrip-tab"
      data-tab={String(tab)}
      data-trip={String((planner as { tripId: number }).tripId)}
      data-rtview={String((shell as { rtView: string }).rtView)}
    />
  ),
}));

describe('MTripTabPanel > the roadtrip tab', () => {
  it('routes tab="roadtrip" to MRoadtripTab with the planner, shell and tab', () => {
    const planner = buildPlanner();
    const shell = buildShell({ trTab: 'roadtrip' }) as unknown as ReturnType<typeof buildShell> & { rtView: string };
    render(<MTripTabPanel planner={planner} shell={shell} tab={'roadtrip' as never} />);

    const stub = screen.getByTestId('stub-roadtrip-tab');
    expect(stub).toHaveAttribute('data-tab', 'roadtrip');
    expect(stub).toHaveAttribute('data-trip', '1');
    expect(stub).toHaveAttribute('data-rtview', 'list');
  });
});
