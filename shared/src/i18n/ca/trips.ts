import type { TranslationStrings } from '../types';

const trips: TranslationStrings = {
  'trips.reminder': 'Recordatori',
  'trips.reminderNone': 'Cap',
  'trips.reminderDay': 'dia',
  'trips.reminderDays': 'dies',
  'trips.reminderCustom': 'Personalitzat',
  'trips.memberRemoved': '{username} eliminat',
  'trips.memberRemoveError': 'Error en eliminar',
  'trips.memberAdded': '{username} afegit',
  'trips.memberAddError': 'Error en afegir',
  'trips.reminderDaysBefore': 'dies abans de la sortida',
  'trips.reminderDisabledHint':
    "Els recordatoris de viatge estan desactivats. Activa'ls a Admin > Configuració > Notificacions.",
  'trips.importTrekTab': 'Importa des de TREK',
  'trips.importTrekIntro':
    'Puja una còpia de seguretat de TREK (.zip) i tria els viatges a copiar a TT: dies, llocs, reserves, pressupost i fotos van amb ells.',
  'trips.importTrekPick': 'Tria una còpia de seguretat de TREK (.zip)',
  'trips.importTrekScanning': 'Legint la còpia de seguretat…',
  'trips.importTrekImport': 'Importa els viatges seleccionats',
  'trips.importTrekSuccess': 'Imported {count} trip(s)',
  'trips.importTrekNone': "No s'ha trobat cap viatge en aquesta còpia",
  'trips.importTrekFailed': 'La importació ha fallat. Esteu segur que és una còpia de seguretat del TREK?',
  'trips.importTrekStats': '{days} days · {places} places · {photos} photos · {budget} budget items',
  'trips.importTrekUntitled': 'Viatge sense títol',
};
export default trips;
