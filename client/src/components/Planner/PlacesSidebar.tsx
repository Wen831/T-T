import React from 'react';
import SaveTripPlacesToListModal from '../Collections/SaveTripPlacesToListModal';
import ConfirmDialog from '../shared/ConfirmDialog';
import { ContextMenu } from '../shared/ContextMenu';
import FileImportModal from './FileImportModal';
import { PlacesBulkCategoryModal } from './PlacesBulkCategoryModal';
import { PlacesDropOverlay, PlacesHeader } from './PlacesSidebarHeader';
import { PlacesList } from './PlacesSidebarList';
import { ListImportModal } from './PlacesSidebarListImportModal';
import { MobileDayPickerSheet } from './PlacesSidebarMobileDayPicker';
import { PlacesSelectionBar } from './PlacesSidebarSelectionBar';
import { usePlacesSidebar, type PlacesSidebarProps } from './usePlacesSidebar';
import DawarichSuggestionsPanel from '../Dawarich/DawarichSuggestionsPanel';
import { formatDayOption } from '../Dawarich/dawarichSuggestionModel';
import { refreshTripAfterAccept } from '../Dawarich/dawarichTripRefresh';
import { useTranslation } from '../../i18n';

const PlacesSidebar = React.memo(function PlacesSidebar(props: PlacesSidebarProps) {
  const S = usePlacesSidebar(props);
  // The sidebar hook carries `t` but not the locale; day labels need both.
  const { locale } = useTranslation();
  const {
    sidebarDragOver,
    handleSidebarDragEnter,
    handleSidebarDragOver,
    handleSidebarDragLeave,
    handleSidebarDrop,
    selectMode,
    filtered,
    t,
    dayPickerPlace,
    listImportOpen,
    fileImportOpen,
    setFileImportOpen,
    sidebarDropFile,
    setSidebarDropFile,
    tripId,
    days,
    pushUndo,
    ctxMenu,
    isMobile,
    isTouch,
    pendingDeleteIds,
    setPendingDeleteIds,
    onBulkDeleteConfirm,
    categories,
    selectedIds,
    exitSelectMode,
    onBulkChangeCategory,
    categoryPickerOpen,
    setCategoryPickerOpen,
    collectionsEnabled,
    saveToListOpen,
    setSaveToListOpen,
  } = S;
  // Below lg the places sit in their own tab with no plan beside them to drag
  // into. A coarse pointer is the other half of the gate: a finger cannot start
  // an HTML5 drag, so arming one turns the list's swipe into a drag and the
  // scroll is lost (#1432). Hybrid laptops keep the drag — their primary pointer
  // is fine, and they load the drag-drop-touch bridge instead.
  const dragDisabled = isMobile || Boolean(isTouch);
  return (
    <div
      data-touch-drag={dragDisabled ? undefined : ''}
      onDragEnter={dragDisabled ? undefined : handleSidebarDragEnter}
      onDragOver={dragDisabled ? undefined : handleSidebarDragOver}
      onDragLeave={dragDisabled ? undefined : handleSidebarDragLeave}
      onDrop={dragDisabled ? undefined : handleSidebarDrop}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: 'var(--font-system)',
        position: 'relative',
      }}
    >
      {!dragDisabled && sidebarDragOver && <PlacesDropOverlay {...S} />}
      {/* Kopfbereich */}
      <PlacesHeader {...S} />

      {/* Anzahl / Auswahl-Leiste */}
      {selectMode ? (
        <PlacesSelectionBar {...S} />
      ) : (
        <div style={{ padding: '6px 16px', flexShrink: 0 }}>
          <span className="text-content-faint" style={{ fontSize: 'calc(11px * var(--fs-scale-caption, 1))' }}>
            {filtered.length === 1 ? t('places.countSingular') : t('places.count', { count: filtered.length })}
          </span>
        </div>
      )}

      {/* Liste, with the Dawarich stays riding on top of it inside the same scroller —
          see the `header` prop for why they are not a band of their own. */}
      <PlacesList
        {...S}
        header={(
          <div style={{ padding: '0 12px 8px' }}>
            <DawarichSuggestionsPanel
              tripId={tripId}
              trips={[{ id: tripId, label: t('dawarich.accept.thisTrip') }]}
              daysForTrip={() => days.map(day => ({
                id: day.id,
                ...formatDayOption(day.day_number, day.date, locale, t),
              }))}
              // The place it just created belongs on the map and in the list
              // now, not after a reload.
              onAccepted={() => { void refreshTripAfterAccept(tripId) }}
              initiallyCollapsed
            />
          </div>
        )}
      />

      {dayPickerPlace && <MobileDayPickerSheet {...S} />}
      {listImportOpen && <ListImportModal {...S} />}
      <FileImportModal
        isOpen={fileImportOpen}
        onClose={() => {
          setFileImportOpen(false);
          setSidebarDropFile(null);
        }}
        tripId={tripId}
        pushUndo={pushUndo}
        initialFile={sidebarDropFile}
      />
      <ContextMenu menu={ctxMenu.menu} onClose={ctxMenu.close} />
      {categoryPickerOpen && (
        <PlacesBulkCategoryModal
          count={selectedIds.size}
          categories={categories}
          onClose={() => setCategoryPickerOpen(false)}
          onPick={(catId) => {
            onBulkChangeCategory?.(Array.from(selectedIds), catId);
            setCategoryPickerOpen(false);
            exitSelectMode();
          }}
        />
      )}
      {collectionsEnabled && (
        <SaveTripPlacesToListModal
          isOpen={saveToListOpen}
          tripId={tripId}
          placeIds={Array.from(selectedIds)}
          onClose={() => setSaveToListOpen(false)}
          onDone={exitSelectMode}
        />
      )}
      {isMobile && (
        <ConfirmDialog
          isOpen={!!pendingDeleteIds?.length}
          onClose={() => setPendingDeleteIds(null)}
          onConfirm={() => {
            onBulkDeleteConfirm?.(pendingDeleteIds!);
            setPendingDeleteIds(null);
          }}
          message={t('trip.confirm.deletePlaces', { count: pendingDeleteIds?.length ?? 0 })}
        />
      )}
    </div>
  );
});

export default PlacesSidebar;
