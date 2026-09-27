# Document Sync

Document sync pairs a trip with a folder in a cloud document store, so the trip's files stay in the store you already use while TT lists them beside the trip.

It does not copy your documents into TT: the files remain in the store, and TT keeps the pairing between a trip and the store location.

> **Availability.** The **Document sync** button on the Files screen appears only when an instance offers a document provider and you may bind the trip, or when the trip is already bound. On a fresh instance with every provider switched off, the button is hidden rather than leading into an empty screen. Members of a bound trip always see it, so they can tell where their documents live.

## Opening it

**Where:** open a trip → **Files** tab → the **Document sync** button in the toolbar.

It opens as its own dialog rather than a settings pane, because it is a task with a beginning and an end: you pick a store, authorize it, and choose what to sync.

## Binding a store

1. Open **Document sync** from the Files toolbar.
2. Pick the store (the providers the instance offers are listed).
3. Follow the provider's connection step — depending on the provider this is an authorization you approve in the provider's own UI, or credentials you enter.
4. Choose the folder the trip's documents live in.
5. Save the binding.

Once bound, the trip's documents appear in the Files tab with their sync state, and the pairing survives reloads. The binding is per trip.

## Working with synced documents

- **Sync now** runs a sync for that binding.
- Each document shows whether it is in step, and any that need attention are counted so you can see them without opening every file.
- A refused credential is reported on the binding, with a **Reconnect** action that reopens the connection form for that store.
- **Disconnecting** asks first, then removes the binding. It removes the pairing, not your documents: the files stay in the store.

## Permissions

- The **owner** (or anybody who may manage the trip's documents) can bind, reconnect and disconnect.
- A **member** sees where the documents go, and is told who sets it up, but is not offered a store to add or a binding to change.

## On a phone

The same dialog is reachable from the Files tab on the mobile shell, laid out as a sheet.

See also: [Documents and Files](Documents-and-Files).
