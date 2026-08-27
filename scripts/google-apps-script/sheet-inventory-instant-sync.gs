/**
 * EastCord Tires — instant Sheet1 → website inventory sync
 *
 * Paste this into the inventory spreadsheet:
 * Extensions → Apps Script
 *
 * Then run installEastCordInventorySync() once (as the sheet owner).
 * Script properties required:
 *   INVENTORY_SYNC_URL    = https://eastcordtires.ca/.netlify/functions/sync-inventory-from-sheets
 *   INVENTORY_SYNC_SECRET = the same INVENTORY_SYNC_SECRET value as Netlify
 *
 * Simple onEdit triggers cannot call UrlFetchApp. This uses an installable
 * trigger so a sheet edit can POST to the website sync function.
 */

var SHEET_NAME = 'Sheet1';
var DEBOUNCE_MS = 8000;
var SYNC_HANDLER = 'syncInventorySoon_';
var MENU_TITLE = 'EastCord';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(MENU_TITLE)
    .addItem('Sync inventory to website now', 'syncInventoryNow')
    .addItem('Install instant sync', 'installEastCordInventorySync')
    .addToUi();
}

function installEastCordInventorySync() {
  assertConfig_();
  removeTriggers_('onInventoryEdit_');
  removeTriggers_('onInventoryChange_');
  removeTriggers_(SYNC_HANDLER);

  ScriptApp.newTrigger('onInventoryEdit_')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();

  ScriptApp.newTrigger('onInventoryChange_')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onChange()
    .create();

  SpreadsheetApp.getUi().alert(
    'Instant inventory sync is on. Edits to Sheet1 will update the website a few seconds after you stop typing. The 15-minute Netlify backup sync is still in place.'
  );
}

function onInventoryEdit_(event) {
  var sheet = event && event.range && event.range.getSheet();
  if (sheet && sheet.getName() !== SHEET_NAME) return;
  scheduleSync_();
}

function onInventoryChange_(event) {
  var changeType = String(event && event.changeType || '');
  if (['EDIT', 'INSERT_ROW', 'REMOVE_ROW', 'INSERT_COLUMN', 'REMOVE_COLUMN', 'OTHER'].indexOf(changeType) === -1) {
    return;
  }
  scheduleSync_();
}

function scheduleSync_() {
  removeTriggers_(SYNC_HANDLER);
  ScriptApp.newTrigger(SYNC_HANDLER)
    .timeBased()
    .after(DEBOUNCE_MS)
    .create();
}

function syncInventorySoon_() {
  removeTriggers_(SYNC_HANDLER);
  syncInventoryNow(true);
}

function syncInventoryNow(silent) {
  var config = assertConfig_();
  var response = UrlFetchApp.fetch(config.url, {
    method: 'post',
    headers: {
      'x-sync-secret': config.secret,
    },
    muteHttpExceptions: true,
    followRedirects: true,
  });

  var code = response.getResponseCode();
  var body = response.getContentText();
  var ok = code >= 200 && code < 300;
  Logger.log('EastCord inventory sync ' + code + ': ' + body);

  if (silent === true) return ok;

  SpreadsheetApp.getUi().alert(
    ok
      ? 'Website inventory updated.'
      : 'Website inventory sync failed (' + code + '). Check Apps Script logs and the INVENTORY_SYNC_SECRET value.'
  );
  return ok;
}

function assertConfig_() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('INVENTORY_SYNC_URL') || '').trim();
  var secret = String(props.getProperty('INVENTORY_SYNC_SECRET') || '').trim();
  if (!url || !secret) {
    throw new Error(
      'Set script properties INVENTORY_SYNC_URL and INVENTORY_SYNC_SECRET before installing instant sync.'
    );
  }
  return { url: url, secret: secret };
}

function removeTriggers_(handlerName) {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}
