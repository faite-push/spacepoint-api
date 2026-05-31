const { JsonDatabase } = require("wio.db");
const dbConfigs = new JsonDatabase({ databasePath: "./src/databases/dbConfigs.json" });
module.exports.dbConfigs = dbConfigs;