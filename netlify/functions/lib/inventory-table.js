function inventoryTableName() {
  const name = String(process.env.INVENTORY_TABLE || 'usedtireinventory').trim();
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : 'usedtireinventory';
}

function isDevInventoryTable() {
  return inventoryTableName() !== 'usedtireinventory';
}

module.exports = {
  inventoryTableName,
  isDevInventoryTable,
};
