import type { TranslationStrings } from '../types';

const trips: TranslationStrings = {
  'trips.memberRemoved': '{username} borttagen',
  'trips.memberRemoveError': 'Det gick inte att ta bort',
  'trips.memberAdded': '{username} tillagd',
  'trips.memberAddError': 'Det gick inte att lägga till',
  'trips.reminder': 'Påminnelse',
  'trips.reminderNone': 'Ingen',
  'trips.reminderDay': 'dag',
  'trips.reminderDays': 'dagar',
  'trips.reminderCustom': 'Anpassad',
  'trips.reminderDaysBefore': 'dagar innan avresa',
  'trips.reminderDisabledHint':
    'Resepåminnelser är inaktiverade. Aktivera dem under Admin > Inställningar > Meddelanden.',
  'trips.importTrekTab': 'Importera från TREK',
  'trips.importTrekIntro':
    'Ladda upp en TREK-säkerhetskopia (.zip) och välj de resor som ska kopieras till TT — dagar, platser, bokningar, budget och foton följer med.',
  'trips.importTrekPick': 'Välj en TREK-säkerhetskopia (.zip)',
  'trips.importTrekScanning': 'Läser säkerhetskopian…',
  'trips.importTrekImport': 'Importera valda resor',
  'trips.importTrekSuccess': 'Imported {count} trip(s)',
  'trips.importTrekNone': 'Inga resor hittades i den här kopian',
  'trips.importTrekFailed': 'Importen misslyckades. Är detta en säkerhetskopia från TREK?',
  'trips.importTrekStats': '{days} days · {places} places · {photos} photos · {budget} budget items',
  'trips.importTrekUntitled': 'Resa utan titel',
};
export default trips;
