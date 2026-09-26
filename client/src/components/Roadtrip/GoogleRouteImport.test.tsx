import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TranslationProvider } from '../../i18n'
import GoogleRouteImport from './GoogleRouteImport'
import { googleRouteRepo } from '../../repo/googleRouteRepo'

const { loadTrip, state } = vi.hoisted(() => ({ loadTrip: vi.fn(), state: { days: [{ id: 3, day_number: 1, title: 'First day' }] } }))
vi.mock('../../store/tripStore', () => ({ useTripStore: Object.assign((select: (s: typeof state) => unknown) => select(state), { getState: () => ({ loadTrip }) }) }))
vi.mock('../../repo/googleRouteRepo', () => ({ googleRouteRepo: { preview: vi.fn(), previewAmap: vi.fn(), append: vi.fn() } }))

async function openPreview() {
  render(<TranslationProvider><GoogleRouteImport tripId={1} dayId={3} /></TranslationProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Import Google Maps route' }))
  // The menu offers one entry per link grammar; this file exercises the Google one.
  fireEvent.click(screen.getByText('Google Maps route', { selector: 'span' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Google Maps URL' }), { target: { value: 'https://google.com/maps/dir/A/B' } })
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await screen.findByText('Munich')
}

describe('Google route preview', () => {
  beforeEach(() => { vi.clearAllMocks(); loadTrip.mockResolvedValue(undefined) })

  it('previews in order and only saves resolved stops after confirmation', async () => {
    vi.mocked(googleRouteRepo.preview).mockResolvedValue({ stops: [{ name: 'Munich', lat: 48, lng: 11 }, { name: 'Unknown', lat: null, lng: null }, { name: 'Rome', lat: 41, lng: 12 }] })
    vi.mocked(googleRouteRepo.append).mockResolvedValue(undefined)
    await openPreview()
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([expect.stringContaining('Munich'), expect.stringContaining('Unknown'), expect.stringContaining('Rome')])
    expect(screen.getByText('Location unresolved; this stop will be skipped.')).toBeInTheDocument()
    expect(googleRouteRepo.append).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(loadTrip).toHaveBeenCalledWith(1))
    expect(googleRouteRepo.append).toHaveBeenCalledWith(1, { dayId: 3, stops: [{ name: 'Munich', lat: 48, lng: 11 }, { name: 'Rome', lat: 41, lng: 12 }] }, expect.any(String))
  })

  it('blocks import when fewer than two locations resolve', async () => {
    vi.mocked(googleRouteRepo.preview).mockResolvedValue({ stops: [{ name: 'Munich', lat: 48, lng: 11 }, { name: 'Unknown', lat: null, lng: null }] })
    await openPreview()
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
    expect(googleRouteRepo.append).not.toHaveBeenCalled()
  })
})

/**
 * The AMap link grammar is a second entry in the same menu. It reads a different
 * endpoint, because the two link shapes share nothing but the idea of a route in a
 * URL — and because AMap's coordinates are GCJ-02, which the server converts.
 */
describe('AMap route import', () => {
  beforeEach(() => { vi.clearAllMocks(); loadTrip.mockResolvedValue(undefined) })

  async function openAmapPreview() {
    render(<TranslationProvider><GoogleRouteImport tripId={1} dayId={3} /></TranslationProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Import Google Maps route' }))
    fireEvent.click(screen.getByText('AMap (高德) route', { selector: 'span' }))
  }

  it('FE-AMAP-IMPORT-001: the AMap entry reads the AMap endpoint, not the Google one', async () => {
    vi.mocked(googleRouteRepo.previewAmap).mockResolvedValue({
      stops: [{ name: 'Beijing', lat: 39.9, lng: 116.4 }, { name: 'Shanghai', lat: 31.2, lng: 121.5 }],
    })
    await openAmapPreview()

    fireEvent.change(screen.getByRole('textbox', { name: 'AMap route URL' }), {
      target: { value: 'https://ditu.amap.com/dir?from[lnglat]=116.39,39.91&to[lnglat]=121.47,31.23' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await screen.findByText('Beijing')
    expect(googleRouteRepo.previewAmap).toHaveBeenCalled()
    expect(googleRouteRepo.preview).not.toHaveBeenCalled()
  })

  it('FE-AMAP-IMPORT-002: the hint names the AMap link shapes', async () => {
    await openAmapPreview()
    expect(screen.getByText(/ditu\.amap\.com/)).toBeInTheDocument()
  })
})
